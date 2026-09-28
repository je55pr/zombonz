export type PeerId = string;
export type TransportPayload = Uint8Array;
export type Unsubscribe = () => void;

export type DeliveryClass = 'reliable' | 'unreliable';

export interface TransportMessage {
  peerId: PeerId;
  delivery: DeliveryClass;
  payload: TransportPayload;
}

export type TransportLifecycleEvent =
  | { type: 'peerConnected'; peerId: PeerId }
  | { type: 'peerDisconnected'; peerId: PeerId; reason?: string }
  | { type: 'transportClosed'; reason?: string }
  | { type: 'transportError'; peerId?: PeerId; message: string };

export type TransportMessageListener = (message: TransportMessage) => void;
export type TransportLifecycleListener = (event: TransportLifecycleEvent) => void;

export interface TransportSubscriptions {
  onMessage(listener: TransportMessageListener): Unsubscribe;
  onLifecycle(listener: TransportLifecycleListener): Unsubscribe;
  close(reason?: string): void;
}
export interface HostTransport extends TransportSubscriptions {
  readonly role: 'host';
  sendReliable(peerId: PeerId, payload: TransportPayload): void;
  sendUnreliable(peerId: PeerId, payload: TransportPayload): void;
  broadcastReliable(payload: TransportPayload): void;
  broadcastUnreliable(payload: TransportPayload): void;
  /** Drops one peer, where the transport supports it. */
  disconnect?(peerId: PeerId, reason?: string): void;
}

export interface ClientTransport extends TransportSubscriptions {
  readonly role: 'client';
  sendReliable(payload: TransportPayload): void;
  sendUnreliable(payload: TransportPayload): void;
}

export type MultiplayerTransport = HostTransport | ClientTransport;
