import type {
  ClientTransport,
  DeliveryClass,
  HostTransport,
  PeerId,
  TransportLifecycleEvent,
  TransportLifecycleListener,
  TransportMessage,
  TransportMessageListener,
  TransportPayload,
  Unsubscribe,
} from './transport.ts';

export type LoopbackDirection = 'hostToClient' | 'clientToHost';

export interface LoopbackFaultController {
  dropNext(direction: LoopbackDirection, delivery: DeliveryClass): void;
  clear(): void;
}

export interface LoopbackPairOptions {
  hostPeerId?: PeerId;
  clientPeerId?: PeerId;
}

interface QueuedPacket {
  direction: LoopbackDirection;
  delivery: DeliveryClass;
  payload: Uint8Array;
}
class ListenerSet<T> {
  private readonly listeners = new Set<(value: T) => void>();

  add(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) listener(value);
  }
}

function clonePayload(payload: TransportPayload): Uint8Array {
  return new Uint8Array(payload);
}

export interface LoopbackPair {
  readonly host: HostTransport;
  readonly client: ClientTransport;
  readonly faults: LoopbackFaultController;
  connect(): void;
  flush(): number;
  pendingCount(): number;
}

export function createLoopbackPair(options: LoopbackPairOptions = {}): LoopbackPair {
  const hostPeerId = options.hostPeerId ?? 'host';
  const clientPeerId = options.clientPeerId ?? 'client-1';
  const hostMessages = new ListenerSet<TransportMessage>();
  const clientMessages = new ListenerSet<TransportMessage>();
  const hostLifecycle = new ListenerSet<TransportLifecycleEvent>();
  const clientLifecycle = new ListenerSet<TransportLifecycleEvent>();
  const queue: QueuedPacket[] = [];
  const drops = new Map<string, number>();
  let connected = false;
  let hostClosed = false;
  let clientClosed = false;

  const key = (direction: LoopbackDirection, delivery: DeliveryClass) => `${direction}:${delivery}`;
  const requireConnected = () => {
    if (!connected || hostClosed || clientClosed) throw new Error('Loopback endpoints are not connected.');
  };
  const enqueue = (
    direction: LoopbackDirection,
    delivery: DeliveryClass,
    payload: TransportPayload,
  ) => {
    requireConnected();
    queue.push({ direction, delivery, payload: clonePayload(payload) });
  };
  const validateClientPeer = (peerId: PeerId) => {
    if (peerId !== clientPeerId) throw new RangeError(`Unknown loopback peer: ${peerId}`);
  };
  const disconnect = (closedSide: 'host' | 'client', reason?: string) => {
    if (closedSide === 'host') {
      if (hostClosed) return;
      hostClosed = true;
      hostLifecycle.emit({ type: 'transportClosed', reason });
      if (connected && !clientClosed) clientLifecycle.emit({ type: 'peerDisconnected', peerId: hostPeerId, reason });
    } else {
      if (clientClosed) return;
      clientClosed = true;
      clientLifecycle.emit({ type: 'transportClosed', reason });
      if (connected && !hostClosed) hostLifecycle.emit({ type: 'peerDisconnected', peerId: clientPeerId, reason });
    }
    connected = false;
    queue.length = 0;
  };

  const host: HostTransport = {
    role: 'host',
    sendReliable(peerId, payload) {
      validateClientPeer(peerId);
      enqueue('hostToClient', 'reliable', payload);
    },
    sendUnreliable(peerId, payload) {
      validateClientPeer(peerId);
      enqueue('hostToClient', 'unreliable', payload);
    },
    broadcastReliable(payload) {
      enqueue('hostToClient', 'reliable', payload);
    },
    broadcastUnreliable(payload) {
      enqueue('hostToClient', 'unreliable', payload);
    },
    onMessage(listener: TransportMessageListener) {
      return hostMessages.add(listener);
    },
    onLifecycle(listener: TransportLifecycleListener) {
      return hostLifecycle.add(listener);
    },
    close(reason?: string) {
      disconnect('host', reason);
    },
  };

  const client: ClientTransport = {
    role: 'client',
    sendReliable(payload) {
      enqueue('clientToHost', 'reliable', payload);
    },
    sendUnreliable(payload) {
      enqueue('clientToHost', 'unreliable', payload);
    },
    onMessage(listener: TransportMessageListener) {
      return clientMessages.add(listener);
    },
    onLifecycle(listener: TransportLifecycleListener) {
      return clientLifecycle.add(listener);
    },
    close(reason?: string) {
      disconnect('client', reason);
    },
  };

  const faults: LoopbackFaultController = {
    dropNext(direction, delivery) {
      const rule = key(direction, delivery);
      drops.set(rule, (drops.get(rule) ?? 0) + 1);
    },
    clear() {
      drops.clear();
    },
  };

  return {
    host,
    client,
    faults,
    connect() {
      if (hostClosed || clientClosed) throw new Error('Closed loopback endpoints cannot reconnect.');
      if (connected) return;
      connected = true;
      hostLifecycle.emit({ type: 'peerConnected', peerId: clientPeerId });
      clientLifecycle.emit({ type: 'peerConnected', peerId: hostPeerId });
    },
    flush() {
      requireConnected();
      const batch = queue.splice(0, queue.length);
      let delivered = 0;
      for (const packet of batch) {
        const rule = key(packet.direction, packet.delivery);
        const remaining = drops.get(rule) ?? 0;
        if (remaining > 0) {
          if (remaining === 1) drops.delete(rule);
          else drops.set(rule, remaining - 1);
          continue;
        }
        const message = {
          peerId: packet.direction === 'hostToClient' ? hostPeerId : clientPeerId,
          delivery: packet.delivery,
          payload: clonePayload(packet.payload),
        } satisfies TransportMessage;
        (packet.direction === 'hostToClient' ? clientMessages : hostMessages).emit(message);
        delivered += 1;
      }
      return delivered;
    },
    pendingCount() {
      return queue.length;
    },
  };
}
