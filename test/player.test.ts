import { describe, expect, it } from 'vitest';
import {
  PLAYER_MOVEMENT,
  createInputFrame,
  createPlayerState,
  moveWithCollision,
  sampleWalkHeight,
  updatePlayerMovement,
} from '../src/core/index.ts';

const id = 'e:1' as const;

function heldMove(action: 'moveForward' | 'moveRight') {
  const frame = createInputFrame(1);
  frame.actions[action] = { held: true, pressed: true, released: false, value: 1 };
  return frame;
}

describe('player movement', () => {
  it('accelerates forward relative to authoritative yaw', () => {
    const player = createPlayerState(id, { x: 0, y: 0, z: 0 });
    updatePlayerMovement(player, heldMove('moveForward'), 1 / 60, []);
    expect(player.position.z).toBeLessThan(0);
    expect(player.velocity.z).toBeLessThan(0);
  });

  it('clamps authoritative pitch', () => {
    const player = createPlayerState(id, { x: 0, y: 0, z: 0 });
    const frame = createInputFrame(1);
    frame.look.pitch = 99;
    updatePlayerMovement(player, frame, 1 / 60, []);
    expect(player.pitch).toBe(PLAYER_MOVEMENT.maxPitch);
  });

  it('stops at collision boxes instead of passing through them', () => {
    const next = moveWithCollision(
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      0.34,
      1.78,
      [{ min: { x: 1, y: 0, z: -1 }, max: { x: 2, y: 2, z: 1 } }],
    );
    expect(next.x).toBeCloseTo(0.66, 6);
  });

  it('samples ramps and upper floors deterministically', () => {
    const surfaces = [
      { minX: 0, maxX: 2, minZ: 0, maxZ: 1, startHeight: 0, endHeight: 2, slopeAxis: 'x' as const },
      { minX: 0, maxX: 4, minZ: 0, maxZ: 4, startHeight: 2, endHeight: 2 },
    ];
    expect(sampleWalkHeight(1, 0.5, 0, surfaces, 1.1)).toBe(1);
    expect(sampleWalkHeight(3, 2, 2, surfaces)).toBe(2);
  });
});
