import type { WeaponDefinition } from './weapon.ts';

/**
 * What Pack-a-Punch does to one gun. Everything not named keeps the base gun's value or the default below, so a
 * new gun needs only a name and, if it matters, its ammo. The upgraded gun is a definition of its own (id
 * `<base>-pap`, see `upgradedDefinition`), so it fires, reloads, is bought ammo for and is drawn like any other gun.
 */
export interface UpgradeSpec {
  /** What the upgraded gun is called, on the HUD, the machine and the box. */
  name: string;
  /**
   * The colour of the upgraded gun's glowing circuit lines, its muzzle flash and its name on the HUD, as 0xRRGGBB: a bright one,
   * and different guns can share one. Its finish is dark whatever this is.
   */
  glow: number;
  /** Multiplier on `damage` (default 2). Headshot and other zone multipliers are unchanged. */
  damage?: number;
  /** Magazine and total reserve when the gun comes out of the machine (default: half as much again). */
  magazine?: number;
  reserve?: number;
  /** Multipliers on the reload time (default 0.85) and the hip spread (default 0.85). */
  reload?: number;
  spread?: number;
  /** Rays per shot, for a shotgun. */
  pellets?: number;
  /** Changes to a blast or a chain: the gun's own values with these replaced. */
  explosive?: Partial<NonNullable<WeaponDefinition['explosive']>>;
  chain?: Partial<NonNullable<WeaponDefinition['chain']>>;
}

export const UPGRADED_SUFFIX = '-pap';

/**
 * The upgrade of every gun, by the base gun's id. The numbers are balance choices in the spirit of the originals'
 * (about twice the damage, a bigger magazine and more reserve, a faster reload), not measurements: see docs/pack-a-punch.md.
 * The names are this game's own.
 */
export const UPGRADE_SPECS: Readonly<Record<string, UpgradeSpec>> = {
  'starter-pistol': { name: 'Last Rites', glow: 0x22e6ff, damage: 3, magazine: 12, reserve: 60, reload: 0.8 },
  kar98k: { name: "Hunter's Moon", glow: 0x6cc4ff, magazine: 10, reserve: 80 },
  springfield: { name: 'Long Night', glow: 0x5a6bff, magazine: 10, reserve: 80 },
  mosin: { name: "Winter's Bite", glow: 0x4dffd2, magazine: 10, reserve: 80 },
  'm1-garand': { name: 'Harbinger', glow: 0xff8a1f, magazine: 12, reserve: 192 },
  thompson: { name: 'Undertaker', glow: 0xff2a4a, magazine: 30, reserve: 240 },
  mp40: { name: 'Schnitter', glow: 0x9dff2e, magazine: 48, reserve: 288 },
  ppsh41: { name: 'Blizzard', glow: 0x7b6cff, magazine: 90, reserve: 360 },
  'm1-carbine': { name: 'Nightjar', glow: 0xb04dff, magazine: 30, reserve: 180 },
  m14: { name: 'Redeemer', glow: 0xffc21f, magazine: 12, reserve: 144 },
  fal: { name: 'Ironside', glow: 0xff4da6, magazine: 30, reserve: 270 },
  stg44: { name: 'Sturmgeist', glow: 0x39ff6a, magazine: 45, reserve: 270 },
  fg42: { name: 'Paladin', glow: 0xffe066, magazine: 30, reserve: 360 },
  commando: { name: 'Deadeye', glow: 0xff5a1f, magazine: 40, reserve: 360 },
  ak74u: { name: 'Wolfsbane', glow: 0x7dff1f, magazine: 40, reserve: 240 },
  mp5k: { name: 'Hornet', glow: 0xff2bd6, magazine: 45, reserve: 240 },
  skorpion: { name: 'Stinger', glow: 0xfff01f, magazine: 40, reserve: 300 },
  'magnum-357': { name: 'Judgement', glow: 0xff1f3d, magazine: 9, reserve: 72 },
  python: { name: 'Coil', glow: 0x00ffb3, magazine: 12, reserve: 120 },
  rpk: { name: 'Stampede', glow: 0xff7a00, magazine: 150, reserve: 600 },
  bar: { name: 'Vanguard', glow: 0x00e5ff, magazine: 30, reserve: 210 },
  mg42: { name: 'Bonesaw', glow: 0xff3a1f, magazine: 200, reserve: 750 },
  // Shotguns: each pellet hits half as hard again, and there are half as many again.
  'double-barrel': { name: 'Twin Fangs', glow: 0xc03bff, damage: 1.5, pellets: 12, magazine: 4, reserve: 90 },
  'trench-gun': { name: 'Trench Broom', glow: 0xffa11f, damage: 1.5, pellets: 12, magazine: 8, reserve: 90 },
  spas12: { name: 'Scattergale', glow: 0x4dd2ff, damage: 1.5, pellets: 12, magazine: 10, reserve: 60 },
  ithaca37: { name: 'Hearthfire', glow: 0xff6a1f, damage: 1.5, pellets: 12, magazine: 8, reserve: 90 },
  // The launcher and the wonder weapons: a bigger blast, or a wider chain.
  rpg7: { name: 'Sundering', glow: 0xff2b2b, damage: 1.7, magazine: 1, reserve: 8, explosive: { radius: 5, damage: 4000 } },
  irrlicht: { name: 'Sumpflicht', glow: 0x7dff9a, magazine: 30, reserve: 240, explosive: { radius: 3, damage: 700 } },
  molniya: { name: 'Tempest', glow: 0x8fd8ff, magazine: 10, reserve: 70, chain: { targets: 8, radius: 5.5, falloff: 0.1 } },
};

/** The id of `base`'s upgrade, or null for a gun with none (or one that is already upgraded). */
export function upgradeIdFor(base: string): string | null {
  return Object.hasOwn(UPGRADE_SPECS, base) ? `${base}${UPGRADED_SUFFIX}` : null;
}

/** The glow of a gun's upgrade (given the gun's id or its upgrade's), or undefined for a gun with none. */
export function upgradeGlow(id: string): number | undefined {
  const base = baseWeaponId(id);
  return Object.hasOwn(UPGRADE_SPECS, base) ? UPGRADE_SPECS[base].glow : undefined;
}

/** Whether `id` is a Pack-a-Punched gun. */
export function isUpgradedWeapon(id: string): boolean {
  return id.endsWith(UPGRADED_SUFFIX) && Object.hasOwn(UPGRADE_SPECS, id.slice(0, -UPGRADED_SUFFIX.length));
}

/** The gun an upgraded gun comes from (its models, sounds and sights are the base gun's), or `id` itself. */
export function baseWeaponId(id: string): string {
  return isUpgradedWeapon(id) ? id.slice(0, -UPGRADED_SUFFIX.length) : id;
}

/** The upgraded gun's definition: the base gun's, with the spec's changes. */
export function upgradedDefinition(base: WeaponDefinition, spec: UpgradeSpec): WeaponDefinition {
  const upgraded: WeaponDefinition = {
    ...base,
    id: `${base.id}${UPGRADED_SUFFIX}`,
    name: spec.name,
    damage: Math.round(base.damage * (spec.damage ?? 2)),
    magazineSize: spec.magazine ?? Math.round(base.magazineSize * 1.5),
    startingReserveAmmo: spec.reserve ?? Math.round(base.startingReserveAmmo * 1.5),
    maxReserveAmmo: spec.reserve ?? Math.round((base.maxReserveAmmo ?? base.startingReserveAmmo) * 1.5),
    reloadTicks: Math.round(base.reloadTicks * (spec.reload ?? 0.85)),
    hipSpreadRadians: base.hipSpreadRadians * (spec.spread ?? 0.85),
  };
  // Bullets go through one more body, and keep a little more of their force.
  if (base.penetration) upgraded.penetration = { maxTargets: base.penetration.maxTargets + 1,
    damageRetention: Math.min(0.9, base.penetration.damageRetention + 0.05) };
  if (spec.pellets) upgraded.pellets = spec.pellets;
  if (spec.explosive && base.explosive) upgraded.explosive = { ...base.explosive, ...spec.explosive };
  if (spec.chain && base.chain) upgraded.chain = { ...base.chain, ...spec.chain };
  return upgraded;
}
