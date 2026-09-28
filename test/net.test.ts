import { describe, expect, it } from 'vitest';
import { createInputFrame, type GameSimulation, type InputFrame, type SimulationEvent } from '../src/core/index.ts';
import { ASYLUM_MAP } from '../src/maps/asylum.ts';
import { createMatch, playerSpawnPoints } from '../src/maps/match.ts';
import { NetClient } from '../src/net/client.ts';
import { NetHost } from '../src/net/host.ts';
import {
  PROTOCOL_VERSION, encodeMessage, encodeSnapshotBody, fromNetInput, readClientMessage, toNetInput,
} from '../src/net/protocol.ts';
import { applySnapshot, captureSnapshot } from '../src/net/snapshot.ts';
import { CodeError, buildSdp, decodeSession, encodeSession, parseSdp } from '../src/network/codes.ts';
import { LinkHostTransport, createMemoryLinks, linkClientTransport, type MemoryLinkPair } from '../src/network/link.ts';

const map = ASYLUM_MAP;
const CHROME_OFFER = [
  'v=0', 'o=- 7359843728104729181 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=extmap-allow-mixed',
  'a=msid-semantic: WMS', 'm=application 51472 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 81.2.69.160',
  'a=candidate:3625893215 1 udp 2113937151 1f4712db-ea17-4bcf-a596-105139dfd8bf.local 51472 typ host generation 0 network-cost 999',
  'a=candidate:842163049 1 udp 1677729535 81.2.69.160 51472 typ srflx raddr 0.0.0.0 rport 0 generation 0 network-cost 999',
  'a=candidate:3625893215 1 tcp 2113937151 1f4712db-ea17-4bcf-a596-105139dfd8bf.local 9 typ host tcptype active generation 0',
  'a=candidate:1 1 udp 2113939711 2a02:c7c:5a3b:ea00::7 51473 typ host generation 0',
  'a=ice-ufrag:t3Rr', 'a=ice-pwd:jW4Q1HT0eMGm3o2+kfI2V6Zd', 'a=ice-options:trickle',
  'a=fingerprint:sha-256 4B:5E:A1:0C:4F:9E:77:33:A7:1D:0F:66:E2:3F:5C:94:12:0B:7D:8A:90:61:3C:EE:21:14:BB:4E:D0:A9:6C:37',
  'a=setup:actpass', 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144', '',
].join('\r\n');

describe('copy-paste codes', () => {
  it('pack a browser offer into a short code and rebuild it', () => {
    const session = parseSdp(CHROME_OFFER);
    expect(session.candidates).toEqual([
      { type: 'host', address: '1f4712db-ea17-4bcf-a596-105139dfd8bf.local', port: 51472 },
      { type: 'srflx', address: '81.2.69.160', port: 51472 },
      { type: 'host', address: '2a02:c7c:5a3b:ea00::7', port: 51473 },
    ]);
    const code = encodeSession('invite', session);
    expect(code.startsWith('ZBI1-')).toBe(true);
    expect(code.length).toBeLessThan(170);
    const back = decodeSession('invite', `  ${code.slice(0, 40)}\n${code.slice(40)}  `);
    const rebuilt = parseSdp(buildSdp(back));
    expect({ ...rebuilt, fingerprint: [...rebuilt.fingerprint] }).toEqual({
      ...session, fingerprint: [...session.fingerprint],
      candidates: session.candidates.map(candidate => candidate.address.includes(':')
        ? { ...candidate, address: '2a02:c7c:5a3b:ea00:0:0:0:7' } : candidate),
    });
  });

  it('explain codes pasted in the wrong box, cut short or changed', () => {
    const code = encodeSession('reply', { ...parseSdp(CHROME_OFFER), setup: 'active' });
    expect(() => decodeSession('invite', code)).toThrow(/reply code/);
    expect(() => decodeSession('reply', code.slice(0, -6))).toThrow(CodeError);
    const changed = code.slice(0, 20) + (code[20] === 'A' ? 'B' : 'A') + code.slice(21);
    expect(() => decodeSession('reply', changed)).toThrow(/changed or cut short/);
    expect(() => decodeSession('reply', 'hello')).toThrow(/not a Zombonz code/);
  });
});

describe('protocol', () => {
  it('carries buttons and the view, and never a remote cheat or restart', () => {
    const frame = createInputFrame(0);
    frame.actions.fire = { held: true, pressed: true, released: false, value: 1 };
    frame.actions.moveLeft = { held: false, pressed: false, released: true, value: 0 };
    frame.actions.toggleGodMode = { held: true, pressed: true, released: false, value: 1 };
    frame.actions.restart = { held: true, pressed: true, released: false, value: 1 };
    const input = toNetInput(frame, 7, 1.25, -0.2);
    const back = fromNetInput(input, { yaw: 1, pitch: 0 });
    expect(back.actions).toEqual({ fire: frame.actions.fire, moveLeft: frame.actions.moveLeft });
    expect(back.look.yaw).toBeCloseTo(0.25);
    expect(back.look.pitch).toBeCloseTo(-0.2);
  });

  it('refuses malformed client messages', () => {
    const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
    expect(readClientMessage(bytes({ t: 'hello', v: PROTOCOL_VERSION, name: 'Jess' }))).toEqual({ t: 'hello', v: PROTOCOL_VERSION, name: 'Jess' });
    expect(readClientMessage(bytes({ t: 'input', f: [{ s: 1, h: 0, p: 0, r: 0, y: 'x', x: 0 }] }))).toBeNull();
    expect(readClientMessage(bytes({ t: 'input', f: Array(40).fill({ s: 1, h: 0, p: 0, r: 0, y: 0, x: 0 }) }))).toBeNull();
    expect(readClientMessage(new TextEncoder().encode('{nope'))).toBeNull();
    expect(readClientMessage(bytes({ t: 'snap' }))).toBeNull();
  });
});

describe('snapshots', () => {
  it('bring a client\'s copy of the match level with the host\'s, interactables included', () => {
    const host = createMatch(map, 2, 99, { roundConfig: { initialWaitTicks: 1, intermissionTicks: 10 },
      spawnConfig: { baseZombieCount: 12, additionalPerRound: 0, maxAlive: 12, spawnIntervalTicks: 0 } });
    for (const id of host.playerIds) host.getPlayer(id)!.godMode = true;
    for (let i = 0; i < 900; i++) host.tick();
    host.state.power.on = true;
    host.state.doors[0].open = true;
    host.refreshInteractables();
    const client = createMatch(map, 2, 99);
    applySnapshot(client, structuredClone(captureSnapshot(host)));
    const canonical = (sim: GameSimulation) => JSON.stringify({ ...sim.state, world: { ...sim.state.world,
      entities: Object.fromEntries(Object.entries(sim.state.world.entities).sort(([a], [b]) => a.localeCompare(b))) } });
    expect(Object.values(host.state.world.entities).filter(entity => entity.kind === 'zombie').length).toBeGreaterThan(0);
    expect(canonical(client)).toBe(canonical(host));
  });

  it('stay small enough to send twenty times a second', () => {
    const host = createMatch(map, 4, 1, { roundConfig: { initialWaitTicks: 1, intermissionTicks: 10 },
      spawnConfig: { baseZombieCount: 24, additionalPerRound: 0, maxAlive: 24, spawnIntervalTicks: 0 } });
    for (const id of host.playerIds) host.getPlayer(id)!.godMode = true;
    for (let i = 0; i < 900; i++) host.tick();
    expect(encodeSnapshotBody(captureSnapshot(host)).length).toBeLessThan(16_000);
  });
});

/** A host and clients on in-memory links: messages cross once per tick, like one tick of latency. */
function session(clientCount: number, options: { lossy?: boolean } = {}) {
  const transport = new LinkHostTransport();
  const links: MemoryLinkPair[] = [];
  const host = new NetHost(transport, 'Host', 'asylum');
  const clients = Array.from({ length: clientCount }, (_, index) => {
    const pair = createMemoryLinks();
    links.push(pair);
    let dropped = 0;
    if (options.lossy) pair.dropUnreliable(() => (dropped = (dropped + 1) % 3) === 0);
    transport.addPeer(`peer-${index}`, pair.a);
    return new NetClient(linkClientTransport(pair.b), `Friend ${index + 1}`);
  });
  const flush = () => { for (let round = 0; round < 6 && links.reduce((sum, pair) => sum + pair.flush(), 0) > 0; round++) { /* settle */ } };
  flush();
  return { transport, links, host, clients, flush };
}
function startMatch(net: ReturnType<typeof session>) {
  const seed = 1234;
  const hostSim = createMatch(map, net.clients.length + 1, seed, { roundConfig: { initialWaitTicks: 99999, intermissionTicks: 1 } });
  const clientSims: GameSimulation[] = [];
  net.clients.forEach(client => client.started.add(start => {
    const sim = createMatch(map, start.players.length, start.seed);
    clientSims.push(sim);
    client.attach(sim, sim.playerIds[start.slot], { collision: () => sim.collisionBoxes(), walkSurfaces: map.walkSurfaces, shotBlockers: map.shotBlockers });
  }));
  net.host.start(seed);
  net.host.attach(hostSim);
  net.flush();
  const clientEvents: SimulationEvent[][] = net.clients.map(() => []);
  const tick = (inputs: Array<(tick: number) => InputFrame> = []) => {
    const events = hostSim.tick(net.host.inputs());
    net.host.publish(events);
    net.clients.forEach((client, index) => {
      const frame = inputs[index]?.(hostSim.state.world.tick) ?? createInputFrame(0);
      clientEvents[index].push(...client.step(frame), ...client.frame(1 / 60).events);
    });
    net.flush();
  };
  return { hostSim, clientSims, tick, clientEvents };
}
const walkForward = (): InputFrame => {
  const frame = createInputFrame(0);
  frame.actions.moveForward = { held: true, pressed: false, released: false, value: 1 };
  return frame;
};

describe('co-op sessions', () => {
  it('fill the lobby in join order and start everyone together', () => {
    const net = session(2);
    expect(net.host.lobby().map(player => player.name)).toEqual(['Host', 'Friend 1', 'Friend 2']);
    expect(net.clients.map(client => [client.phase, client.slot])).toEqual([['lobby', 1], ['lobby', 2]]);
    expect(net.clients[1].players.map(player => player.name)).toEqual(['Host', 'Friend 1', 'Friend 2']);
    const match = startMatch(net);
    expect(match.clientSims).toHaveLength(2);
    expect(net.clients.every(client => client.phase === 'game')).toBe(true);
  });

  it('turn away a fifth player, a different version, and anyone after the start', () => {
    const net = session(3);
    const pair = createMemoryLinks();
    net.links.push(pair);
    net.transport.addPeer('late', pair.a);
    const fifth = new NetClient(linkClientTransport(pair.b), 'Fifth');
    net.flush();
    expect(fifth.phase).toBe('closed');
    expect(fifth.closeReason).toMatch(/full/);

    const other = session(0);
    const versionPair = createMemoryLinks();
    other.transport.addPeer('old', versionPair.a);
    const client = linkClientTransport(versionPair.b);
    const replies: string[] = [];
    client.onMessage(message => replies.push(new TextDecoder().decode(message.payload)));
    client.sendReliable(encodeMessage({ t: 'hello', v: PROTOCOL_VERSION + 1, name: 'Old' }));
    versionPair.flush(); versionPair.flush();
    expect(replies.join()).toMatch(/different version/);

    startMatch(other);
    const latePair = createMemoryLinks();
    other.transport.addPeer('after', latePair.a);
    const late = new NetClient(linkClientTransport(latePair.b), 'Late');
    latePair.flush(); latePair.flush();
    expect(late.closeReason).toMatch(/already started/);
  });

  it('move a client\'s player on the host from its inputs, while it predicts the same place', () => {
    const net = session(2);
    const match = startMatch(net);
    for (let i = 0; i < 120; i++) match.tick([walkForward]);
    for (let i = 0; i < 20; i++) match.tick();
    const hostCopy = match.hostSim.getPlayer(match.hostSim.playerIds[1])!;
    const spawn = playerSpawnPoints(map, 3)[1];
    expect(Math.hypot(hostCopy.position.x - spawn.x, hostCopy.position.z - spawn.z)).toBeGreaterThan(3);
    const predicted = match.clientSims[0].getPlayer(match.clientSims[0].playerIds[1])!;
    expect(Math.hypot(predicted.position.x - hostCopy.position.x, predicted.position.z - hostCopy.position.z)).toBeLessThan(0.01);
    // The other client sees them there too (drawn a little in the past, but settled by now).
    const seen = match.clientSims[1].getPlayer(match.clientSims[1].playerIds[1])!;
    expect(Math.hypot(seen.position.x - hostCopy.position.x, seen.position.z - hostCopy.position.z)).toBeLessThan(0.01);
    expect(net.clients[0].pingMs).not.toBeNull();
  });

  it('lose no input when a third of the fast packets are dropped', () => {
    const net = session(1, { lossy: true });
    const match = startMatch(net);
    let fired = 0;
    for (let i = 0; i < 90; i++) match.tick([tick => {
      const frame = walkForward();
      if (i % 20 === 0) { frame.actions.reload = { held: true, pressed: true, released: false, value: 1 }; fired++; }
      return frame;
    }]);
    for (let i = 0; i < 30; i++) match.tick();
    const hostCopy = match.hostSim.getPlayer(match.hostSim.playerIds[1])!;
    const predicted = match.clientSims[0].getPlayer(match.clientSims[0].playerIds[1])!;
    expect(fired).toBeGreaterThan(0);
    expect(Math.hypot(predicted.position.x - hostCopy.position.x, predicted.position.z - hostCopy.position.z)).toBeLessThan(0.01);
  });

  it('play a client\'s own shots at once, and other players\' shots from the host', () => {
    const net = session(2);
    const match = startMatch(net);
    const shoot = () => {
      const frame = createInputFrame(0);
      frame.actions.fire = { held: true, pressed: true, released: false, value: 1 };
      return frame;
    };
    for (let i = 0; i < 10; i++) match.tick(); // Prediction starts with the first snapshot.
    match.tick([shoot]);
    expect(match.clientEvents[0].filter(event => event.type === 'weaponFired')).toHaveLength(1);
    for (let i = 0; i < 20; i++) match.tick();
    // Heard once, not again when the host's copy arrives; the second client hears it from the host.
    expect(match.clientEvents[0].filter(event => event.type === 'weaponFired')).toHaveLength(1);
    expect(match.clientEvents[1].filter(event => event.type === 'weaponFired')).toHaveLength(1);
  });

  it('draw between snapshots that arrive out of order or not at all', () => {
    const net = session(2);
    const match = startMatch(net);
    // Hold every third snapshot back behind the next one, and lose every fourth.
    const isSnapshot = (payload: Uint8Array) => new TextDecoder().decode(payload.subarray(0, 8)) === '{"t":"sn';
    let held = 0, lost = 0;
    net.links[0].delayUnreliable(payload => isSnapshot(payload) && ++held % 3 === 0);
    net.links[0].dropUnreliable(payload => isSnapshot(payload) && ++lost % 4 === 0);
    for (let i = 0; i < 90; i++) match.tick([() => createInputFrame(0), walkForward]);
    const decoded = (sim: GameSimulation) => sim.getPlayer(sim.playerIds[2])!.position;
    const drawn = decoded(match.clientSims[0]), truth = match.hostSim.getPlayer(match.hostSim.playerIds[2])!.position;
    // Drawn a few ticks in the past: close behind the host, moving the same way, never ahead of it.
    const spawn = playerSpawnPoints(map, 3)[2];
    expect(Math.hypot(drawn.x - spawn.x, drawn.z - spawn.z)).toBeGreaterThan(1);
    expect(Math.hypot(drawn.x - truth.x, drawn.z - truth.z)).toBeLessThan(1);
    let previous = -Infinity;
    for (let i = 0; i < 30; i++) {
      const frame = net.clients[0].frame(1 / 60);
      expect(frame.tick).toBeGreaterThanOrEqual(previous - 1e-9);
      expect(frame.alpha).toBeGreaterThanOrEqual(0); expect(frame.alpha).toBeLessThanOrEqual(1);
      previous = frame.tick;
    }
  });

  it('take a disconnected player out and tell the others', () => {
    const net = session(2);
    const match = startMatch(net);
    const notices: string[] = [];
    net.clients[1].notices.add(notice => notices.push(notice));
    for (let i = 0; i < 10; i++) match.tick();
    net.links[0].a.close('gone');
    for (let i = 0; i < 10; i++) match.tick();
    const gone = match.hostSim.playerIds[1];
    expect(match.hostSim.getPlayer(gone)!.alive).toBe(false);
    expect(match.hostSim.state.leftPlayers).toEqual([gone]);
    expect(notices).toEqual(['Friend 1 left the game']);
    expect(match.clientSims[1].getPlayer(gone)!.alive).toBe(false);
    expect(net.clients[0].phase).toBe('closed');
  });

  it('follow the host into a restarted match, and close when the host leaves', () => {
    const net = session(1);
    const match = startMatch(net);
    for (let i = 0; i < 30; i++) match.tick();
    const restart = createInputFrame(0);
    restart.actions.restart = { held: true, pressed: true, released: false, value: 1 };
    Object.assign(match.hostSim.state.round, { phase: 'gameOver' });
    const events = match.hostSim.tick({ [match.hostSim.playerIds[0]]: restart, ...net.host.inputs() });
    net.host.publish(events);
    net.flush();
    for (let i = 0; i < 20; i++) match.tick();
    expect(match.clientSims[0].state.world.seed).toBe(match.hostSim.state.world.seed);
    expect(match.clientEvents[0].map(event => event.type)).toContain('matchRestarted');
    net.host.close();
    net.flush();
    expect(net.clients[0].phase).toBe('closed');
    expect(net.clients[0].closeReason).toMatch(/host left/);
  });
});
