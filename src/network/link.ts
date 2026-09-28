import type {
  ClientTransport, DeliveryClass, HostTransport, PeerId, TransportLifecycleEvent, TransportMessage, TransportPayload, Unsubscribe,
} from './transport.ts';

/** One connection to one remote peer: WebRTC data channels in the browser, or in-memory queues in tests. */
export interface PeerLink {
  sendReliable(payload: TransportPayload): void;
  sendUnreliable(payload: TransportPayload): void;
  onMessage(listener: (delivery: DeliveryClass, payload: TransportPayload) => void): Unsubscribe;
  onClose(listener: (reason?: string) => void): Unsubscribe;
  close(reason?: string): void;
}

export class Listeners<T> {
  private readonly listeners = new Set<(value: T) => void>();
  add(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  emit(value: T): void { for (const listener of [...this.listeners]) listener(value); }
}

/** A host transport over any number of peer links, each added once it is connected. */
export class LinkHostTransport implements HostTransport {
  readonly role = 'host' as const;
  private readonly links = new Map<PeerId, { link: PeerLink; unsubscribe: Unsubscribe[] }>();
  private readonly messages = new Listeners<TransportMessage>();
  private readonly lifecycle = new Listeners<TransportLifecycleEvent>();
  private closed = false;

  addPeer(peerId: PeerId, link: PeerLink): void {
    if (this.closed) { link.close('Host closed'); return; }
    if (this.links.has(peerId)) throw new Error(`Peer already connected: ${peerId}`);
    const unsubscribe = [
      link.onMessage((delivery, payload) => this.messages.emit({ peerId, delivery, payload })),
      link.onClose(reason => this.dropPeer(peerId, reason)),
    ];
    this.links.set(peerId, { link, unsubscribe });
    this.lifecycle.emit({ type: 'peerConnected', peerId });
  }
  peers(): PeerId[] { return [...this.links.keys()]; }
  disconnect(peerId: PeerId, reason?: string): void {
    const entry = this.links.get(peerId);
    if (!entry) return;
    this.dropPeer(peerId, reason);
    entry.link.close(reason);
  }
  private dropPeer(peerId: PeerId, reason?: string): void {
    const entry = this.links.get(peerId);
    if (!entry) return;
    this.links.delete(peerId);
    for (const stop of entry.unsubscribe) stop();
    this.lifecycle.emit({ type: 'peerDisconnected', peerId, reason });
  }
  private link(peerId: PeerId): PeerLink {
    const entry = this.links.get(peerId);
    if (!entry) throw new RangeError(`Unknown peer: ${peerId}`);
    return entry.link;
  }
  sendReliable(peerId: PeerId, payload: TransportPayload): void { this.link(peerId).sendReliable(payload); }
  sendUnreliable(peerId: PeerId, payload: TransportPayload): void { this.link(peerId).sendUnreliable(payload); }
  broadcastReliable(payload: TransportPayload): void { for (const { link } of this.links.values()) link.sendReliable(payload); }
  broadcastUnreliable(payload: TransportPayload): void { for (const { link } of this.links.values()) link.sendUnreliable(payload); }
  onMessage(listener: (message: TransportMessage) => void): Unsubscribe { return this.messages.add(listener); }
  onLifecycle(listener: (event: TransportLifecycleEvent) => void): Unsubscribe { return this.lifecycle.add(listener); }
  close(reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const peerId of this.peers()) this.disconnect(peerId, reason);
    this.lifecycle.emit({ type: 'transportClosed', reason });
  }
}

/** A client transport over its one link to the host. */
export function linkClientTransport(link: PeerLink, hostPeerId: PeerId = 'host'): ClientTransport {
  const messages = new Listeners<TransportMessage>();
  const lifecycle = new Listeners<TransportLifecycleEvent>();
  let closed = false;
  link.onMessage((delivery, payload) => messages.emit({ peerId: hostPeerId, delivery, payload }));
  link.onClose(reason => {
    if (closed) return;
    closed = true;
    lifecycle.emit({ type: 'peerDisconnected', peerId: hostPeerId, reason });
    lifecycle.emit({ type: 'transportClosed', reason });
  });
  return {
    role: 'client',
    sendReliable: payload => { if (!closed) link.sendReliable(payload); },
    sendUnreliable: payload => { if (!closed) link.sendUnreliable(payload); },
    onMessage: listener => messages.add(listener),
    onLifecycle: listener => lifecycle.add(listener),
    close: reason => { if (!closed) link.close(reason); },
  };
}

export interface MemoryLinkPair {
  readonly a: PeerLink;
  readonly b: PeerLink;
  /** Delivers everything queued (in order, per direction); returns how many messages arrived. */
  flush(): number;
  /** Drops unreliable messages the filter picks, to test loss. */
  dropUnreliable(filter: ((payload: TransportPayload) => boolean) | null): void;
  /** Holds unreliable messages the filter picks until the next flush, so they arrive out of order. */
  delayUnreliable(filter: ((payload: TransportPayload) => boolean) | null): void;
}

/** Two linked in-memory ends. Nothing arrives until `flush`, like a network with a tick of latency. */
export function createMemoryLinks(): MemoryLinkPair {
  type Side = { messages: Listeners<[DeliveryClass, TransportPayload]>; closes: Listeners<string | undefined> };
  const sides: [Side, Side] = [
    { messages: new Listeners(), closes: new Listeners() },
    { messages: new Listeners(), closes: new Listeners() },
  ];
  const queue: Array<{ to: 0 | 1; delivery: DeliveryClass; payload: Uint8Array; held?: boolean }> = [];
  let open = true;
  let drop: ((payload: TransportPayload) => boolean) | null = null;
  let delay: ((payload: TransportPayload) => boolean) | null = null;
  const end = (index: 0 | 1): PeerLink => {
    const other = (1 - index) as 0 | 1;
    const send = (delivery: DeliveryClass) => (payload: TransportPayload) => {
      if (open) queue.push({ to: other, delivery, payload: new Uint8Array(payload) });
    };
    return {
      sendReliable: send('reliable'),
      sendUnreliable: send('unreliable'),
      onMessage: listener => sides[index].messages.add(([delivery, payload]) => listener(delivery, payload)),
      onClose: listener => sides[index].closes.add(listener),
      close: reason => {
        if (!open) return;
        open = false; queue.length = 0;
        sides[other].closes.emit(reason); sides[index].closes.emit(reason);
      },
    };
  };
  return {
    a: end(0), b: end(1),
    flush() {
      let delivered = 0;
      const held: typeof queue = [];
      for (const packet of queue.splice(0, queue.length)) {
        if (packet.delivery === 'unreliable' && !packet.held && delay?.(packet.payload)) { held.push({ ...packet, held: true }); continue; }
        if (packet.delivery === 'unreliable' && !packet.held && drop?.(packet.payload)) continue;
        sides[packet.to].messages.emit([packet.delivery, packet.payload]);
        delivered += 1;
      }
      queue.push(...held);
      return delivered;
    },
    dropUnreliable(filter) { drop = filter; },
    delayUnreliable(filter) { delay = filter; },
  };
}
