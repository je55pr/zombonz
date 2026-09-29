import * as THREE from 'three';
import { SeededRng, hashString, mix32 } from '../core/rng.ts';
import type { ZombieState } from '../core/types.ts';

/**
 * What tells one zombie from the next: its build, colouring, tempo and bearing. Every value is drawn from the zombie's own id
 * (and its map's palette), so the same zombie looks the same on every screen in a co-op game and from one frame to the next,
 * and none of it touches the simulation: which *model* a zombie is drawn with is `ZombieState.variant`, chosen when it spawned
 * from its map's `zombieLooks`, because that decides where its body is for a shot.
 */
export type Posture = 'straight' | 'hunched' | 'tilted' | 'limp';

export interface ZombieLook {
  /** Multiplied into the model's colour: paler, greener, filthier. */
  tint: THREE.Color;
  /** How much taller or wider than the model as authored (about 5%). */
  height: number;
  width: number;
  /** How fast its walk, run and idle play relative to the model's own, and where in the cycle it starts. */
  tempo: number;
  phase: number;
  posture: Posture;
  /** Which way a head tilts, or which hip drops (-1 or 1). */
  side: 1 | -1;
  /** How fast it dies. */
  deathSpeed: number;
}

/** A map's palette: how likely each colouring is (linear colour multipliers) and each bearing. */
export interface MapZombieLooks {
  tints: ReadonlyArray<{ colour: readonly [number, number, number]; weight: number }>;
  postures: Readonly<Record<Posture, number>>;
}

const DEFAULT_LOOKS: MapZombieLooks = {
  tints: [{ colour: [1, 1, 1], weight: 1 }],
  postures: { straight: 1, hunched: 0, tilted: 0, limp: 0 },
};

/**
 * The Bunker's dead are soldiers who have lain in the dark: mostly as they were, some greener, some greyer, a few caked in
 * dirt. The Asylum's are its patients, in pale gowns gone the colour of the walls.
 */
export const MAP_ZOMBIE_LOOKS: Readonly<Record<string, MapZombieLooks>> = {
  bunker: {
    tints: [{ colour: [1, 1, 1], weight: 4 }, { colour: [0.82, 0.92, 0.8], weight: 2 }, { colour: [1.12, 1.04, 0.95], weight: 2 },
      { colour: [0.62, 0.64, 0.6], weight: 1.5 }],
    postures: { straight: 5, hunched: 2.5, tilted: 1.5, limp: 1 },
  },
  asylum: {
    tints: [{ colour: [1.35, 1.38, 1.45], weight: 3 }, { colour: [1.15, 1.2, 1.2], weight: 2 }, { colour: [0.95, 1.02, 1.05], weight: 1.5 },
      { colour: [0.72, 0.68, 0.64], weight: 1 }],
    postures: { straight: 3, hunched: 3, tilted: 2, limp: 2 },
  },
};

function pick<T>(items: ReadonlyArray<T>, weight: (item: T) => number, roll: number): T {
  let left = roll * items.reduce((sum, item) => sum + weight(item), 0);
  for (const item of items) { left -= weight(item); if (left < 0) return item; }
  return items[items.length - 1];
}

export function zombieLook(zombie: Pick<ZombieState, 'id'>, mapId?: string): ZombieLook {
  const palette = (mapId && MAP_ZOMBIE_LOOKS[mapId]) || DEFAULT_LOOKS;
  const rng = new SeededRng(mix32(hashString(zombie.id) ^ 0x2f6b1d3));
  const tint = pick(palette.tints, item => item.weight, rng.next());
  // A little brightness of its own on top of the palette, so two of a colour are still not the same.
  const grime = 0.9 + rng.next() * 0.2;
  const posture = pick(Object.entries(palette.postures) as Array<[Posture, number]>, ([, weight]) => weight, rng.next())[0];
  return {
    tint: new THREE.Color(tint.colour[0] * grime, tint.colour[1] * grime, tint.colour[2] * grime),
    height: 0.95 + rng.next() * 0.11, width: 0.96 + rng.next() * 0.09,
    tempo: 0.88 + rng.next() * 0.26, phase: rng.next(), posture,
    side: rng.next() < 0.5 ? -1 : 1, deathSpeed: 0.9 + rng.next() * 0.3,
  };
}
