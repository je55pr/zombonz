/**
 * Bunker's floor plan was first blocked out too small. WaW's own interior effect placements put its
 * spawn room at roughly 23-25 x 10-12 m and the HELP wing at roughly 33 x 9 m, so the plan is authored
 * in its original blockout coordinates and mapped out by this scale.
 *
 * Only the plan grows. Heights, wall thickness, doors, windows, columns, props, wall buys and the box
 * keep their real sizes, and anything placed within ANCHOR of a wall keeps its distance from that wall
 * (a shelf stays against it, a chalk outline stays on it) rather than drifting into the room.
 */
export const PLAN_SCALE = 1.35;
const ANCHOR = 0.9;
/** The blockout's main wall lines: x = constant and z = constant. */
const X_WALLS = [-8, -6.2, -4.8, 0, 10.4, 13.8, 18.2] as const;
const Z_WALLS = [-11, -4.7, -2.6, 1.8, 5.4, 7.8] as const;

function anchored(value: number, walls: readonly number[]): number {
  let nearest: number | undefined;
  for (const wall of walls) {
    if (Math.abs(value - wall) <= ANCHOR && (nearest === undefined || Math.abs(value - wall) < Math.abs(value - nearest))) nearest = wall;
  }
  return nearest === undefined ? value * PLAN_SCALE : nearest * PLAN_SCALE + (value - nearest);
}

/** Maps a blockout x position to the built map. */
export const px = (x: number): number => anchored(x, X_WALLS);
/** Maps a blockout z position to the built map. */
export const pz = (z: number): number => anchored(z, Z_WALLS);
/** Pure scaling, for the main stair and its floor cutout, which must grow as one coherent shape. */
export const ps = (value: number): number => value * PLAN_SCALE;
