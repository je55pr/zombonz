/** Sidearms held out in one hand: the starting pistol and the revolvers. */
export const HANDGUNS: ReadonlySet<string> = new Set(['starter-pistol', 'magnum-357', 'python', 'irrlicht', 'molniya']);

/**
 * How many times aiming magnifies the view. Iron sights on a shoulder weapon pull in further than a
 * pistol's, which is held out at arm's length. Tuned by eye against the hip view, not taken from a
 * game's data.
 */
export const ADS_ZOOM = { handgun: 1.55, longGun: 1.8 } as const;

export function adsZoom(weaponId: string): number {
  return HANDGUNS.has(weaponId) ? ADS_ZOOM.handgun : ADS_ZOOM.longGun;
}

/**
 * The vertical field of view while aiming, in degrees. Magnifying by `zoom` divides the tangent of
 * the half angle by it, so a wider field of view setting stays proportionally wider aimed too.
 */
export function aimedFov(hipFovDegrees: number, weaponId: string): number {
  const half = hipFovDegrees * Math.PI / 360;
  return 2 * Math.atan(Math.tan(half) / adsZoom(weaponId)) * 180 / Math.PI;
}
