// The few Cloudflare Workers types the game server uses, so the repository needs no Cloudflare packages to typecheck it.
// (Wrangler brings the real ones when you run or deploy the server.)

declare module 'cloudflare:workers' {
  export class DurableObject<Env = unknown> {
    constructor(ctx: unknown, env: Env);
    protected readonly ctx: unknown;
    protected readonly env: Env;
    fetch(request: Request): Promise<Response>;
  }
}

interface DurableObjectId { readonly name?: string }
interface DurableObjectStub { fetch(request: Request): Promise<Response> }
interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}
interface Fetcher { fetch(request: Request): Promise<Response> }
declare class WebSocketPair { readonly 0: WebSocket; readonly 1: WebSocket }
interface WebSocket { accept(): void }
interface ResponseInit { webSocket?: WebSocket }
