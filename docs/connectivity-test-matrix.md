# NAT and connectivity test matrix

Issue #47. This is the repeatable connectivity checklist for Zombonz multiplayer.

The matrix separates two kinds of evidence:

- **Automated** means CI can prove the application contract without requiring a particular ISP/router.
- **Manual network** means the result depends on real NAT/firewall behavior and needs two devices or two genuinely separate networks.

A passing local/CI WebRTC test does **not** prove every NAT topology. It proves the browser, signalling path, protocol, reconnect contract and direct WebRTC path still work.

## Matrix

| Scenario | Setup | Expected WebRTC path | Expected Zombonz behavior | Automated coverage | Manual network check |
| --- | --- | --- | --- | --- | --- |
| Same machine | Two isolated browser contexts on one computer | Direct host candidate | Room opens, client joins, match starts, movement replicates | e2e/multiplayer.pw.ts | Not needed for the same-machine case |
| Same LAN | Two devices on the same router/Wi-Fi, VPN off | Normally direct host-to-host candidate; STUN/TURN should not be required for the selected path | Room join and match should work even though each browser may also gather public candidates | Candidate parsing/unit tests only | **Required** |
| Normal NAT, separate networks | Two ordinary networks where Test my connection reports the same public IPv4 port mapping, or otherwise reports GOOD without needing TURN | Direct server-reflexive (srflx) candidate pair, or IPv6 direct | Join succeeds without relay; F4 diagnostics remain connected | NAT classification + real browser direct WebRTC smoke | **Required** |
| Restrictive NAT with TURN | At least one side reports different public ports / blocked direct path, and the deployed build reports a TURN relay candidate | Relay (relay) candidate from TURN | Join succeeds through relay | TURN config/diagnostic classification | **Required**, because CI has no real TURN service |
| Restrictive NAT without TURN | At least one side reports symmetric/restrictive NAT and there is no usable IPv6/TURN route | No viable candidate pair | Connection should fail with a useful direct/relay explanation rather than hanging indefinitely | NAT verdict + connection timeout tests | Recommended |
| Client refresh during room-code match | Start a room-code match, refresh the client page, re-enter Multiplayer → Join Game within 30 s | Fresh WebRTC connection through signalling, then resume-token reclaim | Same authoritative slot/player is restored and play continues | **Real Chromium E2E** + host/client unit tests | Optional sanity check |
| Short client disconnect | Drop a client transport/network for less than 30 s | Existing WebRTC dies; fresh room-code WebRTC on rejoin | Player is removed immediately, slot is reserved, reconnect token restores the same slot/state | test/net.test.ts | Recommended |
| Reconnect after 30 s | Disconnect a client and wait past the reservation window | Fresh WebRTC can form, but resume token is no longer valid | Reconnect is rejected with an expired-window message; no mid-match new player is admitted | test/net.test.ts | Optional |
| Host disconnect / refresh | Close or refresh the host | Host-owned simulation and signalling room end | Clients are told the host left and return to the menu; there is no host migration | room server/signalling/net tests | Recommended |
| Signalling server disappears after peers connected | Kill/block the room server after WebRTC is already open | Existing peer-to-peer connection remains | Existing players continue; new joins/reconnects are unavailable until signalling returns | room-link unit tests | Optional |
| Copy-paste client disconnect | Use connection-code fallback, then lose WebRTC mid-match | Existing direct WebRTC dies | Authoritative 30 s reservation still exists, but there is currently no in-game way to negotiate a replacement copy-paste link | token logic only | Known limitation |

## Standard evidence to collect

For any manual row, record all of the following so a failure is useful rather than just “multiplayer broke”:

1. Build SHA shown by the deployment/commit under test.
2. Browser + OS for both players.
3. Whether each player is on LAN, broadband, hotspot/mobile, VPN, school/work network, etc.
4. Multiplayer → Test my connection output from both players.
5. Room-code or copy-paste connection path.
6. Whether the match reached the lobby and game.
7. Press F4 in-match and record connection state, RTT, snapshot rate/loss and latest transport error.
8. If the path itself matters, inspect the browser's WebRTC internals and record the selected candidate types:
   - Chromium: chrome://webrtc-internals
   - Firefox: about:webrtc
   - Look for the selected candidate pair and whether it is host, srflx or relay.
9. On failure, use Copy log from the multiplayer lobby where available.

Do not paste TURN credentials, full SDP, or raw IP addresses into a public issue. The built-in connection report deliberately leaves addresses and credentials out.

## Manual recipes

### 1. Same LAN

Purpose: prove two physical devices can use the local path without depending on internet NAT traversal.

1. Put both devices on the same home router/Wi-Fi.
2. Disable VPNs. If a phone has mobile data enabled, turn it off for this test so both devices are unambiguously on the LAN.
3. Load the same Zombonz build on both devices.
4. Run Test my connection on both and save the reports. The report may still mention STUN/public addresses; that is normal.
5. On device A choose Multiplayer → Host Game. On device B choose Join Game and enter the room code.
6. Start the match, move/shoot on B and confirm A sees it.
7. Open WebRTC internals. The preferred result is a selected direct local/host candidate pair with no relay.
8. Leave the match running for at least 60 seconds and confirm F4 stays connected with snapshots arriving.

Pass: lobby + gameplay work and TURN is not required for the selected pair.

Important limitation: **Test my connection cannot prove that a future peer is on the same LAN.** If STUN is blocked it may report PROBLEM even though a same-LAN peer can still be reachable through host candidates. Do not treat that single-browser diagnostic as a same-LAN oracle.

### 2. Normal NAT across two networks

Purpose: exercise ordinary internet NAT traversal.

1. Use two genuinely separate internet connections. Two home broadband connections are ideal.
2. Avoid using a mobile hotspot as the “normal NAT” side unless its connection report actually shows a non-restrictive mapping.
3. Run Test my connection on both. For this row, use networks where the report is GOOD without relying on TURN, typically one stable public IPv4 port across the STUN destinations and/or usable IPv6.
4. Host on one network and join from the other using the room code.
5. Start the match and play for at least 60 seconds.
6. Verify F4 remains connected and the client receives snapshots.
7. In WebRTC internals, record the selected pair. Across IPv4 NAT the expected candidate type is usually srflx; native IPv6 may use a direct candidate instead.

Pass: the game connects and remains playable without a relay candidate being selected.

### 3. Restrictive NAT with TURN

Purpose: prove the fallback that #46 prepared actually carries a real match.

Prerequisite: the deployed build must have real TURN configuration and Test my connection must say that at least one relay candidate was found.

1. Use a network that the connection report identifies as restrictive, for example different public ports by destination or blocked direct UDP. Do not assume “mobile” automatically means restrictive; use the report as evidence.
2. Confirm Test my connection says Relay (TURN): ... relay candidate found.
3. Connect to a player on another network and start a match.
4. Inspect WebRTC internals. For a test that genuinely defeated the direct route, the selected candidate pair must include a relay candidate.
5. Play for at least 60 seconds and inspect F4 for stable snapshots/RTT.
6. Repeat once with the restrictive side hosting and once joining if practical.

Pass: the selected route uses TURN and the match remains functional.

If a relay candidate is gathered but a direct candidate wins, that proves TURN is reachable but does **not** prove the relay fallback carries game traffic. Use a network where direct traversal actually fails before marking this row passed.

### 4. Restrictive NAT without TURN

1. Use the same confirmed restrictive network, but a build with TURN unset/unavailable.
2. Run Test my connection and save the result.
3. Attempt the room connection.
4. Confirm it fails within the normal connection timeout with a message explaining that direct WebRTC failed and no working relay is available.

Pass: failure is bounded and explained. This row is a negative test.

### 5. Client refresh and reconnect

Room-code flow only:

1. Start a two-player match.
2. Note the joining player's score/inventory/position if useful.
3. Refresh the **client** page.
4. Within 30 seconds choose Multiplayer → Join Game. The previous room code is prefilled for the same tab/session.
5. Press Join. The UI should say Reconnecting... when the saved resume token is present.
6. The client should return to the running match in the same authoritative slot with its saved match state.
7. Move and confirm the host receives movement again.

Pass: same slot is reclaimed and gameplay resumes.

CI also performs this flow in a real Chromium pair. The test reloads the client page, creates a new WebRTC connection, reuses the stored token, verifies the same slot/player ID and moves again.

### 6. Client disconnect window

1. Start a room-code match.
2. Disconnect the client's network or close its page.
3. Confirm the remaining player sees that the client left and the host simulation removes that player from active play.
4. Rejoin within 30 seconds using the same browser tab/session and room code.
5. Confirm the slot/state is restored.
6. Repeat, but wait more than 30 seconds before attempting the resume.

Pass:
- under 30 s: same slot is reclaimed;
- over 30 s: resume is rejected as expired.

The 30-second timing and state restoration are deterministic unit-tested contracts, so a physical-network test is mostly checking UI/browser integration.

### 7. Host disconnect

1. Start a room-code match.
2. Close or refresh the host.
3. Confirm clients receive the host-left/end condition and cannot continue the old match.
4. Confirm the old room is no longer a resumable authoritative game.

Pass: clients fail cleanly back to a menu/error state. Zombonz currently has no host migration.

## Automated coverage map

| Contract | Coverage |
| --- | --- |
| Candidate parsing and host/srflx/relay classification | test/connection-test.test.ts |
| Normal mapping vs different-port/symmetric-NAT diagnosis | test/connection-test.test.ts |
| TURN configured, missing, unreachable and relay-candidate verdicts | test/ice-config.test.ts, test/connection-test.test.ts |
| Room signalling and trickle ICE | test/signaling.test.ts, test/room-link.test.ts |
| Bounded connection failure | test/room-link.test.ts, test/timed-start.test.ts |
| Client removed on disconnect | test/net.test.ts |
| Resume token restores exact slot/state inside 30 s | test/net.test.ts |
| Expired resume token rejected | test/net.test.ts |
| Host departure closes clients | test/net.test.ts, test/room-server.test.ts |
| Real browser room WebRTC + gameplay replication | e2e/multiplayer.pw.ts |
| Real browser client refresh + fresh WebRTC + same-slot resume | e2e/multiplayer.pw.ts |

## Known limitations

- CI runs both Chromium peers on one machine. It cannot manufacture a consumer router, carrier-grade NAT, school firewall or genuine TURN relay path.
- There is currently no real TURN service configured in this repository, so the restrictive-NAT/TURN row remains a manual future infrastructure test even though TURN configuration and candidate handling are automated.
- One browser cannot know the topology of the peer it has not connected to yet. The connection diagnostic estimates NAT behavior; it cannot guarantee that two future peers will or will not connect.
- Same-LAN success can disagree with the public-STUN diagnostic if outbound STUN is blocked but local host candidates are usable.
- Candidate gathering does not prove candidate **selection**. To prove TURN carried the game, inspect the selected pair and see a relay candidate.
- Browser privacy features can replace LAN IPs with mDNS .local host candidates. This is normal.
- The room-code flow can renegotiate a fresh WebRTC link and reclaim a slot. The copy-paste fallback currently cannot renegotiate an in-game link after a drop.
- A reconnect token is stored in sessionStorage, so it survives refresh in the same tab/session but is not intended as a cross-browser/cross-device account credential.
- The host is authoritative. Host refresh/exit ends the match; there is no host migration.
- A signalling outage does not kill WebRTC links that are already established, but it prevents new joins and room-code reconnects until signalling is available again.

## When to update this matrix

Update the row and its automated/manual coverage whenever any of these change:

- ICE/STUN/TURN configuration,
- connection timeout behavior,
- room signalling,
- reconnect window/token storage,
- host migration,
- copy-paste reconnect support,
- supported browser targets,
- network diagnostics or F4 telemetry.
