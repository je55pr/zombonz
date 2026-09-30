import { describe, expect, it, vi } from 'vitest';
import { MAX_PLAYERS } from '../src/net/protocol.ts';
import {
  CLOSE, MAX_IN_ROOM, MAX_MESSAGE_CHARS, RATE_LIMIT, RoomLogic, type Peer, type ToClient,
} from '../server/roomLogic.ts';

/** A connection that writes down what it is sent and whether it was closed. */
function peer(): Peer & { sent: ToClient[]; closed: { code: number; reason: string } | null } {
  const made = {
    sent: [] as ToClient[], closed: null as { code: number; reason: string } | null,
    send(message: ToClient) { made.sent.push(message); },
    close(code: number, reason: string) { made.closed = { code, reason }; },
  };
  return made;
}
const signal = (to: number, data: unknown = { hello: true }) => JSON.stringify({ t: 'signal', to, data });

describe('a room', () => {
  it('holds as many as the game allows', () => {
    expect(MAX_IN_ROOM).toBe(MAX_PLAYERS);
  });

  it('is made by a host, who is number 0', () => {
    const room = new RoomLogic(), host = peer();
    expect(room.connect('host', 'K7QX2', host)).toBe(0);
    expect(host.sent).toEqual([{ t: 'hello', role: 'host', room: 'K7QX2', id: 0 }]);
    expect(room.size).toBe(1);
  });

  it('cannot be joined before it is made, and says so', () => {
    const room = new RoomLogic(), stranger = peer();
    expect(room.connect('join', 'K7QX2', stranger)).toBeNull();
    expect(stranger.sent).toEqual([{ t: 'error', reason: 'no-room' }]);
    expect(stranger.closed).toEqual({ code: CLOSE.refused, reason: 'no-room' });
    expect(room.size).toBe(0);
  });

  it('has one host: a second is refused, so a clash of codes is noticed', () => {
    const room = new RoomLogic(), first = peer(), second = peer();
    room.connect('host', 'K7QX2', first);
    expect(room.connect('host', 'K7QX2', second)).toBeNull();
    expect(second.sent).toEqual([{ t: 'error', reason: 'room-in-use' }]);
    expect(second.closed?.reason).toBe('room-in-use');
    expect(first.closed).toBeNull();
  });

  it('gives players numbers from 1, tells the host, and is full at four', () => {
    const room = new RoomLogic(), host = peer(), players = [peer(), peer(), peer()], extra = peer();
    room.connect('host', 'K7QX2', host);
    expect(players.map(player => room.connect('join', 'K7QX2', player))).toEqual([1, 2, 3]);
    expect(players[1].sent[0]).toEqual({ t: 'hello', role: 'join', room: 'K7QX2', id: 2 });
    expect(host.sent.slice(1)).toEqual([{ t: 'peer-joined', id: 1 }, { t: 'peer-joined', id: 2 }, { t: 'peer-joined', id: 3 }]);
    expect(room.connect('join', 'K7QX2', extra)).toBeNull();
    expect(extra.sent).toEqual([{ t: 'error', reason: 'full' }]);
    expect(room.size).toBe(4);
  });

  it('passes a message from a player to the host, and from the host to a player, saying who it is from', () => {
    const room = new RoomLogic(), host = peer(), one = peer(), two = peer();
    room.connect('host', 'K7QX2', host); room.connect('join', 'K7QX2', one); room.connect('join', 'K7QX2', two);
    room.message(1, signal(0, { offer: 'x' }));
    expect(host.sent.at(-1)).toEqual({ t: 'signal', from: 1, data: { offer: 'x' } });
    room.message(0, signal(2, { answer: 'y' }));
    expect(two.sent.at(-1)).toEqual({ t: 'signal', from: 0, data: { answer: 'y' } });
    expect(one.sent.filter(message => message.t === 'signal')).toEqual([]);
  });

  it('lets a player write only to the host, and the host to no one but a player', () => {
    const room = new RoomLogic(), host = peer(), one = peer(), two = peer();
    room.connect('host', 'K7QX2', host); room.connect('join', 'K7QX2', one); room.connect('join', 'K7QX2', two);
    room.message(1, signal(2));
    room.message(0, signal(0));
    room.message(0, signal(9));
    room.message(1, signal(7));
    expect(two.sent.filter(message => message.t === 'signal')).toEqual([]);
    expect(host.sent.filter(message => message.t === 'signal')).toEqual([]);
    // Nobody is disconnected for it: it is a stale message for someone who has gone.
    expect([host.closed, one.closed, two.closed]).toEqual([null, null, null]);
  });

  it('refuses what it cannot understand, and disconnects whoever sent it', () => {
    for (const bad of ['not json', '"a string"', 'null', '[]', JSON.stringify({ t: 'hello' }), JSON.stringify({ t: 'signal', to: 'x', data: 1 }),
      JSON.stringify({ t: 'signal', to: 0.5, data: 1 }), JSON.stringify({ t: 'signal', to: 0 })]) {
      const room = new RoomLogic(), host = peer(), one = peer();
      room.connect('host', 'K7QX2', host); room.connect('join', 'K7QX2', one);
      room.message(1, bad);
      expect(one.sent.at(-1), bad).toEqual({ t: 'error', reason: 'bad-message' });
      expect(one.closed?.code, bad).toBe(CLOSE.badMessage);
      expect(host.sent.filter(message => message.t === 'signal'), bad).toEqual([]);
    }
    const room = new RoomLogic(), host = peer();
    room.connect('host', 'K7QX2', host);
    room.message(0, new ArrayBuffer(4));
    expect(host.closed?.code).toBe(CLOSE.badMessage);
  });

  it('refuses a message that is too large', () => {
    const room = new RoomLogic(), host = peer(), one = peer();
    room.connect('host', 'K7QX2', host); room.connect('join', 'K7QX2', one);
    room.message(1, signal(0, 'x'.repeat(MAX_MESSAGE_CHARS)));
    expect(one.sent.at(-1)).toEqual({ t: 'error', reason: 'too-large' });
    expect(one.closed?.code).toBe(CLOSE.tooLarge);
    // One just under the limit is fine.
    const other = peer();
    room.connect('join', 'K7QX2', other);
    room.message(2, signal(0, 'x'.repeat(MAX_MESSAGE_CHARS - 100)));
    expect(other.closed).toBeNull();
  });

  it('closes a connection that sends too many messages too quickly, but not one that keeps to the limit', () => {
    let now = 1_000_000;
    const room = new RoomLogic(() => now), host = peer(), one = peer();
    room.connect('host', 'K7QX2', host); room.connect('join', 'K7QX2', one);
    for (let i = 0; i < RATE_LIMIT.messages; i++) room.message(1, signal(0, i));
    expect(one.closed).toBeNull();
    // The window slides: a message after it has passed is a fresh start.
    now += RATE_LIMIT.windowMs + 1;
    for (let i = 0; i < RATE_LIMIT.messages; i++) room.message(1, signal(0, i));
    expect(one.closed).toBeNull();
    room.message(1, signal(0, 'one too many'));
    expect(one.sent.at(-1)).toEqual({ t: 'error', reason: 'too-fast' });
    expect(one.closed?.code).toBe(CLOSE.tooFast);
    // The host is unaffected by a player being cut off.
    expect(host.closed).toBeNull();
  });

  it('tells the host when a player leaves, and gives the number to the next to join', () => {
    const room = new RoomLogic(), host = peer(), one = peer(), two = peer(), later = peer();
    room.connect('host', 'K7QX2', host); room.connect('join', 'K7QX2', one); room.connect('join', 'K7QX2', two);
    room.disconnect(1);
    expect(host.sent.at(-1)).toEqual({ t: 'peer-left', id: 1 });
    expect(room.size).toBe(2);
    expect(room.connect('join', 'K7QX2', later)).toBe(1);
    // A message from the one who left is ignored.
    room.message(1, signal(0));
    room.disconnect(7);
  });

  it('ends when the host leaves: everyone is told and closed, and the code can be used again', () => {
    const room = new RoomLogic(), host = peer(), one = peer(), two = peer();
    room.connect('host', 'K7QX2', host); room.connect('join', 'K7QX2', one); room.connect('join', 'K7QX2', two);
    room.disconnect(0);
    for (const player of [one, two]) {
      expect(player.sent.at(-1)).toEqual({ t: 'host-left' });
      expect(player.closed?.code).toBe(CLOSE.hostLeft);
    }
    expect(room.size).toBe(0);
    const next = peer();
    expect(room.connect('host', 'K7QX2', next)).toBe(0);
  });

  it('closes everyone, saying it has expired, when it has been open too long', () => {
    const room = new RoomLogic(), host = peer(), one = peer();
    room.connect('host', 'K7QX2', host); room.connect('join', 'K7QX2', one);
    room.expire();
    for (const each of [host, one]) {
      expect(each.sent.at(-1)).toEqual({ t: 'error', reason: 'expired' });
      expect(each.closed?.code).toBe(CLOSE.expired);
    }
  });
});

// The worker's routing, with the Cloudflare pieces it needs stood in for.
vi.mock('cloudflare:workers', () => ({ DurableObject: class { constructor(readonly ctx: unknown, readonly env: unknown) {} } }));

describe('the worker', () => {
  async function worker() {
    const module = await import('../server/worker.ts');
    const forwarded: Request[] = [];
    const asked: string[] = [];
    const env = {
      ROOMS: { idFromName: (name: string) => { asked.push(name); return { name }; }, get: () => ({ fetch: async (request: Request) => { forwarded.push(request); return new Response('in the room'); } }) },
      ASSETS: { fetch: async (request: Request) => new Response(`asset ${new URL(request.url).pathname}`) },
    };
    return { fetch: (path: string, headers: Record<string, string> = {}) => module.default.fetch(new Request(`https://game.example.test${path}`, { headers }), env as never), forwarded, asked };
  }

  it('says it is there, so the game knows to use rooms, and can be asked from another address', async () => {
    const { fetch } = await worker();
    const response = await fetch('/signal/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: 'zombonz-rooms', version: 1 });
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('asks for a WebSocket where one is needed', async () => {
    const { fetch } = await worker();
    expect((await fetch('/signal/K7QX2')).status).toBe(426);
    expect((await fetch('/signal/echo')).status).toBe(426);
  });

  it('sends a WebSocket for a room to that room, with the code in capitals and whether it is hosting', async () => {
    const { fetch, forwarded, asked } = await worker();
    expect(await (await fetch('/signal/k7qx2', { upgrade: 'websocket' })).text()).toBe('in the room');
    expect(await (await fetch('/signal/K7QX2?role=host', { upgrade: 'WebSocket' })).text()).toBe('in the room');
    expect(asked).toEqual(['K7QX2', 'K7QX2']);
    expect(forwarded.map(request => [request.headers.get('x-room-code'), request.headers.get('x-room-role')])).toEqual([['K7QX2', 'join'], ['K7QX2', 'host']]);
    // Anything but ?role=host is joining.
    await fetch('/signal/K7QX2?role=admin', { upgrade: 'websocket' });
    expect(forwarded.at(-1)!.headers.get('x-room-role')).toBe('join');
  });

  it('serves the game for everything else, including paths that only look a little like a room', async () => {
    const { fetch, forwarded } = await worker();
    for (const path of ['/', '/index.html', '/assets/game.js', '/signal/abc', '/signal/ABCDEFGHI', '/signal/K7QX2/extra', '/signal/K7-X2', '/signals/K7QX2']) {
      expect(await (await fetch(path, { upgrade: 'websocket' })).text(), path).toBe(`asset ${path}`);
    }
    expect(forwarded).toEqual([]);
  });
});
