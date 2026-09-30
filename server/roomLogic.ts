/**
 * The rules of one room on the game server: a host and up to three players who pass each other the messages a WebRTC
 * connection is set up with (offers, answers, network addresses). The server never sees a game: once two browsers are connected
 * they talk to each other directly. No Cloudflare types are used here, so it can be tested on its own; `room.ts` wires it to a
 * Durable Object.
 *
 * Everyone in a room has a number: the host is 0, players are 1 to 3. A player can only write to the host, the host to any player.
 */

/** Same as MAX_PLAYERS in src/net/protocol.ts (a test checks they match): the host and three others. */
export const MAX_IN_ROOM = 4;
/** A WebRTC offer is a couple of kilobytes; nothing here needs more than this. */
export const MAX_MESSAGE_CHARS = 16 * 1024;
/** More messages than this in a window closes the connection: a real connection sends a few dozen in its first second. */
export const RATE_LIMIT = { messages: 80, windowMs: 10_000 };
/** A room closes this long after it opened: setting up a connection takes seconds, and this only stops one being left open forever. */
export const ROOM_LIFETIME_MS = 30 * 60 * 1000;

export type Role = 'host' | 'join';

export type ToClient =
  | { t: 'hello'; role: Role; room: string; id: number }
  | { t: 'peer-joined'; id: number }
  | { t: 'peer-left'; id: number }
  | { t: 'host-left' }
  | { t: 'signal'; from: number; data: unknown }
  | { t: 'error'; reason: ErrorReason };
export type ErrorReason = 'no-room' | 'full' | 'room-in-use' | 'bad-message' | 'too-large' | 'too-fast' | 'expired';

/** Close codes (4000 and up are ours to use). */
export const CLOSE = {
  refused: 4001, badMessage: 4002, tooLarge: 4003, tooFast: 4029, expired: 4008, hostLeft: 4010,
} as const;

/** One connection, as the room sees it. */
export interface Peer {
  send(message: ToClient): void;
  close(code: number, reason: string): void;
}

export class RoomLogic {
  private host: Peer | null = null;
  private readonly players = new Map<number, Peer>();
  /** Recent message times for each connection, for the rate limit. */
  private readonly recent = new Map<Peer, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  /** How many are in the room. */
  get size(): number { return (this.host ? 1 : 0) + this.players.size; }

  private peer(id: number): Peer | undefined { return id === 0 ? this.host ?? undefined : this.players.get(id); }
  private refuse(peer: Peer, reason: ErrorReason): null {
    peer.send({ t: 'error', reason });
    peer.close(CLOSE.refused, reason);
    return null;
  }

  /** Adds a connection to the room. Returns its number, or null if it was refused (and told why, and closed). */
  connect(role: Role, room: string, peer: Peer): number | null {
    if (role === 'host') {
      if (this.host) return this.refuse(peer, 'room-in-use');
      this.host = peer;
      peer.send({ t: 'hello', role, room, id: 0 });
      return 0;
    }
    if (!this.host) return this.refuse(peer, 'no-room');
    if (this.size >= MAX_IN_ROOM) return this.refuse(peer, 'full');
    let id = 1;
    while (this.players.has(id)) id++;
    this.players.set(id, peer);
    peer.send({ t: 'hello', role, room, id });
    this.host.send({ t: 'peer-joined', id });
    return id;
  }

  /** A text frame from connection `id`: a signal for someone else in the room, or something to refuse. */
  message(id: number, text: unknown): void {
    const from = this.peer(id);
    if (!from) return;
    if (typeof text !== 'string') return this.reject(from, 'bad-message', CLOSE.badMessage);
    if (text.length > MAX_MESSAGE_CHARS) return this.reject(from, 'too-large', CLOSE.tooLarge);
    const now = this.now();
    const times = (this.recent.get(from) ?? []).filter(time => now - time < RATE_LIMIT.windowMs);
    times.push(now);
    this.recent.set(from, times);
    if (times.length > RATE_LIMIT.messages) return this.reject(from, 'too-fast', CLOSE.tooFast);
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return this.reject(from, 'bad-message', CLOSE.badMessage); }
    if (typeof parsed !== 'object' || parsed === null) return this.reject(from, 'bad-message', CLOSE.badMessage);
    const { t, to, data } = parsed as { t?: unknown; to?: unknown; data?: unknown };
    if (t !== 'signal' || typeof to !== 'number' || !Number.isInteger(to) || data === undefined) return this.reject(from, 'bad-message', CLOSE.badMessage);
    // A player can only write to the host; the host to a player. Anything else is quietly dropped: it is a stale message for someone who has left.
    if (id !== 0 && to !== 0) return;
    if (id === 0 && to === 0) return;
    this.peer(to)?.send({ t: 'signal', from: id, data });
  }

  private reject(peer: Peer, reason: ErrorReason, code: number): void {
    peer.send({ t: 'error', reason });
    peer.close(code, reason);
  }

  /** Connection `id` has gone. A player leaving is told to the host; the host leaving ends the room. */
  disconnect(id: number): void {
    const peer = this.peer(id);
    if (!peer) return;
    this.recent.delete(peer);
    if (id === 0) {
      this.host = null;
      for (const player of this.players.values()) {
        player.send({ t: 'host-left' });
        player.close(CLOSE.hostLeft, 'The host left');
      }
      this.players.clear();
      return;
    }
    this.players.delete(id);
    this.host?.send({ t: 'peer-left', id });
  }

  /** Closes everyone, for a room that has been open too long. */
  expire(): void {
    for (const peer of [this.host, ...this.players.values()]) {
      if (!peer) continue;
      peer.send({ t: 'error', reason: 'expired' });
      peer.close(CLOSE.expired, 'expired');
    }
  }
}
