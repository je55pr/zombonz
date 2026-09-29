import * as THREE from 'three';

/**
 * Where each gun's iron sights are, so aiming can line the rear sight, the front sight and the eye up on one
 * straight line that runs through the middle of the screen (and so along the shot).
 *
 * Keyed by model folder name (the starting pistol is the m1911). Points are in gun space, in millimetres: x to
 * the right of the model's centre, y down from its highest point, z back from the butt (negative toward the
 * muzzle), as `prepareWeapon` bakes the model. They were read off the models (docs/weapon-sights.md says how, and
 * which guns are a judgement rather than a reading):
 * - `rear` is the middle of the opening the eye looks through. A peep sight's is the centre of its hole. A
 *   notch's is halfway up the notch, between its bottom and the tops of its ears. A gun with no rear sight
 *   (a shotgun) uses a point just above the end of the receiver, so the line runs clear over it and along the barrel.
 * - `front` is the tip of the front sight post, inside its hood or between its ears where it has them.
 * Guns are modelled slightly off true, so the two points need not sit level, or on the bore.
 *
 * Re-measure after changing a gun's model, its `VIEWMODEL_LENGTHS` entry or its hidden parts; the test in
 * `test/weapon-sights.test.ts` fails if the line of sight no longer runs clear from the eye to the front sight.
 */
export type SightPointMm = readonly [x: number, y: number, z: number];
export interface WeaponSightsMm {
  rear: SightPointMm;
  front: SightPointMm;
  /** How far in front of the eye the rear sight sits when aimed, in millimetres; see `eyeRelief` for the default. */
  relief?: number;
}

export const WEAPON_SIGHTS: Readonly<Record<string, WeaponSightsMm>> = {
  // Handguns are held out at arm's length, and Black Ops does not zoom the view or the gun when they are aimed.
  m1911: { rear: [0.0, -0.6, -70], front: [0.0, -2.8, -347], relief: 670 },
  'magnum-357': { rear: [0.1, -8.0, -155], front: [0.1, 0.0, -410], relief: 670 },
  python: { rear: [0.0, -1.5, -135], front: [0.0, -0.6, -390], relief: 670 },
  irrlicht: { rear: [0.0, -1.1, -120], front: [0.0, -0.5, -415], relief: 670 },
  molniya: { rear: [9.5, -2.3, -37], front: [9.5, 0.0, -393], relief: 670 },
  mp5k: { rear: [3.4, -11.4, -65], front: [3.5, -15.6, -435] },
  skorpion: { rear: [0.0, -4.5, -115], front: [0.0, -3.8, -385], relief: 300 },
  // Shotguns have no rear sight: the eye looks along the receiver and barrel to the muzzle.
  'double-barrel': { rear: [0.0, 5.0, -440], front: [0.0, -5.9, -975] },
  'trench-gun': { rear: [-0.7, 0.2, -320], front: [-0.7, -1.4, -830] },
  ithaca37: { rear: [0.0, 4.0, -390], front: [0.0, -10.6, -850] },
  spas12: { rear: [-0.3, -6.1, -467], front: [0.3, -9.8, -845] },
  kar98k: { rear: [-1.4, -11.3, -510], front: [-1.4, -6.4, -930] },
  springfield: { rear: [-10.3, -4.0, -325], front: [-10.3, -9.0, -930] },
  mosin: { rear: [-8.9, -0.7, -495], front: [-8.9, 0.0, -1065] },
  'm1-garand': { rear: [-2.9, -4.4, -300], front: [-2.9, -6.8, -915] },
  'm1-carbine': { rear: [0.5, -1.3, -290], front: [0.5, -11.1, -765] },
  m14: { rear: [-7.1, -4.6, -315], front: [-7.1, -2.0, -890] },
  fal: { rear: [-3.7, -4.3, -230], front: [-0.7, -1.8, -675] },
  stg44: { rear: [3.6, -4.0, -415], front: [3.4, -11.3, -790] },
  fg42: { rear: [30.7, -10.9, -265], front: [30.7, -6.4, -735] },
  thompson: { rear: [-2.4, -6.2, -305], front: [-2.4, -3.8, -685] },
  mp40: { rear: [4.1, -10.0, -370], front: [4.1, -8.9, -695] },
  ppsh41: { rear: [0.0, -12.8, -345], front: [0.0, -9.0, -655] },
  commando: { rear: [-0.8, -4.9, -255], front: [-0.7, -4.0, -555] },
  ak74u: { rear: [-19.0, -7.0, -335], front: [-20.6, -5.6, -548] },
  bar: { rear: [12.5, -7.0, -280], front: [12.8, -6.3, -960] },
  mg42: { rear: [38.6, 0.5, -525], front: [38.6, 0.0, -905] },
  rpk: { rear: [-4.2, -0.7, -400], front: [-4.2, -6.8, -880] },
  // The launcher's sights sit 15 mm left of the tube: a tall slot behind, a post inside a hood ahead.
  rpg7: { rear: [-25.6, -11.4, -605], front: [-25.6, -18.5, -910] },
};

/**
 * How large a gun's sights look when aimed comes from two things, tuned against Black Ops screenshots (the Kar98k's front
 * sight ring is about 3.1% of the window's width and its rear sight about 8%; the pistol's rear sight about 2.4%):
 * - the gun is drawn with the same magnification as the world, as Black Ops does (`viewmodelFov` in aim.ts);
 * - `relief`, how far the rear sight sits in front of the eye, is a set multiple of the distance between the two
 *   sights unless the gun lists its own, which keeps the rear sight a fixed proportion of the front one.
 */
const RELIEF_PER_SIGHT_RADIUS = 0.7;
/** The eye relief the hip poses in weaponView.ts were tuned against, and the least a gun is given. */
export const MIN_EYE_RELIEF = 0.13;
const MAX_EYE_RELIEF = 0.9;

export interface SightPoints { rear: THREE.Vector3; front: THREE.Vector3; relief: number }
/** How to hold a gun to aim it: see `adsPose`. */
export interface AimPose { position: THREE.Vector3; quaternion: THREE.Quaternion }

const toMetres = ([x, y, z]: SightPointMm) => new THREE.Vector3(x / 1000, y / 1000, z / 1000);

/** How far in front of the eye the rear sight sits when a gun is aimed, in metres. */
export function eyeRelief(rear: THREE.Vector3, front: THREE.Vector3): number {
  return Math.min(MAX_EYE_RELIEF, Math.max(MIN_EYE_RELIEF, RELIEF_PER_SIGHT_RADIUS * (rear.z - front.z)));
}

export function sightPoints(id: string): SightPoints | null {
  const sights = WEAPON_SIGHTS[id];
  if (!sights) return null;
  const rear = toMetres(sights.rear), front = toMetres(sights.front);
  return { rear, front, relief: sights.relief !== undefined ? sights.relief / 1000 : eyeRelief(rear, front) };
}

/**
 * How to hold the gun so the eye, the rear sight and the front sight are one line down the middle of the screen:
 * turned just enough that the line through both sights points straight ahead (with no roll, so it stays level),
 * and placed so the rear sight is `relief` in front of the eye. Position is where the gun's origin ends up.
 */
export function adsPose(sights: SightPoints): AimPose {
  const along = sights.front.clone().sub(sights.rear).normalize();
  // Turn about the vertical, then about the gun's own side-to-side axis: the gun is never rolled.
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.atan2(-along.y, -along.z), Math.asin(along.x), 0, 'YXZ'));
  const position = new THREE.Vector3(0, 0, -sights.relief).sub(sights.rear.clone().applyQuaternion(quaternion));
  return { position, quaternion };
}
