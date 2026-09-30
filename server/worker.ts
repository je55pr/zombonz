export { Room } from './room.ts';

interface Env {
  /** One Durable Object per room code. */
  ROOMS: DurableObjectNamespace;
  /** The built game (the `dist` folder), served for every path that is not a room. */
  ASSETS: Fetcher;
}

const ROOM_PATH = /^\/signal\/([A-Za-z0-9]{4,8})$/;
const NO_STORE = { 'cache-control': 'no-store', 'access-control-allow-origin': '*' };

/**
 * The game server: it serves the built game, and passes room messages between the browsers in a room. It carries no game
 * traffic (players connect to each other directly once a room has introduced them), only the few kilobytes it takes to do that.
 *
 *   GET  /signal/health    says the server is here, so the game knows to use rooms rather than connection codes
 *   GET  /signal/echo      a WebSocket that says hello and closes, to check WebSockets get through a network
 *   GET  /signal/CODE      a WebSocket into room CODE (?role=host to make it, otherwise to join it)
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/signal/health') return Response.json({ ok: true, service: 'zombonz-rooms', version: 1 }, { headers: NO_STORE });
    const isSocket = request.headers.get('upgrade')?.toLowerCase() === 'websocket';
    if (url.pathname === '/signal/echo') {
      if (!isSocket) return new Response('Expected a WebSocket.', { status: 426, headers: NO_STORE });
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      server.send(JSON.stringify({ t: 'echo', ok: true }));
      server.close(1000, 'done');
      return new Response(null, { status: 101, webSocket: client });
    }
    const match = ROOM_PATH.exec(url.pathname);
    if (match) {
      if (!isSocket) return new Response('Expected a WebSocket.', { status: 426, headers: NO_STORE });
      const code = match[1].toUpperCase();
      const forwarded = new Request(request);
      forwarded.headers.set('x-room-code', code);
      forwarded.headers.set('x-room-role', url.searchParams.get('role') === 'host' ? 'host' : 'join');
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(forwarded);
    }
    return env.ASSETS.fetch(request);
  },
};
