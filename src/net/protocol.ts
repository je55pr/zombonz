import { PLAYER_MOVEMENT } from '../core/player.ts';
import type { GameAction, InputFrame } from '../core/input.ts';
import type { SimulationEvent } from '../core/simulation.ts';
import type { MapId } from '../maps/catalog.ts';
import type { WorldSnapshot } from './snapshot.ts';

/** Bumped whenever messages or snapshots change shape; mismatched builds refuse to connect. */
export const PROTOCOL_VERSION = 7;
export const MAX_PLAYERS = 4;
/** The host sends a snapshot every third tick: 20 a second. */
export const SNAPSHOT_INTERVAL_TICKS = 3;

export interface LobbyPlayer { slot: number; name: string }

/**
 * One tick of a client's input: sequence number, held/pressed/released buttons as bitmasks over
 * `NET_ACTIONS`, and the absolute view yaw and pitch. The view is the client's to aim (as in most
 * shooters), so the host adopts it and a correction never swings the camera.
 */
export interface NetInput { s: number; h: number; p: number; r: number; y: number; x: number }

export type ClientMessage =
  | { t: 'hello'; v: number; name: string }
  /** Loaded and ready to play; the host holds the first wave until everyone is. */
  | { t: 'ready' }
  | { t: 'input'; f: NetInput[] };

export type HostMessage =
  | { t: 'welcome'; slot: number }
  | { t: 'reject'; reason: string }
  | { t: 'lobby'; map: MapId; players: LobbyPlayer[] }
  | { t: 'start'; map: MapId; seed: number; players: LobbyPlayer[] }
  /** `ep` counts restarts; `ack` is the last of this client's inputs the host has used. */
  | { t: 'snap'; ep: number; ack: number; s: WorldSnapshot }
  | { t: 'ev'; ep: number; k: number; e: SimulationEvent[] }
  | { t: 'left'; slot: number; name: string }
  | { t: 'end'; reason: string };

/** Button order for the input bitmasks. Only append: reordering changes the protocol. */
export const NET_ACTIONS: readonly GameAction[] = [
  'moveForward', 'moveBackward', 'moveLeft', 'moveRight', 'sprint', 'aim', 'fire', 'reload', 'melee',
  'throwGrenade', 'switchWeapon', 'interact', 'toggleGodMode', 'toggleNoclip', 'flyUp', 'flyDown', 'restart',
  'placeMine',
  'jump', 'crouch', 'prone', 'cancelGrenade',
];
/** Actions only the host's own keyboard may use in a shared game: cheats, and restarting the match. */
export const HOST_ONLY_ACTIONS: ReadonlySet<GameAction> = new Set(['toggleGodMode', 'toggleNoclip', 'flyUp', 'flyDown', 'restart']);

export function toNetInput(frame: InputFrame, sequence: number, yaw: number, pitch: number): NetInput {
  let h = 0, p = 0, r = 0;
  NET_ACTIONS.forEach((action, bit) => {
    const state = frame.actions[action];
    if (!state || HOST_ONLY_ACTIONS.has(action)) return;
    if (state.held) h |= 1 << bit;
    if (state.pressed) p |= 1 << bit;
    if (state.released) r |= 1 << bit;
  });
  return { s: sequence, h, p, r, y: yaw, x: pitch };
}

/** The input frame that turns `player`'s view to the input's view and applies its buttons. */
export function fromNetInput(input: NetInput, view: { yaw: number; pitch: number }): InputFrame {
  const actions: InputFrame['actions'] = {};
  NET_ACTIONS.forEach((action, bit) => {
    if (HOST_ONLY_ACTIONS.has(action)) return;
    const held = (input.h >> bit & 1) === 1, pressed = (input.p >> bit & 1) === 1, released = (input.r >> bit & 1) === 1;
    if (held || pressed || released) actions[action] = { held, pressed, released, value: held ? 1 : 0 };
  });
  return { sequence: input.s, actions, look: { yaw: input.y - view.yaw, pitch: input.x - view.pitch } };
}

/** Several queued inputs folded into one tick: the latest buttons and view, and every press or release. */
export function mergeNetInputs(inputs: readonly NetInput[]): NetInput {
  const last = inputs[inputs.length - 1];
  return { ...last, p: inputs.reduce((bits, input) => bits | input.p, 0), r: inputs.reduce((bits, input) => bits | input.r, 0) };
}

export function clampPitch(pitch: number): number {
  return Math.max(-PLAYER_MOVEMENT.maxPitch, Math.min(PLAYER_MOVEMENT.maxPitch, pitch));
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
/** Positions and timers only need a tenth of a millimetre; trimming the digits halves a snapshot. */
function trimNumbers(_key: string, value: unknown): unknown {
  return typeof value === 'number' && !Number.isInteger(value) ? Math.round(value * 1e4) / 1e4 : value;
}

export function encodeMessage(message: HostMessage | ClientMessage): Uint8Array {
  return encoder.encode(JSON.stringify(message, message.t === 'snap' ? trimNumbers : undefined));
}
/** One snapshot, encoded once and shared by every client's message (only the acknowledgement differs). */
export function encodeSnapshotBody(snapshot: WorldSnapshot): string {
  return JSON.stringify(snapshot, trimNumbers);
}
export function encodeSnapshotMessage(epoch: number, ack: number, body: string): Uint8Array {
  return encoder.encode(`{"t":"snap","ep":${epoch},"ack":${ack},"s":${body}}`);
}

export function decodeMessage(payload: Uint8Array): { t: string; [key: string]: unknown } | null {
  try {
    const value: unknown = JSON.parse(decoder.decode(payload));
    return value && typeof value === 'object' && typeof (value as { t?: unknown }).t === 'string'
      ? value as { t: string } : null;
  } catch {
    return null;
  }
}

const isInt = (value: unknown): value is number => Number.isSafeInteger(value);
const isFinite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
/** Checks a message from a client, who may be running a modified page. Returns null if malformed. */
export function readClientMessage(payload: Uint8Array): ClientMessage | null {
  const message = decodeMessage(payload);
  if (!message) return null;
  if (message.t === 'hello') {
    return isInt(message.v) && typeof message.name === 'string'
      ? { t: 'hello', v: message.v, name: message.name } : null;
  }
  if (message.t === 'ready') return { t: 'ready' };
  if (message.t === 'input' && Array.isArray(message.f) && message.f.length <= 16) {
    const frames = message.f as NetInput[];
    const valid = frames.every(frame => frame && isInt(frame.s) && frame.s >= 0 && isInt(frame.h) && isInt(frame.p)
      && isInt(frame.r) && isFinite(frame.y) && isFinite(frame.x));
    return valid ? { t: 'input', f: frames.map(frame => ({ s: frame.s, h: frame.h, p: frame.p, r: frame.r, y: frame.y, x: clampPitch(frame.x) })) } : null;
  }
  return null;
}

/** A player name as typed: trimmed, one line, at most 16 characters. */
export function cleanName(name: string, fallback: string): string {
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
  return cleaned || fallback;
}
