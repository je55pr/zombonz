import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomLogic, type Peer } from '../server/roomLogic.ts';
import { hostRoom, joinRoom } from '../src/network/roomLink.ts';
import { SignalError } from '../src/network/signaling.ts';

/**
 * The room server is the real room logic; each socket is a connection to it. The browser connections are stood in for by ones that behave
 * as the real ones do where it matters here: an address is refused until the description it belongs to has been set, and a connection comes
 * up once it has both descriptions and has been given an address.
 */
/** One room for each code, made when it is first asked for, as on the real server. */
const rooms = new Map<string, RoomLogic>();
class Socket extends EventTarget {
  readonly OPEN = 1;
  readyState = 1;
  private id: number | null = null;
  private readonly logic: RoomLogic;
  constructor(url: string) {
    super();
    const { pathname, searchParams } = new URL(url);
    const room = pathname.split('/').pop()!.toUpperCase();
    if (!rooms.has(room)) rooms.set(room, new RoomLogic());
    this.logic = rooms.get(room)!;
    const peer: Peer = {
      send: message => queueMicrotask(() => this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(message) }))),
      close: () => queueMicrotask(() => this.close()),
    };
    queueMicrotask(() => { this.id = this.logic.connect(searchParams.get('role') === 'host' ? 'host' : 'join', room, peer); });
  }
  send(text: string) { const id = this.id; queueMicrotask(() => { if (id !== null) this.logic.message(id, text); }); }
  close() { const id = this.id; this.id = null; if (id !== null) this.logic.disconnect(id); this.shut(); }
  private shut() { if (this.readyState !== 3) { this.readyState = 3; this.dispatchEvent(new Event('close')); } }
}
const options = { base: 'https://game.example.test', WebSocketImpl: Socket as unknown as typeof WebSocket };

class Channel extends EventTarget {
  readyState = 'connecting';
  binaryType = '';
  open() { this.readyState = 'open'; this.dispatchEvent(new Event('open')); }
}
class Connection extends EventTarget {
  static all: Connection[] = [];
  static dropAddresses = false;
  readonly number: number;
  iceGatheringState = 'new'; iceConnectionState = 'new'; connectionState = 'new';
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  addresses: string[] = [];
  channels: Channel[] = [];
  closed = false;
  constructor(readonly configuration: unknown) { super(); Connection.all.push(this); this.number = Connection.all.length; }
  createDataChannel() { const channel = new Channel(); this.channels.push(channel); return channel; }
  async createOffer() { return { type: 'offer', sdp: `offer from ${this.number}` }; }
  async createAnswer() { return { type: 'answer', sdp: `answer from ${this.number}` }; }
  async setLocalDescription(description: { type: string; sdp: string }) {
    this.localDescription = description;
    // Finding its own addresses takes a moment, and each is announced as it is found.
    setTimeout(() => {
      for (const found of ['a', 'b']) this.dispatchEvent(Object.assign(new Event('icecandidate'), { candidate: { toJSON: () => ({ candidate: `address ${this.number}${found}`, sdpMid: '0', sdpMLineIndex: 0 }) } }));
      this.dispatchEvent(Object.assign(new Event('icecandidate'), { candidate: null }));
    }, 0);
  }
  async setRemoteDescription(description: { type: string; sdp: string }) { this.remoteDescription = description; this.tryConnecting(); }
  async addIceCandidate(candidate: { candidate: string }) {
    // As a real browser does, refuse an address before the description it belongs to.
    if (!this.remoteDescription) throw new DOMException('The remote description was null', 'InvalidStateError');
    this.addresses.push(candidate.candidate);
    this.tryConnecting();
  }
  async getStats() { return new Map(); }
  private tryConnecting() {
    if (Connection.dropAddresses || !this.localDescription || !this.remoteDescription || !this.addresses.some(Boolean)) return;
    setTimeout(() => {
      if (this.closed || this.connectionState === 'connected') return;
      this.connectionState = 'connected';
      this.dispatchEvent(new Event('connectionstatechange'));
      for (const channel of this.channels) channel.open();
    }, 0);
  }
  close() { this.closed = true; }
}

beforeEach(() => {
  rooms.clear();
  Connection.all = []; Connection.dropAddresses = false;
  vi.stubGlobal('RTCPeerConnection', Connection);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

describe('hosting and joining through a room', () => {
  it('makes a room with a code, and a player who types it gets a connection to the host', async () => {
    const peers: number[] = [];
    const host = await hostRoom({ onPeer: (_link, id) => peers.push(id) }, options);
    expect(host.room).toMatch(/^[A-HJKMNP-Z2-9]{5}$/);
    const join = await joinRoom(host.room, options);
    const link = await join.connected;
    await settle();
    expect(peers).toEqual([1]);
    expect(typeof link.sendReliable).toBe('function');
    // The host offered, the player answered.
    const [hostSide, playerSide] = Connection.all;
    expect(hostSide.localDescription?.type).toBe('offer');
    expect(hostSide.remoteDescription).toEqual({ type: 'answer', sdp: 'answer from 2' });
    expect(playerSide.remoteDescription).toEqual({ type: 'offer', sdp: 'offer from 1' });
    // Each was given the other's addresses, after the description they belong to, and then told there were no more (the empty one).
    expect(hostSide.addresses).toEqual(['address 2a', 'address 2b', '']);
    expect(playerSide.addresses).toEqual(['address 1a', 'address 1b', '']);
    host.close();
  });

  it('accepts the code in any case, as the server does', async () => {
    const host = await hostRoom({ onPeer: () => {} }, options);
    const join = await joinRoom(host.room.toLowerCase(), options);
    await expect(join.connected).resolves.toBeDefined();
    host.close();
  });

  it('connects several players, each with a connection of their own and the number the server gave them', async () => {
    const peers: number[] = [];
    const host = await hostRoom({ onPeer: (_link, id) => peers.push(id) }, options);
    const joins = await Promise.all([joinRoom(host.room, options), joinRoom(host.room, options)]);
    await Promise.all(joins.map(join => join.connected));
    await settle();
    expect(peers.sort()).toEqual([1, 2]);
    expect(Connection.all).toHaveLength(4);
    host.close();
  });

  it('lets the host go on accepting players after the first has connected, and gives the number back once the first has left the room', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const peers: number[] = [], serials: number[] = [];
    const host = await hostRoom({ onPeer: (_link, id, serial) => { peers.push(id); serials.push(serial); } }, options);
    const first = await joinRoom(host.room, options);
    await vi.advanceTimersByTimeAsync(50);
    await first.connected;
    // The first player stays in the room for a moment after their own end is up, so the next is number 2.
    const second = await joinRoom(host.room, options);
    await vi.advanceTimersByTimeAsync(50);
    await second.connected;
    expect(peers).toEqual([1, 2]);
    // After that they leave the room, and a third takes number 1 again.
    await vi.advanceTimersByTimeAsync(3000);
    const third = await joinRoom(host.room, options);
    await vi.advanceTimersByTimeAsync(50);
    await third.connected;
    expect(peers).toEqual([1, 2, 1]);
    // The room's number is used again, but each connection has a number of its own, so two players are never taken for one.
    expect(serials).toEqual([1, 2, 3]);
    host.close();
  });

  it('tells a player when there is no such room, or it is full', async () => {
    await expect(joinRoom('ZZZZZ', options)).rejects.toMatchObject({ reason: 'no-room', message: expect.stringMatching(/No game with that code/) });
    const host = await hostRoom({ onPeer: () => {} }, options);
    Connection.dropAddresses = true;
    for (let i = 0; i < 3; i++) await joinRoom(host.room, options);
    await expect(joinRoom(host.room, options)).rejects.toMatchObject({ reason: 'full' });
    host.close();
  });

  it('tries another code when the one it made is already a room', async () => {
    const taken = await hostRoom({ onPeer: () => {} }, options);
    const real = crypto.getRandomValues.bind(crypto);
    const random = vi.spyOn(crypto, 'getRandomValues');
    // The first two codes it makes are the room that is already open.
    const bytes = [...taken.room].map(char => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'.indexOf(char));
    let calls = 0;
    random.mockImplementation(((array: Uint8Array) => { if (calls++ < 2) { array.set(bytes); return array; } return real(array as Uint8Array<ArrayBuffer>); }) as never);
    const second = await hostRoom({ onPeer: () => {} }, options);
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(second.room).not.toBe(taken.room);
    taken.close(); second.close();
  });

  it('gives up, saying so, if every code it tries is taken', async () => {
    const taken = await hostRoom({ onPeer: () => {} }, options);
    const bytes = [...taken.room].map(char => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'.indexOf(char));
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: Uint8Array) => { array.set(bytes); return array; }) as never);
    await expect(hostRoom({ onPeer: () => {} }, options)).rejects.toBeInstanceOf(SignalError);
    taken.close();
  });

  it('keeps addresses that arrive before the offer they belong to, and uses them once it has been applied', async () => {
    // A host that misbehaves: it sends two addresses, then the offer.
    const { openSignal } = await import('../src/network/signaling.ts');
    const rogue = await openSignal('EARLY', 'host', options);
    rogue.onPeerJoined(id => {
      rogue.send(id, { candidate: { candidate: 'early address 1', sdpMid: '0', sdpMLineIndex: 0 } });
      rogue.send(id, { candidate: { candidate: 'early address 2', sdpMid: '0', sdpMLineIndex: 0 } });
      rogue.send(id, { description: { type: 'offer', sdp: 'offer from the test' } });
    });
    const join = await joinRoom('EARLY', options);
    await expect(join.connected).resolves.toBeDefined();
    const [player] = Connection.all;
    expect(player.remoteDescription).toEqual({ type: 'offer', sdp: 'offer from the test' });
    expect(player.addresses.slice(0, 2)).toEqual(['early address 1', 'early address 2']);
    rogue.close();
  });

  it('tells the host, and the player, when a connection does not come up', async () => {
    vi.useFakeTimers();
    Connection.dropAddresses = true;
    const failures: Array<[number, string]> = [];
    const host = await hostRoom({ onPeer: () => {}, onPeerFailed: (id, message) => failures.push([id, message]) }, { ...options, timeoutMs: 3000 });
    const join = await joinRoom(host.room, { ...options, timeoutMs: 3000 });
    const outcome = expect(join.connected).rejects.toThrow(/Could not connect directly/);
    await vi.advanceTimersByTimeAsync(3000);
    await outcome;
    expect(failures).toEqual([[1, expect.stringMatching(/Could not connect directly/)]]);
    expect(Connection.all.every(connection => connection.closed)).toBe(true);
    host.close();
  });

  it('tells a player who is still connecting that the host has gone', async () => {
    Connection.dropAddresses = true;
    const host = await hostRoom({ onPeer: () => {} }, options);
    const join = await joinRoom(host.room, options);
    const outcome = expect(join.connected).rejects.toThrow(/host closed the game/);
    await settle();
    host.close();
    await outcome;
    expect(Connection.all[1].closed).toBe(true);
  });

  it('stops offering a connection to a player who leaves before answering it', async () => {
    Connection.dropAddresses = true;
    const host = await hostRoom({ onPeer: () => {} }, options);
    const join = await joinRoom(host.room, options);
    const cancelled = expect(join.connected).rejects.toThrow(/Cancelled/);
    // Straight away: before the offer has reached them, let alone an answer come back.
    join.cancel();
    await cancelled;
    await settle();
    expect(Connection.all[0].closed).toBe(true);
    expect(host.log()).toMatch(/player 1 left the room/);
    host.close();
  });

  it('does not drop a player who has answered just because they have left the room: their browser can be ready before the host’s', async () => {
    Connection.dropAddresses = true;
    const peers: number[] = [];
    const host = await hostRoom({ onPeer: (_link, id) => peers.push(id) }, options);
    const join = await joinRoom(host.room, options);
    join.connected.catch(() => {});
    await settle();
    // The player's answer has reached the host, and then the player's room connection goes.
    expect(Connection.all[0].remoteDescription?.type).toBe('answer');
    rooms.get(host.room)!.disconnect(1);
    await settle();
    expect(Connection.all[0].closed).toBe(false);
    expect(host.log()).toMatch(/player 1 left the room/);
    // The host's connection then comes up, and the player is added.
    Connection.dropAddresses = false;
    await Connection.all[0].addIceCandidate({ candidate: 'a late address' });
    await settle();
    expect(peers).toEqual([1]);
    host.close();
  });

  it('says when the server is lost, without disturbing anyone who has connected', async () => {
    const lost: Array<string | undefined> = [];
    const peers: number[] = [];
    const host = await hostRoom({ onPeer: (_link, id) => peers.push(id), onServerLost: reason => lost.push(reason) }, options);
    await (await joinRoom(host.room, options)).connected;
    await settle();
    rooms.get(host.room)!.expire();
    await settle();
    expect(lost).toEqual([expect.stringMatching(/too long/)]);
    expect(peers).toEqual([1]);
    // Closing it yourself is not being lost.
    const other = await hostRoom({ onServerLost: reason => lost.push(reason), onPeer: () => {} }, options);
    other.close();
    await settle();
    expect(lost).toHaveLength(1);
  });

  it('keeps a log of what happened, with no addresses in it', async () => {
    const host = await hostRoom({ onPeer: () => {} }, options);
    const join = await joinRoom(host.room, options);
    await join.connected;
    await settle();
    expect(host.log()).toContain(`room ${host.room} open`);
    expect(host.log()).toContain('player 1 joined');
    expect(host.log()).toContain('-- player 1');
    expect(host.log()).toMatch(/connection: connected/);
    expect(join.log()).toContain(`joined room ${host.room} as player 1`);
    expect(join.log()).toContain('-- host');
    for (const log of [host.log(), join.log()]) expect(log).not.toMatch(/\d+\.\d+\.\d+\.\d+|address \d/);
    host.close();
  });
});
