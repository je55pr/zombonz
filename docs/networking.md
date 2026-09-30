# Online co-op

Up to four players share a match. One player's browser hosts it and runs the only real simulation.
The others join over direct browser-to-browser connections (WebRTC). What sets a connection up depends on the copy of the game:

- **With a game server** ([`server/`](../server), set up as in [server-setup.md](server-setup.md)), players are introduced through
  a **room**: the host gets a five-character code, and everyone else types it. Nothing is pasted and nothing has to be timed.
- **Without one** (the copy on GitHub Pages, say), players swap short copy-paste codes instead.

The server only introduces browsers to each other: it passes along the few kilobytes it takes to set a connection up, and no game
traffic. Once two browsers are connected the server is not involved.

## Playing with a room

1. The host chooses **Multiplayer → Host Game** and a map. The screen shows a room code, such as `K7QX2`, with a **Copy code** button.
2. Everyone else chooses **Multiplayer → Join Game**, types the code (any case; spaces and dashes are ignored) and presses **Join**.
   Each is connected to the host within a second or so and appears in the host's lobby.
3. The host presses **Start game**.

A wrong code says there is no game with that code; a full room says so. **Use connection codes instead** (at the bottom of the room
lobby) switches to the copy-paste lobby, for a network that will not talk to the game server. **Test connection** and **Copy log** are
there too, as in the code lobby.

## How rooms work

Each room is a Durable Object on Cloudflare, named by its code. A connection into a room is a WebSocket to `/signal/CODE`
(`?role=host` to make the room, otherwise to join it). Everyone in a room has a number: the host is 0, players are 1 to 3.
The rules are in `server/roomLogic.ts`, which uses no Cloudflare types and is tested on its own; `server/room.ts` wires it to a
Durable Object and `server/worker.ts` routes requests.

| From | Message | Meaning |
| --- | --- | --- |
| server | `hello { role, room, id }` | You are in the room, as number `id`. |
| server | `peer-joined { id }` / `peer-left { id }` | To the host: a player came or went. |
| server | `host-left` | To players: the host went; the room is over. |
| server | `signal { from, data }` | Something from another person in the room. |
| server | `error { reason }` | Refused: `no-room`, `full`, `room-in-use`, `bad-message`, `too-large`, `too-fast` or `expired`; then closed. |
| client | `signal { to, data }` | Pass `data` to number `to`. Players can only write to the host, and the host to a player. |

For each player who joins, the host's browser makes a WebRTC offer and sends it in a `signal`; the player answers; and each passes the
other every network address it finds as it finds it (trickle ICE), so both ends start at once. When the connection is open the player leaves
the room (after a couple of seconds' grace, in case the host's end is a moment behind). `src/network/roomLink.ts` does this;
`src/network/signaling.ts` is the WebSocket client.

Limits, to keep a room from being a problem for the server: four connections; messages up to 16 KB; at most 80 messages in 10 seconds
per connection (a real connection sends a few dozen in its first second); and a room closes after 30 minutes. Room codes are names, not
secrets: anyone with the code and the address can ask to join, so a room is only as private as its code. The server accepts connections
from any address, so a copy of the game hosted elsewhere can use it (see `VITE_SIGNAL_URL` below).

`GET /signal/health` says the server is there (the game asks before choosing a lobby) and `GET /signal/echo` is a WebSocket that says hello and
closes, which is a way to check WebSockets get through a network.

### Where the game looks for the server

The address the game was loaded from, unless the build was given `VITE_SIGNAL_URL` (an `https://` address), which lets a copy of the game
hosted somewhere else, such as GitHub Pages, use a game server elsewhere. The GitHub Pages workflow passes a repository variable of that name,
if there is one, so a fork can set it under Settings, Secrets and variables, Actions, Variables.

## Playing with connection codes

1. The host chooses **Multiplayer → Host Game** and a map, then **Invite a player**. This makes an
   invite code (`ZBI1-…`, about 180 characters) to send to one friend over chat or text.
2. The friend chooses **Multiplayer → Join Game**, pastes the invite, and gets a reply code
   (`ZBR2-…`) to send back. A 45-second countdown starts on their screen.
3. The host pastes the reply and presses **Connect**, before that countdown ends. The host's screen counts down to the
   same moment; when both reach zero the two browsers connect, and the friend appears in both lobbies.
4. Repeat with a new invite for each player (up to four in all), then the host presses **Start game**.

If the host is too slow the reply has expired and the host is told to ask for a new one; the friend just presses
**Make my reply code** again. **Copy log**, which appears once an invite or reply has been made, copies a short timeline of
the connection (no addresses) to send along if a connection still fails.

Every player needs the same version of the game. A different version is refused with a message.
Each invite works once. Codes carry a checksum, so a code that was cut short or pasted into the
wrong box gets a clear message.

## How codes work

A WebRTC offer or answer (SDP) runs to hundreds of characters. A data-channel-only connection needs
just a few parts of it:

- the ICE username and password
- the SHA-256 certificate fingerprint
- the media id and setup role
- the UDP candidate addresses (IPv4, IPv6, or the `.local` names browsers use to hide LAN addresses)

`src/network/codes.ts` packs those into bytes, base64url-encodes them and adds a one-byte checksum.
The far side rebuilds a minimal SDP from them. Each side waits for ICE gathering to finish (or four
seconds) before showing its code, so one code carries every address.

Public STUN servers tell each browser its internet-facing address. There is no TURN relay yet, so
networks that block direct connections (some office, school and mobile networks) cannot connect.

## Testing a connection

**Multiplayer → Test my connection** (and the **Test connection** button in the lobby) checks whether this network is likely
to let a player join or host, and writes the answer as plain text with one button to copy it. A friend who can't connect runs
it and sends the text back. It takes a second or two, uses only public STUN servers (the game's two from Google and one from
Cloudflare) and leaves every IP address out of the text. The code is in `src/network/diagnostics.ts` (the checks and the
wording) and `src/client/connectionTest.ts` (the dialog).

It runs:

- **A lookup of the public address, per server.** Each STUN server is asked on its own, so a report says which ones answered
  and how fast, and which failed and with what error.
- **A comparison of ports.** All the servers are asked from one socket. A router that keeps one public port whichever server
  is asked ("same") lets a direct connection be made. One that gives a new port to each destination (a "symmetric NAT",
  common on mobile data, hotspots and some broadband) usually blocks it; that is the case a relay would fix. Fewer than two
  answering servers is reported as "could not compare".
- **A connection to itself with the game's own codes.** It makes an invite, answers it, connects the two and sends a message
  on each channel, and reports how long the invite took to make and to connect. This catches a browser or extension that blocks
  WebRTC, and a slow invite (the invite waits up to four seconds for the addresses). It runs after the lookups, not with them,
  so its timing is the game's own.

The first line of the text is the result: `GOOD`, `MAYBE` (only IPv6 was found, or IPv6 is the only way through, or the
ports could not be compared) or `PROBLEM` (offline, WebRTC blocked, no public address found, or a symmetric NAT with no IPv6),
with a sentence on why. Both players' networks matter: a good result on one side and a problem on the other still fails, so
ask both to run it.

## Why both sides start together

A browser starts sending connection probes the moment it has both halves of the exchange, and gives up after a few seconds
(Chrome about ten, Firefox five when it has nothing to try). A home router drops what arrives from an address it has not sent
anything to. In the first flow the friend's browser had both halves as soon as it made the reply code, so it probed for the
whole time it took the reply to reach the host through a chat (a minute, say), sent everything into the host's router, and had
given up by the time the host pressed **Connect**. Two browsers on one computer hid this, because the host's own machine
answered the early probes. It was reproduced by putting an unreachable address in the invite, standing in for a router that
drops them: a host that pasted within 10 seconds connected, and one that took 15 seconds or more never did.

The next version held the host's addresses back from the joiner until a start time, so the joiner's browser had nothing to
try. That worked in Chrome, but a real pair of logs showed Firefox declaring the connection failed five seconds after the reply
was made: with a remote description and no addresses in it, it gives up after a five-second grace period.

So now **neither side has a remote end until the start time**. Each makes an offer of its own (the invite is the host's, the
reply is the joiner's), and neither browser has anything to try or give up on. The joiner names the start time in its reply code:
45 seconds ahead, in the game server's clock (each side finds its offset from the `Date` header of the page's own server, good
to about a second). The host reads it and waits. At that moment each side applies the other's offer as the answer to its own,
with the host as the DTLS server and the joiner as the client (both browsers are then ICE controlling; the ICE role conflict
is settled by the browsers). Both start within about a second of each other. A reply read up to four seconds after its start
time still starts at once; later than that it has expired. Code: `src/network/webrtc.ts` (`START_DELAY_MS`, `timeUntilStart`,
`clockOffset`) and `src/network/codes.ts`.

## Transport

`src/network/link.ts` defines a `PeerLink`: one connection to one peer. `LinkHostTransport` gathers
any number of links behind the `HostTransport` interface, and `linkClientTransport` wraps a client's
single link. In the browser a link is two negotiated data channels (`src/network/webrtc.ts`):

| Channel | Settings | Carries |
| --- | --- | --- |
| `reliable` (id 0) | ordered, retransmitted | handshake, lobby, start, events, departures |
| `fast` (id 1) | unordered, no retransmits | snapshots, inputs |

Tests use `createMemoryLinks`. It queues messages until `flush` (one tick of latency), and can drop
or delay chosen unreliable messages to simulate loss and reordering.

## Protocol

`src/net/protocol.ts` defines every message, all JSON. `PROTOCOL_VERSION` changes whenever a message
or the snapshot changes shape.

Client to host:

| Message | Channel | Meaning |
| --- | --- | --- |
| `hello { v, name }` | reliable | Join the lobby. Refused if the version differs, the lobby is full, or the match has begun. |
| `ready` | reliable | Loaded the map. The host holds the first wave until everyone is ready, or 20 s have passed. |
| `input { f: NetInput[] }` | fast | This client's latest inputs (up to 8, repeated in each message so one lost packet costs nothing). |

Host to client:

| Message | Channel | Meaning |
| --- | --- | --- |
| `welcome { slot }` | reliable | Admitted, as player `slot` (the host is slot 0). |
| `reject { reason }` | reliable | Not admitted, and why. |
| `lobby { map, players }` | reliable | Who is in the lobby. |
| `start { map, seed, players }` | reliable | Build the match and start. |
| `ev { ep, k, e }` | reliable | The events of host tick `k`, in restart epoch `ep`. |
| `snap { ep, ack, s }` | fast | A snapshot; `ack` is the last of this client's inputs the host has used. |
| `left { slot, name }` | reliable | A player disconnected. |
| `end { reason }` | reliable | The host closed the game. |

`NetInput` holds a sequence number, the held, pressed and released buttons as bitmasks over
`NET_ACTIONS`, and the absolute view yaw and pitch. The host only ever uses a client's inputs for
that client's own player. Cheats and restarting are host-only actions, stripped from clients'
inputs.

Numbers in snapshots are rounded to four decimal places. A snapshot is encoded once, and each
client's message only differs in its `ack`.

## Authority

The host decides everything: movement, hits, points, purchases, doors, the box, downs and revives.
Clients never change the match. Each client builds the same match from the map (`createMatch` in
`src/maps/match.ts`), so entity ids line up with the host's, then keeps that copy in step with the
host's snapshots.

A snapshot (`src/net/snapshot.ts`) carries only what changes during play:

- every player and zombie (including each zombie's facing, look, lost limbs and swing, which the hit volumes and the client's animation come from, and each player's grace after a blow)
- the round and the spawn director
- each door's `open` flag
- barriers' boards (which slots are up, and which one last fell) and timers
- the box's motion
- traps' timers
- each Pack-a-Punch machine's phase, owner, the upgraded gun in it and its clock
- power, power-ups, grenades, Bouncing Betties and departed players
- each barrel's and vehicle's health and burn state (health, phase, burn ticks, who last hurt it)

Interactables are then re-derived with `GameSimulation.refreshInteractables`. A four-player Asylum
round with 24 zombies encodes to under 16 KB.

## Client prediction and smoothing

`src/net/client.ts` and `src/net/prediction.ts` handle the client side.

- **Own player:** each client tick samples input, sends it, and at once runs this player's part of a
  simulation tick locally: movement, view, sprint, gun timing and ammo, switch, reload and the timing of a knife
  swing (`meleeStrikeTicks` counts down as on the host; only the host knows what the blow hits).
  Nothing gets hit, bought or opened locally. The client's own shots, reloads, switches and swings
  play straight away, and the host's copies of those events for this player are dropped.
- **Reconciliation:** when a newer snapshot arrives, the predicted player is reset to the host's
  copy. The inputs the host has not yet acknowledged are then replayed. The view angles stay the
  client's own, so the camera never swings.
- **Correction:** any positional difference is kept as an offset on the camera and decays by 12 per
  second (about 90% gone in 0.2 s). A difference of more than 2 m snaps immediately instead.
- **Everything else:** remote players, zombies, power-ups, grenades and mines are drawn
  `INTERPOLATION_DELAY_TICKS` (6 ticks, 100 ms) behind the newest snapshot. They are interpolated
  between the snapshots on either side of that time.
  - The drawing clock drifts by at most 10% to follow the snapshot stream, and jumps if it falls
    more than 30 ticks out.
  - Out-of-order snapshots slot into the buffer. Missing ones just widen the interpolation span.
  - Host events are released when the drawing clock reaches their tick, so sounds match what is
    drawn.
- **Host input handling:** the host uses one queued input per player per tick. If a client falls 4
  or more inputs behind, the host folds the backlog into one tick. If an input is late, the host
  repeats the last buttons without new presses.

## Session rules

- **Lobby:** the host and up to three players join in order and get slots 1–3. Players still
  connecting when the match starts are turned away. No one can join mid-match.
- **Leaving:** a player who disconnects is taken out of the match (`GameSimulation.removePlayer`),
  and the others see a notice. When the host leaves, every client returns to the menu with a message.
- **Last stand:**
  - A killing blow downs a player, and a teammate revives them by holding E beside them.
  - A player who bleeds out comes back at the next round.
  - The match ends when no one is left standing.
- **Menus:** the in-game menu doesn't pause a shared game. Only the host can restart it.
- **Background tabs:** these get no animation frames, so a worker timer keeps the simulation (and a
  client's inputs) running while the tab is hidden.

Development builds expose `window.zombonz` (`{ simulation, playerId, net }`) for inspection.

## Not yet

- Room-code servers are done (see [server-setup.md](server-setup.md)); what is left of #39 and #40 is a lobby list, and a way to find a game without a code.
- A TURN relay for networks that block direct connections (#46).
- Reconnecting after a drop.
- An automated two-browser test (#44).
- A fuller in-game diagnostics overlay (#45); for now there is a ping readout, and the connection test above.
