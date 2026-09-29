import { describe, expect, it } from 'vitest';
import {
  FixedStepClock,
  SeededRng,
  addEntity,
  allocateEntityId,
  createInputFrame,
  createWorld,
  origin,
  removeEntity,
} from '../src/core/index.ts';

describe('SeededRng', () => {
  it('replays the same sequence for the same seed', () => {
    const a = new SeededRng(12345);
    const b = new SeededRng(12345);
    expect(Array.from({ length: 12 }, () => a.nextUint32()))
      .toEqual(Array.from({ length: 12 }, () => b.nextUint32()));
  });

  it('produces bounded integer values', () => {
    const rng = new SeededRng(7);
    for (let i = 0; i < 100; i += 1) {
      expect(rng.int(2, 5)).toBeGreaterThanOrEqual(2);
      expect(rng.int(2, 5)).toBeLessThan(5);
    }
  });
});

describe('FixedStepClock', () => {
  it('produces equal simulation ticks across render frame pacing', () => {
    const run = (frames: number[]) => {
      const clock = new FixedStepClock({ tickRate: 60, maxFrameSeconds: 1 });
      let ticks = 0;
      for (const frame of frames) clock.advance(frame, () => { ticks += 1; });
      return ticks;
    };

    expect(run(Array(60).fill(1 / 60))).toBe(60);
    expect(run(Array(20).fill(1 / 20))).toBe(60);
    expect(run([0.1, 0.4, 0.2, 0.3])).toBe(60);
  });
});

describe('world state', () => {
  it('allocates stable ids and remains JSON serializable', () => {
    const world = createWorld(99);
    const id = allocateEntityId(world);
    addEntity(world, {
      id, kind: 'player', alive: true, position: origin(), velocity: origin(), perks: [], downed: null, selfRevives: 0,
      godMode: false, noclip: false, noclipAnchor: null, sprinting: false, sprintTicks: 240, sprintRechargeDelayTicks: 0, aiming: false, spreadBloom: 0,
      recoveryDelayTicks: 0, meleeCooldownTicks: 0, grenadeCharges: 2, mineCharges: 0,
      repairRewardRound: 0, repairPointsEarned: 0,
      holsteredWeapon: null, switchTicksRemaining: 0,
      yaw: 0, pitch: 0, health: 100, points: 500, pointsEarned: 500, kills: 0, headshots: 0,
      weapon: { weaponId: 'starter-pistol', cooldownTicks: 0, magazineAmmo: 8, reserveAmmo: 32, reloadTicksRemaining: 0 },
    });
    expect(id).toBe('e:1');
    expect(JSON.parse(JSON.stringify(world))).toEqual(world);
    expect(removeEntity(world, id)).toBe(true);
    expect(removeEntity(world, id)).toBe(false);
  });
});

describe('input frames', () => {
  it('are transport-friendly serializable data', () => {
    const frame = createInputFrame(3);
    frame.actions.fire = { held: true, pressed: true, released: false, value: 1 };
    frame.look.yaw = 0.12;
    frame.look.pitch = -0.04;
    expect(JSON.parse(JSON.stringify(frame))).toEqual(frame);
  });
});
