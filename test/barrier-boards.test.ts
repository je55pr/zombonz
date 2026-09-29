import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BARRIER_RULES, boardMask, createBarrier, createPlayerState, createPowerupState, createZombieEntry,
  createZombieState, collectPowerups, repairBarriers, restoreBarrier, updateZombieEntry,
  DEFAULT_POWERUP_CONFIG, type BarrierState } from '../src/core/index.ts';
import { BUNKER_BARRIERS, BUNKER_MAP } from '../src/maps/bunker.ts';
import { ASYLUM_MAP } from '../src/maps/asylum.ts';
import { EYE_HEIGHT, SILL_TOP, plankHeights, plankPose, plankReach, turnUvs, windowSeed } from '../src/client/windowBoards.ts';

const bits = (mask: number) => [...Array(6).keys()].filter(slot => (mask >>> slot) & 1);
function window(id: `e:${number}` = 'e:10', barrier = BUNKER_BARRIERS[0]): BarrierState {
  return createBarrier(barrier, id).state;
}
/** A zombie at the window tears one board, whichever tick it starts on; returns the slot it took. */
function tearOne(barrier: BarrierState, seed: number, start: number): number {
  const zombie = createZombieState('e:2', barrier.approachPath.at(-1)!, 1);
  zombie.entry = createZombieEntry(barrier.id, 0); zombie.entry.phase = 'breaking';
  const before = barrier.boards;
  for (let tick = start; barrier.boards === before; tick++) updateZombieEntry(zombie, barrier, [zombie], 1 / 60, [], tick, seed);
  return barrier.lastTornSlot;
}
/** The order a window's six boards come off in. */
function tearOrder(seed: number, barrier = window()): number[] {
  const order: number[] = [];
  for (let i = 0; i < barrier.maxBoards; i++) {
    order.push(tearOne(barrier, seed, i * BARRIER_RULES.tearTicks));
    expect(bits(barrier.mask)).toHaveLength(barrier.boards);
    expect(bits(barrier.mask)).not.toContain(order.at(-1));
  }
  return order;
}
function repairOrder(seed: number, barrier: BarrierState): number[] {
  const order: number[] = [];
  const repairers = new Map([[barrier.id, 'e:1' as const]]);
  for (let tick = 0; barrier.boards < barrier.maxBoards; tick++) {
    const before = barrier.mask;
    repairBarriers([barrier], repairers, seed, tick);
    if (barrier.mask !== before) order.push(bits(barrier.mask ^ before)[0]);
  }
  return order;
}

describe('which board is torn or rebuilt', () => {
  it('starts with every slot filled', () => {
    const barrier = window();
    expect(bits(barrier.mask)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(barrier.lastTornSlot).toBe(-1);
  });

  it('tears the boards in a random order, not strictly top to bottom, that every peer agrees on', () => {
    const orders = [1, 2, 3, 4, 5, 6, 7, 8].map(seed => tearOrder(seed));
    for (const order of orders) expect([...order].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(orders.map(order => order.join()).filter(key => key === '5,4,3,2,1,0')).toEqual([]);
    expect(new Set(orders.map(order => order.join())).size).toBeGreaterThan(5);
    expect(tearOrder(3)).toEqual(orders[2]);
  });

  it('takes any slot first, so the middle boards are as likely to go as the top', () => {
    const first = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) first.add(tearOne(window(), seed * 7919, 0));
    expect([...first].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('rebuilds a random missing slot, not the lowest, and only ever fills empty ones', () => {
    const orders = [1, 2, 3, 4, 5, 6].map(seed => {
      const barrier = window(); barrier.boards = 0; barrier.mask = 0;
      return repairOrder(seed, barrier);
    });
    for (const order of orders) expect([...order].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(orders.map(order => order.join()).filter(key => key === '0,1,2,3,4,5')).toEqual([]);
    expect(new Set(orders.map(order => order.join())).size).toBeGreaterThan(3);
    // Rebuilding a half-torn window fills the gaps left and keeps the boards already up.
    const barrier = window(); barrier.mask = 0b101101; barrier.boards = 4;
    const repairers = new Map([[barrier.id, 'e:1' as const]]);
    for (let tick = 0; barrier.boards < 5; tick++) repairBarriers([barrier], repairers, 5, tick);
    expect(bits(barrier.mask)).toHaveLength(5);
    expect(barrier.mask & 0b101101).toBe(0b101101);
  });

  it('differs between windows and between matches, from the same tear', () => {
    const a = tearOrder(9, window('e:10', BUNKER_BARRIERS[0])), b = tearOrder(9, window('e:11', BUNKER_BARRIERS[1]));
    expect(a).not.toEqual(b);
    expect(tearOrder(9)).not.toEqual(tearOrder(10));
  });

  it('keeps the slots in step with the count, even if the count is set directly', () => {
    const barrier = window();
    barrier.boards = 2;
    expect(bits(boardMask(barrier))).toEqual([0, 1]);
    tearOne(barrier, 4, 0);
    expect(bits(barrier.mask)).toHaveLength(1);
    expect(barrier.boards).toBe(1);
  });

  it('is put fully back by the Carpenter', () => {
    const barrier = window(); barrier.mask = 0b000110; barrier.boards = 2; barrier.lastTornSlot = 4;
    restoreBarrier(barrier);
    expect(barrier.mask).toBe(0b111111);
    expect(barrier.boards).toBe(6);
    const torn = window('e:12', BUNKER_BARRIERS[1]); tearOne(torn, 3, 0); tearOne(torn, 3, 400);
    const state = createPowerupState();
    state.drops.push({ id: 'p:1', kind: 'carpenter', position: { x: 0, y: 0, z: 0 }, ticksRemaining: 900 });
    collectPowerups(state, [createPlayerState('e:1', { x: 0, y: 0, z: 0 })], [], DEFAULT_POWERUP_CONFIG, [], [torn]);
    expect(torn.mask).toBe(0b111111);
    expect(boardMask(torn)).toBe(0b111111);
  });
});

describe('window board layout', () => {
  const widths = [1.2, 1.35, 1.5, 2.2, 2.9, 4];

  it('leaves the eye-line open at any width, for any window, whichever boards are up', () => {
    for (let seed = 0; seed < 300; seed++) {
      for (const width of widths) {
        for (let slot = 0; slot < 6; slot++) {
          const { low, high } = plankReach(plankPose(seed * 2654435761 >>> 0, slot, 6, width), width);
          expect(low > EYE_HEIGHT + 0.03 || high < EYE_HEIGHT - 0.03, `seed ${seed} width ${width} slot ${slot}`).toBe(true);
          expect(low).toBeGreaterThanOrEqual(SILL_TOP - 1e-9);
          expect(high).toBeLessThan(2.64);
        }
      }
    }
  });

  it('keeps every real window eye-line clear', () => {
    for (const map of [BUNKER_MAP, ASYLUM_MAP]) {
      for (const opening of map.windows) {
        for (let slot = 0; slot < map.windowBoards; slot++) {
          const { low, high } = plankReach(plankPose(windowSeed(opening.id), slot, map.windowBoards, opening.width), opening.width);
          expect(low > EYE_HEIGHT || high < EYE_HEIGHT, `${opening.id} slot ${slot}`).toBe(true);
        }
      }
    }
  });

  it('stacks boards clear of one another, half below the eye-line and half above', () => {
    const heights = plankHeights(6);
    expect(heights).toHaveLength(6);
    heights.slice(1).forEach((height, i) => { if (i !== 2) expect(height - heights[i]).toBeGreaterThan(0.17); });
    expect(heights.filter(height => height < EYE_HEIGHT)).toHaveLength(3);
    expect(plankHeights(3)).toHaveLength(3);
    expect(plankHeights(8)).toHaveLength(8);
  });

  it('nails each window up differently, the same way every game, and only a little off level', () => {
    const one = plankPose(windowSeed('start-north'), 2, 6, 1.5), again = plankPose(windowSeed('start-north'), 2, 6, 1.5);
    expect(again).toEqual(one);
    const poses = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => plankPose(windowSeed(id), 2, 6, 1.5));
    expect(new Set(poses.map(pose => pose.tilt.toFixed(4))).size).toBeGreaterThan(3);
    expect(new Set(poses.map(pose => pose.y.toFixed(4))).size).toBeGreaterThan(3);
    for (const pose of poses) {
      expect(Math.abs(pose.y - plankHeights(6)[2])).toBeLessThanOrEqual(0.015 + 1e-9);
      expect(Math.abs(pose.x)).toBeLessThanOrEqual(0.03 + 1e-9);
      expect(Math.abs(pose.tilt)).toBeLessThan(0.1);
    }
  });

  it('lays the wood grain along the board', () => {
    // The planks texture has its grain running up the image (v); a board runs along x, which projects to u.
    const geometry = new THREE.BoxGeometry(1.5, 0.17, 0.025);
    const uv = geometry.attributes.uv, positions = geometry.attributes.position, normals = geometry.attributes.normal;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, positions.getX(i), positions.getY(i));
    turnUvs(geometry);
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getY(i)).toBeCloseTo(positions.getX(i));
      expect(uv.getX(i)).toBeCloseTo(positions.getY(i));
    }
    expect(normals.count).toBe(uv.count);
  });
});
