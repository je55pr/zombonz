/** Sidearms held out in one hand: the starting pistol and the revolvers. */
export const HANDGUNS: ReadonlySet<string> = new Set(['starter-pistol', 'magnum-357', 'python', 'irrlicht', 'molniya']);

/**
 * How many times aiming magnifies the world. Measured from Black Ops screenshots of the same room, hip and aimed:
 * the Kar98k's view narrows 1.74 times (a gate 310 px wide becomes 538, a shelf 137 becomes 238). Other shoulder guns
 * are assumed to match. Black Ops' pistol does not zoom at all; sidearms here zoom 1.3 times, a choice, so aiming one
 * still steadies the view.
 */
export const ADS_ZOOM = { handgun: 1.3, longGun: 1.74 } as const;

/**
 * How much mouse look is slowed while aiming (0.7 times), on top of the zoom having already narrowed the view.
 * A choice, to make aimed shooting feel more accurate than hip spraying.
 */
export const ADS_LOOK_SCALE = 0.7;

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

/** The lens the gun itself is drawn with at the hip: a fixed vertical field of view, in degrees. */
export const VIEWMODEL_HIP_FOV = 52;

/**
 * Black Ops draws the gun with a horizontal field of view of 65 degrees (its default) and, when aiming, narrows
 * it by the aim zoom. A gun drawn that way has sights of the same width on screen at any window shape, which is
 * what the aimed view here is matched to.
 */
export const VIEWMODEL_AIMED_HFOV = 65;

/**
 * The gun's vertical field of view in degrees, `aimBlend` of the way (0 to 1) from the hip lens to the aimed one. Aimed,
 * the gun is drawn with the same magnification as the world (`zoom`, from `adsZoom`), which is what makes its sights
 * large; `aspect` is the window's width over its height.
 */
export function viewmodelFov(aimBlend: number, zoom: number, aspect: number): number {
  const hip = Math.tan(VIEWMODEL_HIP_FOV * Math.PI / 360);
  const aimed = Math.tan(VIEWMODEL_AIMED_HFOV * Math.PI / 360) / (zoom * aspect);
  return 2 * Math.atan(hip + (aimed - hip) * aimBlend) * 180 / Math.PI;
}
