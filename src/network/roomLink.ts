import { CodeError } from './codes.ts';
import type { PeerLink } from './link.ts';
import { SignalError, newRoomCode, openSignal, type Signal, type SignalOptions } from './signaling.ts';
import { ICE_SERVERS, connectivityFailure } from './ice.ts';
import { CONNECT_TIMEOUT_MS, ConnectionLog, linkWhenOpen, openChannels, watch } from './webrtc.ts';

/**
 * Browser-to-browser links set up through a room on the game server (see signaling.ts): the host makes a room and shows its code,
 * players join it, and the host's browser offers each of them a connection. The offer, the answer and every network address each
 * browser finds are passed along as they come, so both ends start at once and neither has to wait for a person to paste anything.
 * Once a link is open the server is not involved any more.
 */

const FAILURE = connectivityFailure('room');
/**
 * A player keeps its room connection open this long after its own end comes up. Its browser can be ready a moment before the host's, and the
 * last of the host's addresses may still be on their way, so the room is left only once nothing more is needed from it.
 */
const LINGER_MS = 2500;
/** The things passed along: a session description, or one network address (null: no more coming). */
type Message = { description: { type: 'offer' | 'answer'; sdp: string } } | { candidate: RTCIceCandidateInit | null };

/** One WebRTC connection to one other browser, negotiated through `signal`. */
function negotiate(signal: Signal, peer: number, log: ConnectionLog, timeoutMs: number) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  watch(pc, log);
  const channels = openChannels(pc);
  const send = (message: Message) => signal.send(peer, message);
  pc.addEventListener('icecandidate', event => send({ candidate: event.candidate ? event.candidate.toJSON() : null }));
  const link = linkWhenOpen(pc, channels, timeoutMs, FAILURE);
  link.catch(() => {}); // Reported through the returned promise.
  // Messages are handled one at a time, in the order they arrive: an address can come while the description before it is still being applied.
  let queue: Promise<void> = Promise.resolve();
  const early: RTCIceCandidateInit[] = [];
  let hasRemote = false;
  const addCandidate = (candidate: RTCIceCandidateInit | null) => pc.addIceCandidate(candidate ?? { candidate: '' }).catch(() => {});
  const apply = async (message: Message) => {
    if ('description' in message) {
      await pc.setRemoteDescription(message.description);
      hasRemote = true;
      if (message.description.type === 'offer') {
        await pc.setLocalDescription(await pc.createAnswer());
        send({ description: { type: 'answer', sdp: pc.localDescription!.sdp } });
      }
      for (const candidate of early.splice(0)) await addCandidate(candidate);
    } else if (hasRemote) await addCandidate(message.candidate);
    else if (message.candidate) early.push(message.candidate);
  };
  return {
    link,
    /** The offering side: makes the offer and sends it. */
    async offer() {
      await pc.setLocalDescription(await pc.createOffer());
      send({ description: { type: 'offer', sdp: pc.localDescription!.sdp } });
    },
    handle(data: unknown) {
      if (typeof data !== 'object' || data === null) return;
      queue = queue.then(() => apply(data as Message)).catch(error => log.add(`could not use a message: ${error instanceof Error ? error.message : 'unknown'}`));
    },
    /** Whether the other side has answered: from then on the connection is under way and does not need the room. */
    get answered() { return hasRemote; },
    close: () => { try { pc.close(); } catch { /* already closed */ } },
  };
}

export interface RoomHostHandlers {
  /**
   * A player's connection is open. `id` is their number in the room (1 to 3), which the next player to come takes again once they have left
   * the room; `serial` is 1 for the first connection made, 2 for the next, and so on, and is never reused: use it to tell connections apart.
   */
  onPeer(link: PeerLink, id: number, serial: number): void;
  /** A player joined the room but their connection did not come up. */
  onPeerFailed?(id: number, message: string): void;
  /** The connection to the server ended. Players already connected are not affected; new ones cannot join. */
  onServerLost?(reason?: string): void;
}
export interface RoomHost {
  readonly room: string;
  /** What happened, for a player to send back if something did not work. */
  log(): string;
  close(): void;
}

/** Makes a room and offers a connection to everyone who joins it. */
export async function hostRoom(handlers: RoomHostHandlers, options: SignalOptions = {}): Promise<RoomHost> {
  let signal: Signal | null = null, room = '';
  // A code someone else is using is refused; a new one is tried.
  for (let attempt = 0; !signal; attempt++) {
    room = newRoomCode();
    try { signal = await openSignal(room, 'host', options); } catch (error) {
      if (!(error instanceof SignalError && error.reason === 'room-in-use') || attempt >= 5) throw error;
    }
  }
  const opened = signal;
  const log = new ConnectionLog();
  log.add(`room ${room} open`);
  const sessions = new Map<number, { session: ReturnType<typeof negotiate>; log: ConnectionLog }>();
  const finished: Array<{ id: number; log: ConnectionLog }> = [];
  let closing = false, serial = 0;
  opened.onPeerJoined(id => {
    log.add(`player ${id} joined`);
    const mine = ++serial;
    const peerLog = new ConnectionLog();
    const session = negotiate(opened, id, peerLog, options.timeoutMs ?? CONNECT_TIMEOUT_MS);
    sessions.set(id, { session, log: peerLog });
    session.link.then(link => { sessions.delete(id); finished.push({ id, log: peerLog }); handlers.onPeer(link, id, mine); },
      error => { sessions.delete(id); finished.push({ id, log: peerLog }); session.close(); handlers.onPeerFailed?.(id, error instanceof Error ? error.message : FAILURE); });
    session.offer().catch(() => { session.close(); });
  });
  opened.onSignal((from, data) => sessions.get(from)?.session.handle(data));
  opened.onPeerLeft(id => {
    log.add(`player ${id} left the room`);
    // A player who leaves before answering is dropped; one who has answered is connecting, and is left to connect or time out. Their browser
    // can be ready before the host's and leave the room straight away.
    const pending = sessions.get(id);
    if (pending && !pending.session.answered) { sessions.delete(id); pending.session.close(); }
  });
  opened.onClose(reason => { if (!closing) { log.add('server connection lost'); handlers.onServerLost?.(reason); } });
  return {
    room,
    log: () => [log.text(), ...[...finished, ...[...sessions].map(([id, entry]) => ({ id, log: entry.log }))]
      .map(({ id, log: peerLog }) => `-- player ${id}\n${peerLog.text()}`)].join('\n'),
    close: () => { closing = true; for (const { session } of sessions.values()) session.close(); sessions.clear(); opened.close(); },
  };
}

export interface RoomJoin {
  /** Resolves with the link to the host once it is open. */
  readonly connected: Promise<PeerLink>;
  log(): string;
  cancel(): void;
}

/**
 * Joins a room. Rejects (with a SignalError saying why) if there is no such room or it is full; otherwise `connected` settles once the host
 * has offered a connection and it has come up, or failed.
 */
export async function joinRoom(room: string, options: SignalOptions = {}): Promise<RoomJoin> {
  const signal = await openSignal(room, 'join', options);
  const log = new ConnectionLog();
  const peerLog = new ConnectionLog();
  log.add(`joined room ${room} as player ${signal.id}`);
  let session: ReturnType<typeof negotiate> | null = null, done = false;
  let fail: (error: Error) => void = () => {};
  const failed = new Promise<never>((_, reject) => { fail = reject; });
  const timeoutMs = options.timeoutMs ?? CONNECT_TIMEOUT_MS;
  const timer = setTimeout(() => { fail(new CodeError('The host did not offer a connection. Check they are still on the Host Game screen, and try again.')); }, timeoutMs + 5000);
  // The connection is made when the host's offer arrives.
  let sessionMade: (made: ReturnType<typeof negotiate>) => void = () => {};
  const offered = new Promise<ReturnType<typeof negotiate>>(resolve => { sessionMade = resolve; });
  signal.onSignal((from, data) => {
    if (from !== 0) return;
    if (!session) { session = negotiate(signal, 0, peerLog, timeoutMs); sessionMade(session); }
    session.handle(data);
  });
  signal.onHostLeft(() => { log.add('host left'); fail(new CodeError('The host closed the game.')); });
  signal.onClose(reason => { if (!done && reason) fail(new CodeError(reason)); });
  const connected = Promise.race([offered.then(made => made.link), failed]);
  const finish = (linger: boolean) => {
    done = true; clearTimeout(timer);
    if (linger) setTimeout(() => signal.close(), LINGER_MS); else signal.close();
  };
  connected.then(() => finish(true), () => { finish(false); session?.close(); });
  connected.catch(() => {}); // Reported through the returned promise.
  return {
    connected,
    log: () => [log.text(), '-- host', peerLog.text()].join('\n'),
    cancel: () => { done = true; clearTimeout(timer); session?.close(); signal.close(); fail(new CodeError('Cancelled.')); },
  };
}
