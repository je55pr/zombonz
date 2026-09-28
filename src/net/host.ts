import type { InputFrame } from '../core/input.ts';
import type { GameSimulation, SimulationEvent } from '../core/simulation.ts';
import type { EntityId } from '../core/types.ts';
import type { MapId } from '../maps/catalog.ts';
import { Listeners } from '../network/link.ts';
import type { HostTransport, PeerId } from '../network/transport.ts';
import {
  MAX_PLAYERS, PROTOCOL_VERSION, SNAPSHOT_INTERVAL_TICKS, cleanName, encodeMessage, encodeSnapshotBody,
  encodeSnapshotMessage, fromNetInput, mergeNetInputs, readClientMessage, type HostMessage, type LobbyPlayer, type NetInput,
} from './protocol.ts';
import { captureSnapshot } from './snapshot.ts';

interface Peer {
  peerId: PeerId;
  name: string | null;
  slot: number | null;
  playerId: EntityId | null;
  /** Inputs received and not yet used, in sequence order. */
  queue: NetInput[];
  /** The last input used (its buttons repeat, without presses, if the next is late). */
  last: NetInput | null;
  ready: boolean;
}
export interface HostNotice { kind: 'joined' | 'left'; name: string }

/**
 * The host's side of a co-op game. In the lobby it admits players (up to four, same protocol version);
 * once the match starts it feeds each remote player's inputs into the host's simulation and sends
 * every client a snapshot 20 times a second plus every event as it happens.
 */
export class NetHost {
  private readonly peers = new Map<PeerId, Peer>();
  private phase: 'lobby' | 'game' | 'closed' = 'lobby';
  private simulation: GameSimulation | null = null;
  private epoch = 0;
  private started: LobbyPlayer[] = [];
  readonly changed = new Listeners<void>();
  readonly notices = new Listeners<HostNotice>();
  private readonly stops: Array<() => void>;

  constructor(private readonly transport: HostTransport, private hostName: string, readonly map: MapId,
    /** Ticks between snapshots: 3 sends 20 a second. */
    private readonly snapshotInterval = SNAPSHOT_INTERVAL_TICKS) {
    this.stops = [
      transport.onMessage(message => this.receive(message.peerId, message.payload)),
      transport.onLifecycle(event => {
        if (event.type === 'peerConnected') {
          this.peers.set(event.peerId, { peerId: event.peerId, name: null, slot: null, playerId: null, queue: [], last: null, ready: false });
        } else if (event.type === 'peerDisconnected') this.drop(event.peerId);
      }),
    ];
  }

  /** Everyone in the lobby, the host first. */
  lobby(): LobbyPlayer[] {
    if (this.phase !== 'lobby') return this.started;
    const joined = [...this.peers.values()].filter(peer => peer.name !== null);
    return [{ slot: 0, name: this.hostName }, ...joined.map((peer, index) => ({ slot: index + 1, name: peer.name! }))];
  }
  setHostName(name: string): void { this.hostName = cleanName(name, 'Player 1'); this.broadcastLobby(); }
  get inGame(): boolean { return this.phase === 'game'; }

  private send(peerId: PeerId, message: HostMessage): void { this.transport.sendReliable(peerId, encodeMessage(message)); }
  private broadcastLobby(): void {
    if (this.phase !== 'lobby') return;
    const players = this.lobby();
    [...this.peers.values()].filter(peer => peer.name !== null).forEach((peer, index) => {
      this.send(peer.peerId, { t: 'welcome', slot: index + 1 });
      this.send(peer.peerId, { t: 'lobby', map: this.map, players });
    });
    this.changed.emit();
  }

  private receive(peerId: PeerId, payload: Uint8Array): void {
    const peer = this.peers.get(peerId);
    const message = peer && readClientMessage(payload);
    if (!peer || !message) return;
    if (message.t === 'hello') {
      if (peer.name !== null) return;
      const joined = [...this.peers.values()].filter(other => other.name !== null).length;
      const reason = message.v !== PROTOCOL_VERSION ? 'The host is running a different version of the game. Both of you should reload the page.'
        : this.phase !== 'lobby' ? 'That game has already started.'
          : joined + 1 >= MAX_PLAYERS ? 'That game is full.' : null;
      if (reason) { this.send(peerId, { t: 'reject', reason }); return; }
      peer.name = cleanName(message.name, `Player ${joined + 2}`);
      this.notices.emit({ kind: 'joined', name: peer.name });
      this.broadcastLobby();
      return;
    }
    if (message.t === 'ready') { peer.ready = true; this.changed.emit(); return; }
    if (message.t === 'input' && this.phase === 'game' && peer.playerId) {
      const lastUsed = peer.last?.s ?? -1;
      for (const input of message.f) {
        if (input.s <= lastUsed || peer.queue.some(queued => queued.s === input.s)) continue;
        peer.queue.push(input);
      }
      peer.queue.sort((a, b) => a.s - b.s);
      // A client far ahead (a long stall) keeps only its latest second of inputs.
      if (peer.queue.length > 60) peer.queue.splice(0, peer.queue.length - 60);
    }
  }

  private drop(peerId: PeerId): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    if (peer.name === null) return;
    this.notices.emit({ kind: 'left', name: peer.name });
    if (this.phase === 'lobby') { this.broadcastLobby(); return; }
    if (peer.playerId && this.simulation) this.simulation.removePlayer(peer.playerId);
    if (peer.slot !== null) this.transport.broadcastReliable(encodeMessage({ t: 'left', slot: peer.slot, name: peer.name }));
    this.changed.emit();
  }

  private startedAt = 0;
  /** Whether every player has loaded (or 20 seconds have passed), so the match can begin. */
  everyoneReady(now = performance.now()): boolean {
    return now - this.startedAt > 20_000 || [...this.peers.values()].every(peer => peer.slot === null || peer.ready);
  }

  /** Closes the lobby and tells every client to start; returns the players by slot. */
  start(seed: number, now = performance.now()): LobbyPlayer[] {
    if (this.phase !== 'lobby') throw new Error('The match has already started.');
    const players = this.lobby();
    const joined = [...this.peers.values()].filter(peer => peer.name !== null);
    joined.forEach((peer, index) => { peer.slot = index + 1; });
    // Anyone still connecting when the match starts is turned away.
    for (const peer of [...this.peers.values()]) if (peer.name === null) this.transport.disconnect?.(peer.peerId);
    this.phase = 'game';
    this.started = players;
    this.startedAt = now;
    this.transport.broadcastReliable(encodeMessage({ t: 'start', map: this.map, seed, players }));
    this.changed.emit();
    return players;
  }

  /** Hands the host's simulation over, built with one player per slot. */
  attach(simulation: GameSimulation): void {
    this.simulation = simulation;
    for (const peer of this.peers.values()) if (peer.slot !== null) peer.playerId = simulation.playerIds[peer.slot] ?? null;
  }

  /** This tick's input for each remote player, keyed by player id, to pass to `GameSimulation.tick`. */
  inputs(): Record<EntityId, InputFrame> {
    const frames: Record<EntityId, InputFrame> = {};
    if (!this.simulation) return frames;
    for (const peer of this.peers.values()) {
      const player = peer.playerId && this.simulation.getPlayer(peer.playerId);
      if (!player) continue;
      let input: NetInput | null = null;
      if (peer.queue.length > 4) {
        // Behind the client: fold the backlog into this tick so the queue drains to a small cushion.
        input = mergeNetInputs(peer.queue.splice(0, peer.queue.length - 2));
      } else if (peer.queue.length) input = peer.queue.shift()!;
      if (input) peer.last = input;
      else if (peer.last) input = { ...peer.last, p: 0, r: 0 }; // Late: hold the buttons, press nothing new.
      if (input) frames[player.id] = fromNetInput(input, player);
    }
    return frames;
  }

  /** After each simulation tick: sends its events, and a snapshot every few ticks. */
  publish(events: readonly SimulationEvent[]): void {
    if (!this.simulation || this.phase !== 'game') return;
    if (events.some(event => event.type === 'matchRestarted')) this.epoch += 1;
    const tick = this.simulation.state.world.tick;
    if (events.length) this.transport.broadcastReliable(encodeMessage({ t: 'ev', ep: this.epoch, k: tick, e: [...events] }));
    if (tick % this.snapshotInterval !== 0 && !events.some(event => event.type === 'matchRestarted')) return;
    const body = encodeSnapshotBody(captureSnapshot(this.simulation));
    for (const peer of this.peers.values()) {
      if (peer.playerId) this.transport.sendUnreliable(peer.peerId, encodeSnapshotMessage(this.epoch, peer.last?.s ?? -1, body));
    }
  }

  close(reason = 'The host left the game.'): void {
    if (this.phase === 'closed') return;
    this.phase = 'closed';
    this.transport.broadcastReliable(encodeMessage({ t: 'end', reason }));
    for (const stop of this.stops) stop();
    this.transport.close(reason);
  }
}
