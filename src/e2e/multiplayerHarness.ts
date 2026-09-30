import { createInputFrame, type GameSimulation } from '../core/index.ts';
import type { EntityId } from '../core/types.ts';
import { ASYLUM_MAP } from '../maps/asylum.ts';
import { createMatch, playerSpawnPoints } from '../maps/match.ts';
import { NetClient } from '../net/client.ts';
import { NetHost } from '../net/host.ts';
import { LinkHostTransport, linkClientTransport } from '../network/link.ts';
import { hostRoom, joinRoom, type RoomHost, type RoomJoin } from '../network/roomLink.ts';

type Role = 'host' | 'client';
interface HarnessSnapshot {
  role: Role;
  phase: string;
  room: string | null;
  players: number;
  slot: number | null;
  playerId: EntityId | null;
  position: { x: number; y: number; z: number } | null;
  positions: Record<string, { x: number; y: number; z: number }>;
  spawnDistance: number | null;
  ticks: number;
  log: string;
}
interface HarnessApi {
  snapshot(): HarnessSnapshot;
  start(): void;
  setMoving(value: boolean): void;
  dispose(): void;
}

declare global {
  interface Window { zombonzE2E?: HarnessApi }
}

const TICK_MS = 1000 / 60;
const logLines: string[] = [];
const note = (text: string) => {
  const line = `${new Date().toISOString()} ${text}`;
  logLines.push(line);
  console.info(`[multiplayer-e2e] ${text}`);
  document.body.dataset.e2eLog = logLines.join('\n');
};
function playerSnapshot(role: Role, room: string | null, phase: string, simulation: GameSimulation | null,
  playerId: EntityId | null, slot: number | null, players = simulation?.playerIds.length ?? 0): HarnessSnapshot {
  const player = playerId ? simulation?.getPlayer(playerId) : null;
  const spawn = slot !== null ? playerSpawnPoints(ASYLUM_MAP, Math.max(2, slot + 1))[slot] : null;
  const distance = player && spawn ? Math.hypot(player.position.x - spawn.x, player.position.z - spawn.z) : null;
  const positions = simulation ? Object.fromEntries(simulation.playerIds.map(id => {
    const current = simulation!.getPlayer(id);
    return [id, current ? { ...current.position } : { x: 0, y: 0, z: 0 }];
  })) : {};
  return {
    role, phase, room, players, slot, playerId,
    position: player ? { ...player.position } : null, positions,
    spawnDistance: distance, ticks: simulation?.state.world.tick ?? 0, log: logLines.join('\n'),
  };
}

async function bootHost(): Promise<HarnessApi> {
  const transport = new LinkHostTransport();
  const host = new NetHost(transport, 'Browser Host', 'asylum');
  let simulation: GameSimulation | null = null;
  let roomHandle: RoomHost | null = null;
  let interval = 0;
  let phase = 'opening-room';

  roomHandle = await hostRoom({
    onPeer: (link, _id, serial) => {
      note(`WebRTC peer ${serial} connected`);
      transport.addPeer(`browser-${serial}`, link);
      phase = 'lobby';
    },
    onPeerFailed: (_id, reason) => { phase = 'peer-failed'; note(`peer failed: ${reason}`); },
    onServerLost: reason => note(`signal server lost: ${reason ?? 'unknown'}`),
  });
  phase = 'room-open';
  note(`room ${roomHandle.room} open`);

  const api: HarnessApi = {
    snapshot: () => playerSnapshot('host', roomHandle?.room ?? null, phase, simulation,
      simulation?.playerIds[0] ?? null, 0, simulation?.playerIds.length ?? host.lobby().length),
    start: () => {
      if (simulation || host.lobby().length < 2) return;
      const seed = 0x44e2e;
      const players = host.start(seed);
      simulation = createMatch(ASYLUM_MAP, players.length, seed, {
        roundConfig: { initialWaitTicks: 999999, intermissionTicks: 1 },
      });
      host.attach(simulation);
      phase = 'game';
      note(`game started with ${players.length} players`);
      interval = window.setInterval(() => {
        if (!simulation) return;
        const events = simulation.tick(host.inputs());
        host.publish(events);
      }, TICK_MS);
    },
    setMoving: () => {},
    dispose: () => {
      if (interval) clearInterval(interval);
      host.close('e2e finished');
      roomHandle?.close();
      roomHandle = null;
    },
  };
  return api;
}

async function bootClient(room: string): Promise<HarnessApi> {
  let phase = 'joining-room';
  let simulation: GameSimulation | null = null;
  let playerId: EntityId | null = null;
  let moving = false;
  let interval = 0;
  const join: RoomJoin = await joinRoom(room);
  note(`joined signalling room ${room}`);
  const link = await join.connected;
  phase = 'webrtc-open';
  note('WebRTC link to host connected');
  const client = new NetClient(linkClientTransport(link), 'Browser Client');

  client.started.add(start => {
    simulation = createMatch(ASYLUM_MAP, start.players.length, start.seed, {
      roundConfig: { initialWaitTicks: 999999, intermissionTicks: 1 },
    });
    playerId = simulation.playerIds[start.slot] ?? null;
    if (!playerId) throw new Error(`No player for slot ${start.slot}`);
    client.attach(simulation, playerId, {
      collision: () => simulation!.collisionBoxes(),
      walkSurfaces: ASYLUM_MAP.walkSurfaces,
      shotBlockers: ASYLUM_MAP.shotBlockers,
    });
    phase = 'game';
    note(`game started in slot ${start.slot} as ${playerId}`);
    interval = window.setInterval(() => {
      const frame = createInputFrame(0);
      if (moving) frame.actions.moveForward = { held: true, pressed: false, released: false, value: 1 };
      client.step(frame);
      client.frame(1 / 60);
    }, TICK_MS);
  });
  client.closed.add(reason => { phase = 'closed'; note(`client closed: ${reason}`); });

  return {
    snapshot: () => playerSnapshot('client', room, phase, simulation, playerId, client.slot,
      simulation?.playerIds.length ?? client.players.length),
    start: () => {},
    setMoving: value => { moving = value; note(`moveForward ${value ? 'on' : 'off'}`); },
    dispose: () => {
      if (interval) clearInterval(interval);
      client.leave();
      join.cancel();
    },
  };
}
export async function bootMultiplayerHarness(): Promise<void> {
  document.body.innerHTML = '<main><h1>Zombonz multiplayer E2E</h1><pre data-e2e-status>booting</pre></main>';
  const params = new URLSearchParams(location.search);
  const role = params.get('role');
  if (role !== 'host' && role !== 'client') throw new Error('E2E harness requires role=host or role=client.');
  const room = params.get('room');
  if (role === 'client' && !room) throw new Error('Client E2E harness requires a room code.');

  const api = role === 'host' ? await bootHost() : await bootClient(room!);
  window.zombonzE2E = api;
  const status = document.querySelector<HTMLElement>('[data-e2e-status]')!;
  const render = () => {
    const snapshot = api.snapshot();
    status.textContent = JSON.stringify(snapshot, null, 2);
    document.body.dataset.e2ePhase = snapshot.phase;
  };
  render();
  const display = window.setInterval(render, 100);
  window.addEventListener('pagehide', () => { clearInterval(display); api.dispose(); }, { once: true });
}
