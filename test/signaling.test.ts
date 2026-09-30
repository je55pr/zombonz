import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ROOM_ALPHABET, ROOM_CODE_LENGTH, SignalError, newRoomCode, normaliseRoomCode, openSignal, signalAvailable, signalBase, signalUrl,
} from '../src/network/signaling.ts';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('room codes', () => {
  it('are five characters from an alphabet with nothing that looks like something else', () => {
    expect(ROOM_ALPHABET).not.toMatch(/[01ILO]/);
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const code = newRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect([...code].every(char => ROOM_ALPHABET.includes(char)), code).toBe(true);
      seen.add(code);
    }
    // Not the same one every time.
    expect(seen.size).toBeGreaterThan(290);
  });

  it('are read from what a player types: any case, with spaces and dashes ignored', () => {
    expect(normaliseRoomCode('k7qx2')).toBe('K7QX2');
    expect(normaliseRoomCode('  K7-QX2 ')).toBe('K7QX2');
    expect(normaliseRoomCode('k7 qx 2')).toBe('K7QX2');
    expect(normaliseRoomCode('ABCD')).toBe('ABCD');
    expect(normaliseRoomCode('ABCDEFGH')).toBe('ABCDEFGH');
  });

  it('are refused when they cannot be one: too short, too long, or with letters that are not in the alphabet', () => {
    expect(normaliseRoomCode('')).toBeNull();
    expect(normaliseRoomCode('K7Q')).toBeNull();
    expect(normaliseRoomCode('ABCDEFGHJ')).toBeNull();
    // 0, 1, I, L and O are never in a code, so a mistyped one is caught here rather than as "no such room".
    for (const bad of ['K7QX0', 'K7QX1', 'K7QXI', 'K7QXL', 'K7QXO', 'K7Q!2']) expect(normaliseRoomCode(bad), bad).toBeNull();
  });
});

describe('where the server is', () => {
  it('is the address the game was loaded from, unless the build was told another', () => {
    vi.stubGlobal('location', { origin: 'https://game.example.test' });
    expect(signalBase()).toBe('https://game.example.test');
    vi.stubEnv('VITE_SIGNAL_URL', 'https://rooms.example.test/');
    expect(signalBase()).toBe('https://rooms.example.test');
    vi.stubEnv('VITE_SIGNAL_URL', '   ');
    expect(signalBase()).toBe('https://game.example.test');
  });

  it('is a WebSocket address for a room, secure when the game is, with ?role=host only for the host', () => {
    expect(signalUrl('https://game.example.test', 'K7QX2', 'join')).toBe('wss://game.example.test/signal/K7QX2');
    expect(signalUrl('https://game.example.test', 'K7QX2', 'host')).toBe('wss://game.example.test/signal/K7QX2?role=host');
    expect(signalUrl('http://127.0.0.1:8787', 'K7QX2', 'join')).toBe('ws://127.0.0.1:8787/signal/K7QX2');
    expect(signalUrl('http://localhost:8787/', 'ABCDE', 'host')).toBe('ws://localhost:8787/signal/ABCDE?role=host');
  });
});

describe('finding out whether there is a server', () => {
  const answer = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('is yes when the server says what it is', async () => {
    vi.stubGlobal('fetch', answer({ ok: true, service: 'zombonz-rooms', version: 1 }));
    expect(await signalAvailable('https://game.example.test')).toBe(true);
  });

  it('is no on a copy of the game with none: not found, something else answering, not JSON, or nothing at all', async () => {
    vi.stubGlobal('fetch', answer({}, 404));
    expect(await signalAvailable('https://game.example.test')).toBe(false);
    vi.stubGlobal('fetch', answer({ ok: true, service: 'something-else' }));
    expect(await signalAvailable('https://game.example.test')).toBe(false);
    vi.stubGlobal('fetch', async () => new Response('<html>Not found</html>', { status: 200 }));
    expect(await signalAvailable('https://game.example.test')).toBe(false);
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    expect(await signalAvailable('https://game.example.test')).toBe(false);
  });

  it('gives up waiting after a few seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', (_url: unknown, init: { signal: AbortSignal }) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))));
    const result = signalAvailable('https://game.example.test', 2500);
    await vi.advanceTimersByTimeAsync(2500);
    expect(await result).toBe(false);
  });

  it('asks the server\'s own /signal/health', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: URL) => { asked.push(url.href); return new Response('{}'); });
    await signalAvailable('https://rooms.example.test');
    expect(asked).toEqual(['https://rooms.example.test/signal/health']);
  });
});

/** A WebSocket the test drives: it says when to open, and what the server says. */
class FakeSocket extends EventTarget {
  static all: FakeSocket[] = [];
  readonly OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  constructor(readonly url: string) { super(); FakeSocket.all.push(this); }
  send(text: string) { this.sent.push(text); }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  /** The server says something. */
  receive(message: unknown) { this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(message) })); }
}
const socketOptions = () => ({ base: 'https://game.example.test', WebSocketImpl: FakeSocket as unknown as typeof WebSocket });

describe('a connection into a room', () => {
  beforeEach(() => { FakeSocket.all = []; });

  it('opens at the room\'s address and is ready once the server says hello, with the number it was given', async () => {
    const opened = openSignal('K7QX2', 'host', socketOptions());
    const [socket] = FakeSocket.all;
    expect(socket.url).toBe('wss://game.example.test/signal/K7QX2?role=host');
    socket.receive({ t: 'hello', role: 'host', room: 'K7QX2', id: 0 });
    const signal = await opened;
    expect(signal).toMatchObject({ id: 0, room: 'K7QX2' });
  });

  it('sends signals only once the socket is open, as JSON for the server', async () => {
    const opened = openSignal('K7QX2', 'join', socketOptions());
    const [socket] = FakeSocket.all;
    socket.receive({ t: 'hello', role: 'join', room: 'K7QX2', id: 2 });
    const signal = await opened;
    signal.send(0, { candidate: null });
    expect(socket.sent).toEqual([]);
    socket.readyState = 1;
    signal.send(0, { description: { type: 'answer', sdp: 'v=0' } });
    expect(socket.sent.map(text => JSON.parse(text))).toEqual([{ t: 'signal', to: 0, data: { description: { type: 'answer', sdp: 'v=0' } } }]);
  });

  it('passes on who joined and left, and that the host has gone, and what was signalled', async () => {
    const opened = openSignal('K7QX2', 'host', socketOptions());
    const [socket] = FakeSocket.all;
    socket.receive({ t: 'hello', role: 'host', room: 'K7QX2', id: 0 });
    const signal = await opened;
    const seen: unknown[] = [];
    signal.onPeerJoined(id => seen.push(['joined', id]));
    signal.onPeerLeft(id => seen.push(['left', id]));
    signal.onHostLeft(() => seen.push(['host-left']));
    signal.onSignal((from, data) => seen.push(['signal', from, data]));
    socket.receive({ t: 'peer-joined', id: 1 });
    socket.receive({ t: 'signal', from: 1, data: { x: 1 } });
    socket.receive({ t: 'peer-left', id: 1 });
    socket.receive({ t: 'host-left' });
    expect(seen).toEqual([['joined', 1], ['signal', 1, { x: 1 }], ['left', 1], ['host-left']]);
  });

  it('keeps signals that arrive before anyone is listening, in order, for the first listener only', async () => {
    const opened = openSignal('K7QX2', 'join', socketOptions());
    const [socket] = FakeSocket.all;
    socket.receive({ t: 'hello', role: 'join', room: 'K7QX2', id: 1 });
    const signal = await opened;
    socket.receive({ t: 'signal', from: 0, data: 'offer' });
    socket.receive({ t: 'signal', from: 0, data: 'candidate' });
    const first: unknown[] = [], second: unknown[] = [];
    signal.onSignal((_from, data) => first.push(data));
    signal.onSignal((_from, data) => second.push(data));
    expect(first).toEqual(['offer', 'candidate']);
    expect(second).toEqual([]);
    socket.receive({ t: 'signal', from: 0, data: 'later' });
    expect(first).toEqual(['offer', 'candidate', 'later']);
    expect(second).toEqual(['later']);
  });

  it('rejects, in words the player can act on, when the server refuses', async () => {
    for (const [reason, words] of [['no-room', /No game with that code/], ['full', /full/], ['room-in-use', /already in use/], ['expired', /too long/]] as const) {
      FakeSocket.all = [];
      const opened = openSignal('K7QX2', 'join', socketOptions());
      const [socket] = FakeSocket.all;
      socket.receive({ t: 'error', reason });
      socket.close();
      await expect(opened, reason).rejects.toThrow(words);
      await opened.catch(error => expect((error as SignalError).reason).toBe(reason));
    }
  });

  it('rejects as unreachable when the socket errors or closes before the server says hello', async () => {
    const errored = openSignal('K7QX2', 'join', socketOptions());
    FakeSocket.all[0].dispatchEvent(new Event('error'));
    await expect(errored).rejects.toMatchObject({ reason: 'unreachable', message: expect.stringMatching(/Could not reach the game server/) });
    FakeSocket.all = [];
    const closed = openSignal('K7QX2', 'join', socketOptions());
    FakeSocket.all[0].close();
    await expect(closed).rejects.toMatchObject({ reason: 'unreachable' });
  });

  it('rejects as unreachable when the server never answers', async () => {
    vi.useFakeTimers();
    const opened = openSignal('K7QX2', 'join', { ...socketOptions(), timeoutMs: 5000 });
    const outcome = expect(opened).rejects.toMatchObject({ reason: 'unreachable', message: expect.stringMatching(/did not answer/) });
    await vi.advanceTimersByTimeAsync(5000);
    await outcome;
    expect(FakeSocket.all[0].readyState).toBe(3);
  });

  it('says when the connection ends afterwards, with the server\'s reason if it gave one', async () => {
    const opened = openSignal('K7QX2', 'host', socketOptions());
    const [socket] = FakeSocket.all;
    socket.receive({ t: 'hello', role: 'host', room: 'K7QX2', id: 0 });
    const signal = await opened;
    const ends: Array<string | undefined> = [];
    signal.onClose(reason => ends.push(reason));
    socket.receive({ t: 'error', reason: 'too-fast' });
    socket.close();
    expect(ends).toEqual([expect.stringMatching(/Too many messages/)]);
    const plain = openSignal('ABCDE', 'host', socketOptions());
    const second = FakeSocket.all[1];
    second.receive({ t: 'hello', role: 'host', room: 'ABCDE', id: 0 });
    const other = await plain;
    const more: Array<string | undefined> = [];
    other.onClose(reason => more.push(reason));
    other.close();
    expect(more).toEqual([undefined]);
  });

  it('ignores what it cannot read', async () => {
    const opened = openSignal('K7QX2', 'host', socketOptions());
    const [socket] = FakeSocket.all;
    socket.dispatchEvent(Object.assign(new Event('message'), { data: 'not json' }));
    socket.receive({ t: 'signal' });
    socket.receive({ t: 'hello', role: 'host', room: 'K7QX2', id: 0 });
    await expect(opened).resolves.toMatchObject({ id: 0 });
  });
});
