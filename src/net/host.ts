import type { InputFrame } from '../core/input.ts';
import type { GameSimulation, PlayerPresenceState, SimulationEvent } from '../core/simulation.ts';
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
  reconnectToken: string | null;
  /** Inputs received and not yet used, in sequence order. */
  queue: NetInput[];
  /** The last input used (its buttons repeat, without presses, if the next is late). */
  last: NetInput | null;
  ready: boolean;
}
interface Reservation {
  token: string;
  slot: number;
  name: string;
  playerId: EntityId | null;
  disconnectedAt: number | null;
  presence: PlayerPresenceState | null;
}

export const RECONNECT_WINDOW_MS = 30_000;
export interface HostNotice { kind: 'joined' | 'left' | 'returned'; name: string }

/**
 * The host's side of a co-op game. In the lobby it admits players (up to four, same protocol version);
 * once the match starts it feeds each remote player's inputs into the host's simulation and sends
 * every client a snapshot 20 times a second plus every event as it happens.
 */
export class NetHost {
  private readonly peers = new Map<PeerId, Peer>();
  private readonly reservations = new Map<string, Reservation>();
  private phase: 'lobby' | 'game' | 'closed' = 'lobby';
  private simulation: GameSimulation | null = null;
  private epoch = 0;
  private started: LobbyPlayer[] = [];
  private startedSeed: number | null = null;
  readonly changed = new Listeners<void>();
  readonly notices = new Listeners<HostNotice>();
  private readonly stops: Array<() => void>;
  private readonly cleanup: Array<() => void> = [];

  constructor(private readonly transport: HostTransport, private hostName: string, readonly map: MapId,
    /** Ticks between snapshots: 3 sends 20 a second. */
    private readonly snapshotInterval = SNAPSHOT_INTERVAL_TICKS,
    private readonly now: () => number = () => performance.now()) {
    this.stops = [
      transport.onMessage(message => this.receive(message.peerId, message.payload)),
      transport.onLifecycle(event => {
        if (event.type === 'peerConnected') {
          this.peers.set(event.peerId, { peerId: event.peerId, name: null, slot: null, playerId: null,
            reconnectToken: null, queue: [], last: null, ready: false });
        } else if (event.type === 'peerDisconnected') this.drop(event.peerId);
      }),
    ];
  }

  /** Everyone in the lobby, the host first. Slots are host-assigned and stay stable while a player is connected. */
  lobby(): LobbyPlayer[] {
    if (this.phase !== 'lobby') return this.started;
    const joined = [...this.peers.values()]
      .filter((peer): peer is Peer & { name: string; slot: number } => peer.name !== null && peer.slot !== null)
      .sort((a, b) => a.slot - b.slot);
    return [{ slot: 0, name: this.hostName }, ...joined.map(peer => ({ slot: peer.slot, name: peer.name }))];
  }
  setHostName(name: string): void { this.hostName = cleanName(name, 'Player 1'); this.broadcastLobby(); }
  get inGame(): boolean { return this.phase === 'game'; }

  /** Resources owned by the lobby transport (such as its signalling room) close with the host. */
  addCleanup(cleanup: () => void): void { this.cleanup.push(cleanup); }

  private send(peerId: PeerId, message: HostMessage): void { this.transport.sendReliable(peerId, encodeMessage(message)); }
  private broadcastLobby(): void {
    if (this.phase !== 'lobby') return;
    const players = this.lobby();
    for (const peer of this.peers.values()) {
      if (peer.name === null || peer.slot === null || !peer.reconnectToken) continue;
      this.send(peer.peerId, { t: 'welcome', slot: peer.slot, resume: peer.reconnectToken });
      this.send(peer.peerId, { t: 'lobby', map: this.map, players });
    }
    this.changed.emit();
  }

  private receive(peerId: PeerId, payload: Uint8Array): void {
    const peer = this.peers.get(peerId);
    const message = peer && readClientMessage(payload);
    if (!peer || !message) return;
    if (message.t === 'hello') {
      if (peer.name !== null) return;
      if (message.v !== PROTOCOL_VERSION) {
        this.send(peerId, { t: 'reject', reason: 'The host is running a different version of the game. Both of you should reload the page.' });
        return;
      }

      // A disconnected slot is reserved briefly. Expired lobby reservations stop occupying a slot; expired game tokens can no longer resume.
      for (const [token, reservation] of this.reservations) {
        if (reservation.disconnectedAt !== null && this.now() - reservation.disconnectedAt > RECONNECT_WINDOW_MS) {
          this.reservations.delete(token);
        }
      }
      const reservation = message.resume ? this.reservations.get(message.resume) : undefined;
      if (reservation && reservation.disconnectedAt === null) {
        this.send(peerId, { t: 'reject', reason: 'That player is already connected.' });
        return;
      }
      if (reservation && reservation.disconnectedAt !== null) {
        peer.name = reservation.name; peer.slot = reservation.slot; peer.playerId = reservation.playerId;
        peer.reconnectToken = reservation.token; peer.ready = this.phase === 'game';
        peer.queue = []; peer.last = null;
        reservation.disconnectedAt = null;
        if (this.phase === 'game') {
          if (this.simulation && reservation.playerId && reservation.presence) {
            this.simulation.restorePlayer(reservation.playerId, reservation.presence);
            reservation.presence = null;
          }
          this.send(peerId, { t: 'welcome', slot: reservation.slot, resume: reservation.token });
          if (this.startedSeed !== null) this.send(peerId, { t: 'start', map: this.map, seed: this.startedSeed, players: this.started });
          if (this.simulation && reservation.playerId) {
            const body = encodeSnapshotBody(captureSnapshot(this.simulation));
            this.transport.sendUnreliable(peerId, encodeSnapshotMessage(this.epoch, -1, body));
          }
          this.transport.broadcastReliable(encodeMessage({ t: 'returned', slot: reservation.slot, name: reservation.name }));
          this.notices.emit({ kind: 'returned', name: reservation.name });
          this.changed.emit();
        } else {
          this.notices.emit({ kind: 'returned', name: reservation.name });
          this.broadcastLobby();
        }
        return;
      }

      if (this.phase !== 'lobby') {
        this.send(peerId, { t: 'reject', reason: message.resume
          ? 'Your reconnect window expired. The match is still running, but that player slot can no longer be reclaimed.'
          : 'That game has already started.' });
        return;
      }
      const used = new Set([...this.reservations.values()].map(entry => entry.slot));
      const slot = Array.from({ length: MAX_PLAYERS - 1 }, (_, index) => index + 1).find(candidate => !used.has(candidate));
      if (slot === undefined) { this.send(peerId, { t: 'reject', reason: 'That game is full.' }); return; }
      const name = cleanName(message.name, `Player ${slot + 1}`);
      const token = crypto.randomUUID();
      peer.name = name; peer.slot = slot; peer.reconnectToken = token;
      this.reservations.set(token, { token, slot, name, playerId: null, disconnectedAt: null, presence: null });
      this.notices.emit({ kind: 'joined', name });
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
    const reservation = peer.reconnectToken ? this.reservations.get(peer.reconnectToken) : undefined;
    if (reservation) reservation.disconnectedAt = this.now();
    this.notices.emit({ kind: 'left', name: peer.name });
    if (this.phase === 'lobby') {
      if (peer.reconnectToken) this.reservations.delete(peer.reconnectToken);
      this.broadcastLobby();
      return;
    }
    if (peer.playerId && this.simulation) {
      const presence = this.simulation.removePlayer(peer.playerId);
      if (reservation) { reservation.playerId = peer.playerId; reservation.presence = presence; }
    }
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
    const joined = [...this.peers.values()]
      .filter((peer): peer is Peer & { name: string; slot: number; reconnectToken: string } =>
        peer.name !== null && peer.slot !== null && peer.reconnectToken !== null)
      .sort((a, b) => a.slot - b.slot);
    // A lobby drop only reserves a place until the match begins. Compact the connected players into the authoritative match slots.
    const activeTokens = new Set(joined.map(peer => peer.reconnectToken));
    for (const token of this.reservations.keys()) if (!activeTokens.has(token)) this.reservations.delete(token);
    joined.forEach((peer, index) => {
      peer.slot = index + 1;
      const reservation = this.reservations.get(peer.reconnectToken);
      if (reservation) reservation.slot = peer.slot;
      this.send(peer.peerId, { t: 'welcome', slot: peer.slot, resume: peer.reconnectToken });
    });
    const players = [{ slot: 0, name: this.hostName }, ...joined.map(peer => ({ slot: peer.slot, name: peer.name }))];
    // Anyone still connecting when the match starts is turned away.
    for (const peer of [...this.peers.values()]) if (peer.name === null) this.transport.disconnect?.(peer.peerId);
    this.phase = 'game';
    this.started = players;
    this.startedSeed = seed;
    this.startedAt = now;
    this.transport.broadcastReliable(encodeMessage({ t: 'start', map: this.map, seed, players }));
    this.changed.emit();
    return players;
  }

  /** Hands the host's simulation over, built with one player per slot. */
  attach(simulation: GameSimulation): void {
    this.simulation = simulation;
    for (const reservation of this.reservations.values()) {
      reservation.playerId = simulation.playerIds[reservation.slot] ?? null;
      if (reservation.disconnectedAt !== null && reservation.playerId) {
        reservation.presence = simulation.removePlayer(reservation.playerId);
      }
    }
    for (const peer of this.peers.values()) {
      if (!peer.reconnectToken) continue;
      peer.playerId = this.reservations.get(peer.reconnectToken)?.playerId ?? null;
    }
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
    if (events.some(event => event.type === 'matchRestarted')) {
      this.epoch += 1;
      // A reconnect during the new match returns as the fresh player that restart created, not with stale last-stand state.
      for (const reservation of this.reservations.values()) {
        if (reservation.disconnectedAt !== null) reservation.presence = { alive: true, downed: null };
      }
    }
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
    for (const cleanup of this.cleanup.splice(0)) cleanup();
  }
}
