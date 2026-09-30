import { Listeners } from './link.ts';
import type { Unsubscribe } from './transport.ts';

/**
 * The game's side of the room server (server/): a WebSocket into a room, over which the browsers in it pass each other what a WebRTC
 * connection is set up with. It carries no game traffic. Where the server is: `VITE_SIGNAL_URL` if this build was given one, otherwise the
 * address the game was loaded from (the server serves the game too). A copy of the game with no server (GitHub Pages, say) is told so by
 * `signalAvailable`, and uses connection codes instead.
 */

/** Room codes avoid the letters and digits that look like each other (no 0, 1, I, L or O). */
export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;

/** A new room code, five characters from the alphabet above (about 28 million of them). */
export function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  // The tiny bias towards the first few characters does not matter: a code is only the name of a room, not a secret.
  let code = '';
  for (const byte of bytes) code += ROOM_ALPHABET[byte % ROOM_ALPHABET.length];
  return code;
}

/** What a player typed, as a room code, or null if it cannot be one. Spaces and dashes are ignored, and case does not matter. */
export function normaliseRoomCode(text: string): string | null {
  const code = text.toUpperCase().replace(/[\s-]+/g, '');
  return code.length >= 4 && code.length <= 8 && [...code].every(char => ROOM_ALPHABET.includes(char)) ? code : null;
}

export class SignalError extends Error {
  constructor(readonly reason: string, message: string) { super(message); }
}

const MESSAGES: Record<string, string> = {
  'no-room': 'No game with that code. Check it with the host, and that they are still on the Host Game screen.',
  'full': 'That game is full.',
  'room-in-use': 'That room code is already in use.',
  'expired': 'That room was open too long and has closed.',
  'too-fast': 'Too many messages too quickly, so the server closed the connection.',
  'bad-message': 'The server did not understand a message and closed the connection.',
  'too-large': 'A message was too large for the server.',
};

/** Where the room server is, as an http(s) address with no trailing slash. */
export function signalBase(): string {
  const configured = (import.meta.env?.VITE_SIGNAL_URL as string | undefined)?.trim();
  return (configured || location.origin).replace(/\/+$/, '');
}

/** The WebSocket address of a room. */
export function signalUrl(base: string, room: string, role: 'host' | 'join'): string {
  const url = new URL(`/signal/${room}`, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (role === 'host') url.searchParams.set('role', 'host');
  return url.toString();
}

/** Whether there is a room server at `base`: it answers /signal/health. False on a copy of the game that has none. */
export async function signalAvailable(base: string = signalBase(), timeoutMs = 2500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL('/signal/health', base), { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return false;
    const body = await response.json() as { ok?: unknown; service?: unknown };
    return body.ok === true && body.service === 'zombonz-rooms';
  } catch { return false; } finally { clearTimeout(timer); }
}

/** One connection into a room. Signals that arrive before anyone is listening are kept for the first listener. */
export interface Signal {
  /** 0 for the host, 1 to 3 for the others. */
  readonly id: number;
  readonly room: string;
  send(to: number, data: unknown): void;
  onSignal(listener: (from: number, data: unknown) => void): Unsubscribe;
  onPeerJoined(listener: (id: number) => void): Unsubscribe;
  onPeerLeft(listener: (id: number) => void): Unsubscribe;
  onHostLeft(listener: () => void): Unsubscribe;
  /** The connection to the server ended, and why, if it says. */
  onClose(listener: (reason?: string) => void): Unsubscribe;
  close(): void;
}

export interface SignalOptions {
  /** The server, as an http(s) address; the game's own by default. */
  base?: string;
  /** How long to wait for the server to answer. */
  timeoutMs?: number;
  /** For tests. */
  WebSocketImpl?: typeof WebSocket;
}

/** Opens a room: as the host (making it) or as a player (joining it). Resolves once the server has said hello. */
export function openSignal(room: string, role: 'host' | 'join', options: SignalOptions = {}): Promise<Signal> {
  const { base = signalBase(), timeoutMs = 8000, WebSocketImpl = WebSocket } = options;
  return new Promise((resolve, reject) => {
    let socket: WebSocket;
    try { socket = new WebSocketImpl(signalUrl(base, room, role)); } catch {
      reject(new SignalError('unreachable', 'Could not reach the game server.')); return;
    }
    const signals = new Listeners<[number, unknown]>(), joined = new Listeners<number>(), left = new Listeners<number>();
    const hostLeft = new Listeners<undefined>(), closes = new Listeners<string | undefined>();
    const early: Array<[number, unknown]> = [];
    let hello: { id: number } | null = null, settled = false, refusal: string | null = null;
    const fail = (error: SignalError) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); try { socket.close(); } catch { /* already closed */ } } };
    const timer = setTimeout(() => fail(new SignalError('unreachable', 'The game server did not answer. Check your connection and try again.')), timeoutMs);
    socket.addEventListener('message', event => {
      let message: { t?: string; id?: number; from?: number; data?: unknown; reason?: string };
      try { message = JSON.parse(String(event.data)); } catch { return; }
      switch (message.t) {
        case 'hello':
          if (typeof message.id !== 'number' || settled) return;
          hello = { id: message.id }; settled = true; clearTimeout(timer);
          resolve({
            id: message.id, room,
            send: (to, data) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ t: 'signal', to, data })); },
            onSignal: listener => {
              const off = signals.add(([from, data]) => listener(from, data));
              for (const [from, data] of early.splice(0)) listener(from, data);
              return off;
            },
            onPeerJoined: listener => joined.add(listener),
            onPeerLeft: listener => left.add(listener),
            onHostLeft: listener => hostLeft.add(() => listener()),
            onClose: listener => closes.add(listener),
            close: () => { try { socket.close(1000, 'done'); } catch { /* already closed */ } },
          });
          break;
        case 'signal':
          if (typeof message.from !== 'number') return;
          if (signals.size === 0) early.push([message.from, message.data]); else signals.emit([message.from, message.data]);
          break;
        case 'peer-joined': if (typeof message.id === 'number') joined.emit(message.id); break;
        case 'peer-left': if (typeof message.id === 'number') left.emit(message.id); break;
        case 'host-left': hostLeft.emit(undefined); break;
        case 'error': refusal = message.reason ?? 'unknown'; fail(new SignalError(refusal, MESSAGES[refusal] ?? 'The game server refused the connection.')); break;
      }
    });
    socket.addEventListener('error', () => fail(new SignalError('unreachable', 'Could not reach the game server.')));
    socket.addEventListener('close', () => {
      if (!hello) fail(new SignalError(refusal ?? 'unreachable', refusal ? MESSAGES[refusal] ?? 'The game server refused the connection.' : 'Could not reach the game server.'));
      closes.emit(refusal ? MESSAGES[refusal] : undefined);
    });
  });
}
