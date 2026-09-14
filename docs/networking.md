# Multiplayer transport contract

The multiplayer layer talks to abstract host/client transports. Concrete WebRTC, loopback, relay, or future dedicated-server adapters must implement these interfaces without changing gameplay code.

Transport payloads are opaque `Uint8Array` values. Message encoding, protocol versions, and gameplay ownership rules belong to the protocol layer, not the transport.

## Delivery classes

**Reliable** messages are for durable ordered information such as handshakes, purchases, joins/leaves, and other events that must not be silently skipped while a connection remains healthy. A transport failure may still prevent delivery, in which case lifecycle/error events must surface the failure.

**Unreliable** messages are for replaceable data such as world snapshots. They may be dropped, delayed, duplicated, or reordered. Consumers must tolerate gaps and stale arrivals and must never require an unreliable message to arrive for simulation correctness.

Payloads passed to `send*` should be treated as immutable after the call. Implementations may copy or queue them.
## Host and client APIs

A `HostTransport` addresses peers explicitly and may broadcast on either delivery class. A `ClientTransport` sends to its current host without exposing transport-specific connection objects.

Both expose subscriptions for received messages and lifecycle events plus an idempotent-style `close` operation. Lifecycle events are deliberately transport-neutral:

- `peerConnected`: a remote peer became usable.
- `peerDisconnected`: a remote peer left or became unusable.
- `transportClosed`: the endpoint itself shut down.
- `transportError`: a transport failure that should be surfaced to host/client orchestration.

The transport layer does not tick the simulation, assign gameplay authority, validate inputs, encode protocol messages, or know about Three.js. Those responsibilities sit above or beside this boundary.
