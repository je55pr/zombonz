import { DurableObject } from 'cloudflare:workers';
import { ROOM_LIFETIME_MS, RoomLogic, type Peer, type Role } from './roomLogic.ts';

/**
 * One room on the game server, as a Durable Object: it lives as long as someone is connected to it, and passes the
 * messages a WebRTC connection is set up with between the people in it (see roomLogic.ts). The worker sends each connection
 * for a room code here, saying which room and whether it is hosting or joining.
 */
export class Room extends DurableObject {
  private readonly logic = new RoomLogic();
  private expiry: ReturnType<typeof setTimeout> | null = null;

  override async fetch(request: Request): Promise<Response> {
    const role: Role = request.headers.get('x-room-role') === 'host' ? 'host' : 'join';
    const room = request.headers.get('x-room-code') ?? '';
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const peer: Peer = {
      send: message => { try { server.send(JSON.stringify(message)); } catch { /* already closed */ } },
      close: (code, reason) => { try { server.close(code, reason); } catch { /* already closed */ } },
    };
    const id = this.logic.connect(role, room, peer);
    if (id !== null) {
      // A room that is left open is closed after a while.
      this.expiry ??= setTimeout(() => this.logic.expire(), ROOM_LIFETIME_MS);
      server.addEventListener('message', (event: MessageEvent) => this.logic.message(id, event.data));
      const gone = () => { this.logic.disconnect(id); if (this.logic.size === 0 && this.expiry) { clearTimeout(this.expiry); this.expiry = null; } };
      server.addEventListener('close', gone);
      server.addEventListener('error', gone);
    }
    return new Response(null, { status: 101, webSocket: client });
  }
}
