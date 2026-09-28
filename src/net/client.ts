import type { InputFrame } from '../core/input.ts';
import type { GameSimulation, SimulationEvent } from '../core/simulation.ts';
import type { EntityId, PlayerState, Vec3 } from '../core/types.ts';
import type { MapId } from '../maps/catalog.ts';
import { Listeners } from '../network/link.ts';
import type { ClientTransport } from '../network/transport.ts';
import { PREDICTED_EVENTS, predictPlayerTick, type PredictionWorld } from './prediction.ts';
import {
  PROTOCOL_VERSION, SNAPSHOT_INTERVAL_TICKS, clampPitch, decodeMessage, encodeMessage, fromNetInput, toNetInput,
  type HostMessage, type LobbyPlayer, type NetInput,
} from './protocol.ts';
import { applySnapshot, type WorldSnapshot } from './snapshot.ts';

/** Remote players and zombies are drawn this far behind the newest snapshot, so there is always a next one. */
export const INTERPOLATION_DELAY_TICKS = 2 * SNAPSHOT_INTERVAL_TICKS;
/** How many recent inputs each input message repeats, so one lost packet costs nothing. */
const INPUT_REDUNDANCY = 8;

export interface StartInfo { map: MapId; seed: number; players: LobbyPlayer[]; slot: number }
/** What the renderer needs from the client each frame. */
export interface ClientFrame {
  /** Snapshot interpolation between `previous` positions and the current state's. */
  alpha: number;
  previous: Map<EntityId, Vec3>;
  /** Host events whose moment has come, oldest first. */
  events: SimulationEvent[];
  /** The fractional host tick being drawn (for animation clocks). */
  tick: number;
  /** A new match began (the host restarted): drop views and effects from the old one. */
  restarted: boolean;
}

/**
 * A joining player's side of a co-op game. It says hello, follows the lobby, and once the host starts
 * it predicts this player's own movement and shooting from local input, corrects to the host's
 * snapshots (smoothly, and replaying inputs the host hasn't used yet), and draws everything else
 * slightly in the past, between snapshots.
 */
export class NetClient {
  phase: 'joining' | 'lobby' | 'game' | 'closed' = 'joining';
  slot: number | null = null;
  map: MapId | null = null;
  players: LobbyPlayer[] = [];
  closeReason: string | null = null;
  readonly changed = new Listeners<void>();
  readonly started = new Listeners<StartInfo>();
  readonly closed = new Listeners<string>();
  readonly notices = new Listeners<string>();

  private simulation: GameSimulation | null = null;
  private playerId: EntityId | null = null;
  private world: PredictionWorld | null = null;
  private predicted: PlayerState | null = null;
  private view = { yaw: 0, pitch: 0 };
  private sequence = 0;
  private pending: NetInput[] = [];
  private sentAt = new Map<number, number>();
  private epoch = 0;
  private buffer: WorldSnapshot[] = [];
  private applied: WorldSnapshot | null = null;
  private renderTick: number | null = null;
  private queuedEvents: Array<{ tick: number; events: SimulationEvent[] }> = [];
  private restartPending = false;
  /** How far the drawn position still trails a correction; it decays to nothing. */
  readonly correction: Vec3 = { x: 0, y: 0, z: 0 };
  /** Round-trip time to the host, smoothed, in milliseconds. */
  pingMs: number | null = null;
  private readonly stops: Array<() => void>;

  constructor(private readonly transport: ClientTransport, name: string, private readonly now: () => number = () => performance.now(),
    /** How far behind the newest snapshot remote entities are drawn, in ticks. */
    private readonly interpolationDelay = INTERPOLATION_DELAY_TICKS) {
    this.stops = [
      transport.onMessage(message => this.receive(message.payload)),
      transport.onLifecycle(event => {
        if (event.type === 'peerDisconnected' || event.type === 'transportClosed') this.finish(event.reason ?? 'Lost the connection to the host.');
      }),
    ];
    transport.sendReliable(encodeMessage({ t: 'hello', v: PROTOCOL_VERSION, name }));
  }

  private finish(reason: string): void {
    if (this.phase === 'closed') return;
    this.phase = 'closed';
    this.closeReason = reason;
    for (const stop of this.stops) stop();
    this.transport.close(reason);
    this.closed.emit(reason);
    this.changed.emit();
  }
  leave(): void { this.finish('You left the game.'); }
  /** Tells the host this player has loaded the map and is ready to play. */
  ready(): void { if (this.phase === 'game') this.transport.sendReliable(encodeMessage({ t: 'ready' })); }

  private receive(payload: Uint8Array): void {
    // The host is trusted: its messages are taken as sent.
    const message = decodeMessage(payload) as HostMessage | null;
    if (!message || this.phase === 'closed') return;
    switch (message.t) {
      case 'welcome': this.slot = message.slot; if (this.phase === 'joining') this.phase = 'lobby'; this.changed.emit(); break;
      case 'lobby': this.map = message.map; this.players = message.players; this.changed.emit(); break;
      case 'reject': this.finish(message.reason); break;
      case 'end': this.finish(message.reason); break;
      case 'start':
        if (this.slot === null) break;
        this.phase = 'game'; this.map = message.map; this.players = message.players;
        this.started.emit({ map: message.map, seed: message.seed, players: message.players, slot: this.slot });
        this.changed.emit();
        break;
      case 'left': this.notices.emit(`${message.name} left the game`); break;
      case 'snap': this.receiveSnapshot(message.ep, message.ack, message.s); break;
      case 'ev': this.receiveEvents(message.ep, message.k, message.e); break;
    }
  }

  /** Starts predicting: `simulation` is a copy of the match built from the map, never ticked here. */
  attach(simulation: GameSimulation, playerId: EntityId, world: PredictionWorld): void {
    this.simulation = simulation; this.playerId = playerId; this.world = world;
    this.predicted = simulation.getPlayer(playerId);
    if (this.predicted) this.view = { yaw: this.predicted.yaw, pitch: this.predicted.pitch };
  }

  private newEpoch(epoch: number): boolean {
    if (epoch < this.epoch) return false;
    if (epoch > this.epoch) {
      this.epoch = epoch; this.buffer = []; this.applied = null; this.renderTick = null;
      this.queuedEvents = []; this.restartPending = true;
    }
    return true;
  }

  private receiveEvents(epoch: number, tick: number, events: SimulationEvent[]): void {
    if (!this.newEpoch(epoch)) return;
    // This player's own shots, reloads and swings were already played from prediction.
    const kept = events.filter(event => !(PREDICTED_EVENTS.has(event.type) && 'playerId' in event && event.playerId === this.playerId));
    if (kept.length) this.queuedEvents.push({ tick, events: kept });
  }

  private receiveSnapshot(epoch: number, ack: number, snapshot: WorldSnapshot): void {
    if (!this.newEpoch(epoch) || !this.simulation) return;
    if (this.buffer.some(held => held.tick === snapshot.tick)) return;
    const newest = this.buffer.length === 0 || snapshot.tick > this.buffer[this.buffer.length - 1].tick;
    this.buffer.push(snapshot);
    this.buffer.sort((a, b) => a.tick - b.tick);
    if (this.buffer.length > 40) this.buffer.splice(0, this.buffer.length - 40);
    if (newest) this.reconcile(snapshot, ack);
  }

  /** Snaps the predicted player to the host's word, then replays the inputs the host hasn't used yet. */
  private reconcile(snapshot: WorldSnapshot, ack: number): void {
    const mine = snapshot.players.find(player => player.id === this.playerId);
    if (!mine || !this.predicted || !this.world) return;
    const sent = this.sentAt.get(ack);
    if (sent !== undefined) {
      const sample = this.now() - sent;
      this.pingMs = this.pingMs === null ? sample : this.pingMs * 0.9 + sample * 0.1;
    }
    for (const sequence of this.sentAt.keys()) if (sequence <= ack) this.sentAt.delete(sequence);
    this.pending = this.pending.filter(input => input.s > ack);
    const before = { ...this.predicted.position };
    Object.assign(this.predicted, structuredClone(mine));
    for (const input of this.pending) predictPlayerTick(this.predicted, fromNetInput(input, this.predicted), this.world, input.s);
    this.predicted.yaw = this.view.yaw; this.predicted.pitch = this.view.pitch;
    const moved = { x: before.x - this.predicted.position.x, y: before.y - this.predicted.position.y, z: before.z - this.predicted.position.z };
    if (Math.hypot(moved.x, moved.y, moved.z) > 2) Object.assign(this.correction, { x: 0, y: 0, z: 0 });
    else { this.correction.x += moved.x; this.correction.y += moved.y; this.correction.z += moved.z; }
  }

  /** One local tick: send the input, predict this player, and return the events to show at once. */
  step(frame: InputFrame): SimulationEvent[] {
    if (this.phase !== 'game' || !this.predicted || !this.world) return [];
    this.view.yaw += frame.look.yaw;
    this.view.pitch = clampPitch(this.view.pitch + frame.look.pitch);
    const input = toNetInput(frame, this.sequence++, this.view.yaw, this.view.pitch);
    this.pending.push(input);
    if (this.pending.length > 180) this.pending.splice(0, this.pending.length - 180);
    this.sentAt.set(input.s, this.now());
    this.transport.sendUnreliable(encodeMessage({ t: 'input', f: this.pending.slice(-INPUT_REDUNDANCY) }));
    // Before the first snapshot there is nothing to correct against; wait in place.
    if (!this.applied) return [];
    return predictPlayerTick(this.predicted, fromNetInput(input, this.predicted), this.world, input.s);
  }

  /**
   * Advances the drawing clock by `deltaSeconds` and brings the local copy of the match to it: remote
   * entities between the two snapshots around it, events up to it, this player as predicted.
   */
  frame(deltaSeconds: number): ClientFrame {
    const empty: ClientFrame = { alpha: 1, previous: new Map(), events: [], tick: this.simulation?.state.world.tick ?? 0,
      restarted: false };
    if (!this.simulation || !this.buffer.length) return empty;
    const restarted = this.restartPending;
    this.restartPending = false;
    const decay = Math.exp(-12 * Math.min(0.1, deltaSeconds));
    this.correction.x *= decay; this.correction.y *= decay; this.correction.z *= decay;
    const target = this.buffer[this.buffer.length - 1].tick - this.interpolationDelay;
    if (this.renderTick === null || Math.abs(this.renderTick - target) > 30) this.renderTick = target;
    else {
      // Drift gently toward the target so late or early snapshots never make the world jump.
      const rate = 1 + Math.max(-0.1, Math.min(0.1, (target - this.renderTick) * 0.02));
      this.renderTick += deltaSeconds * 60 * rate;
    }
    let older = this.buffer[0], newer = this.buffer[0];
    for (const snapshot of this.buffer) {
      if (snapshot.tick <= this.renderTick) older = snapshot;
      if (snapshot.tick > this.renderTick) { newer = snapshot; break; }
      newer = snapshot;
    }
    if (newer !== this.applied) {
      applySnapshot(this.simulation, newer, this.predicted ?? undefined);
      this.applied = newer;
    }
    const previous = new Map<EntityId, Vec3>();
    if (older !== newer) {
      for (const zombie of older.zombies) previous.set(zombie.id, zombie.position);
      for (const player of older.players) if (player.id !== this.playerId) previous.set(player.id, player.position);
    }
    const span = newer.tick - older.tick;
    const alpha = span > 0 ? Math.max(0, Math.min(1, (this.renderTick - older.tick) / span)) : 1;
    const events: SimulationEvent[] = [];
    while (this.queuedEvents.length && this.queuedEvents[0].tick <= this.renderTick) events.push(...this.queuedEvents.shift()!.events);
    return { alpha, previous, events, tick: older.tick + span * alpha, restarted };
  }
}
