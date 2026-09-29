import * as THREE from 'three';
import { VIEWMODEL_AIMED_HFOV } from './aim.ts';

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
/** The part of the sight picture that is sized on screen: the sight at `at`, `width` millimetres across. */
export interface SightSize { at: 'front' | 'rear'; width: number; percent?: number }
export interface WeaponSightsMm {
  rear: SightPointMm;
  front: SightPointMm;
  /** Which sight is drawn 2.8% of the window's width (see `eyeRelief`), and how wide it is in the model. */
  size: SightSize;
  /** Overrides the eye relief worked out from `size`, in millimetres. */
  relief?: number;
}

/**
 * Widths are read off the same rear-on slices as the points: the front guard (hood, ring or ears) where the gun has one
 * and the eye can be far enough back to see it that size, otherwise the rear leaf, notch block or aperture holder. Where
 * that would put the eye behind the rear sight (the M14's front ears at 14 mm want the eye 11 cm back) the eye stops at the
 * nearest distance, so that gun's sights come out a little smaller than the rest.
 */
export const WEAPON_SIGHTS: Readonly<Record<string, WeaponSightsMm>> = {
  m1911: { rear: [0.0, -0.6, -70], front: [0.0, -2.8, -347], size: { at: 'rear', width: 20.6 } },
  'magnum-357': { rear: [0.1, -8.0, -155], front: [0.1, 0.0, -410], size: { at: 'rear', width: 19.8 } },
  python: { rear: [0.0, -1.5, -135], front: [0.0, -0.6, -390], size: { at: 'rear', width: 20.3 } },
  irrlicht: { rear: [0.0, -1.1, -120], front: [0.0, -0.5, -415], size: { at: 'rear', width: 13.7 } },
  molniya: { rear: [9.5, -2.3, -37], front: [9.5, 0.0, -393], size: { at: 'rear', width: 21 } },
  mp5k: { rear: [3.4, -11.4, -65], front: [3.5, -15.6, -435], size: { at: 'rear', width: 19 } },
  skorpion: { rear: [0.0, -4.5, -115], front: [0.0, -3.8, -385], size: { at: 'rear', width: 27.5 } },
  // Shotguns have no rear sight: the eye looks along the receiver and barrel, and the muzzle is what is sized.
  'double-barrel': { rear: [0.0, 5.0, -440], front: [0.0, -5.9, -975], size: { at: 'front', width: 30.5 } },
  'trench-gun': { rear: [-0.7, 0.2, -320], front: [-0.7, -1.4, -830], size: { at: 'front', width: 14.4 } },
  ithaca37: { rear: [0.0, 4.0, -390], front: [0.0, -10.6, -850], size: { at: 'front', width: 27.5 } },
  spas12: { rear: [-0.3, -6.1, -467], front: [0.3, -9.8, -845], size: { at: 'rear', width: 12.5 } },
  // The one gun Black Ops screenshots exist for: its front ring is about 3.1% of the window's width.
  kar98k: { rear: [-1.4, -11.3, -510], front: [-1.4, -6.4, -930], size: { at: 'front', width: 16, percent: 3.1 } },
  springfield: { rear: [-10.3, -4.0, -325], front: [-10.3, -9.0, -930], size: { at: 'rear', width: 8.75 } },
  mosin: { rear: [-8.9, -0.7, -495], front: [-8.9, 0.0, -1065], size: { at: 'rear', width: 12.5 } },
  'm1-garand': { rear: [-2.9, -4.4, -300], front: [-2.9, -6.8, -915], size: { at: 'rear', width: 21 } },
  'm1-carbine': { rear: [0.5, -1.3, -290], front: [0.5, -11.1, -765], size: { at: 'front', width: 13.7 } },
  m14: { rear: [-7.1, -4.6, -315], front: [-7.1, -2.0, -890], size: { at: 'front', width: 14 } },
  fal: { rear: [-3.7, -4.3, -230], front: [-0.7, -1.8, -675], size: { at: 'front', width: 14.4 } },
  stg44: { rear: [3.6, -4.0, -415], front: [3.4, -11.3, -790], size: { at: 'front', width: 15.6 } },
  fg42: { rear: [30.7, -10.9, -265], front: [30.7, -6.4, -735], size: { at: 'front', width: 12.5 } },
  thompson: { rear: [-2.4, -6.2, -305], front: [-2.4, -3.8, -685], size: { at: 'rear', width: 13.75 } },
  mp40: { rear: [4.1, -10.0, -370], front: [4.1, -8.9, -695], size: { at: 'front', width: 17.7 } },
  ppsh41: { rear: [0.0, -12.8, -345], front: [0.0, -9.0, -655], size: { at: 'front', width: 19 } },
  commando: { rear: [-0.8, -4.9, -255], front: [-0.7, -4.0, -555], size: { at: 'front', width: 12.1 } },
  ak74u: { rear: [-11.3, -6.6, -335], front: [-10.7, -5.0, -548], size: { at: 'front', width: 15 } },
  bar: { rear: [12.5, -7.0, -280], front: [12.8, -6.3, -960], size: { at: 'rear', width: 8.9 } },
  mg42: { rear: [38.6, 0.5, -525], front: [38.6, 0.0, -905], size: { at: 'rear', width: 12.5 } },
  rpk: { rear: [-4.2, -0.7, -400], front: [-4.2, -6.8, -880], size: { at: 'front', width: 12.5 } },
  // The launcher's sights sit 15 mm left of the tube: a tall slot behind, a post inside a hood ahead.
  rpg7: { rear: [-25.6, -11.4, -605], front: [-25.6, -18.5, -910], size: { at: 'rear', width: 12.5 } },
};

/**
 * How large a gun's sights look when aimed comes from three things:
 * - the gun is drawn with the same magnification as the world, as Black Ops does (`viewmodelFov` in aim.ts);
 * - the sight named in `size` is set to `percent` of the window's width (2.8%, and 3.1% for the Kar98k, which is what
 *   Black Ops' screenshots of it show) by choosing how far the eye is behind the rear sight (`relief`);
 * - that distance is kept between `MIN_EYE_RELIEF` and `MAX_EYE_RELIEF`.
 */
export const SIGHT_PERCENT = 2.8;
/** The eye relief the hip poses in weaponView.ts were tuned against, and the least a gun is given. */
export const MIN_EYE_RELIEF = 0.13;
export const MAX_EYE_RELIEF = 1.5;

export interface SightPoints { rear: THREE.Vector3; front: THREE.Vector3; relief: number; size: SightSize }
/** How to hold a gun to aim it: see `adsPose`. */
export interface AimPose { position: THREE.Vector3; quaternion: THREE.Quaternion }

const toMetres = ([x, y, z]: SightPointMm) => new THREE.Vector3(x / 1000, y / 1000, z / 1000);

/**
 * How far in front of the eye the rear sight sits, in metres, for `size` to fill `percent` of the window's width when
 * the gun is drawn `zoom` times magnified: a sight of width w at distance d spans w / d / (2 tan(half horizontal angle)).
 */
export function eyeRelief(rear: THREE.Vector3, front: THREE.Vector3, size: SightSize, zoom: number): number {
  const halfHorizontal = Math.tan(VIEWMODEL_AIMED_HFOV * Math.PI / 360) / zoom;
  const distance = size.width / 1000 / ((size.percent ?? SIGHT_PERCENT) / 100 * 2 * halfHorizontal);
  const relief = size.at === 'front' ? distance - (rear.z - front.z) : distance;
  return Math.min(MAX_EYE_RELIEF, Math.max(MIN_EYE_RELIEF, relief));
}

/** `zoom` is the aim magnification of the gun (see `adsZoom`), which sets how far back the eye has to be. */
export function sightPoints(id: string, zoom: number): SightPoints | null {
  const sights = WEAPON_SIGHTS[id];
  if (!sights) return null;
  const rear = toMetres(sights.rear), front = toMetres(sights.front);
  return { rear, front, size: sights.size, relief: sights.relief !== undefined ? sights.relief / 1000 : eyeRelief(rear, front, sights.size, zoom) };
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
