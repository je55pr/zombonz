import { hashString, mix32, SeededRng } from './rng.ts';
import type { EntityId, Vec3, ZombieState } from './types.ts';
import { LEGS_MASK, LIMB, zombieBody, type BodyPart, type LimbId } from './zombieBody.ts';

/**
 * When a zombie loses a limb, and which. Ported from WaW's `zombie_gib_on_damage` (`_zombiemode_spawner.gsc`, read from
 * JBShady/COD5-Remastered), with our own choices where it is silent:
 *
 * - A hit must take a tenth of the zombie's health at once to gib at all (`zombie_should_gib`), so a rifle bullet takes a limb
 *   off in the first rounds and a pistol's never does: WaW excludes every pistol but the .357 (`WeaponClass == "pistol"`),
 *   and knives and fire never gib.
 * - A head comes off only when the shot that took it is the one that kills (`head_should_gib` asks for at most a tenth of the
 *   zombie's health left), from a bullet or a blast within 1.4 m (55 units) of it.
 * - A hit on an arm takes that arm; a hit on the torso either opens it up (WaW's "guts", which also takes an arm) or takes an
 *   arm; a hit on a leg takes that leg, and one time in four the other with it (WaW's "no_legs"). Losing a leg leaves the
 *   zombie alive but unable to stand: a crawler.
 * - A blast is measured to the part nearest its centre (WaW's `derive_damage_refs`), takes that and the next-nearest limbs, and
 *   more of them the harder it hits and the closer it is, so an explosion kills messily.
 */
export const GORE_RULES = {
  /** Least share of the zombie's health one hit must take to gib. */
  minShare: 0.1,
  /** Least share to take a leg off a zombie that survives the hit (crawlers should take a real blow to make). */
  legShare: 0.2,
  bothLegsChance: 0.25,
  gutsChance: 0.5,
  /** A blast this near the skull, in metres, takes the head of a zombie it kills. */
  headReach: 1.4,
  /** A blast at least this strong (share of health) or this close (share of its radius) takes an extra limb. */
  strongShare: 0.5,
  closeScale: 0.5,
} as const;

export type GoreSource = 'bullet' | 'explosion';

export interface GoreBlow {
  source: GoreSource;
  /** Who did it, and so who is credited with what follows from it. */
  credit: EntityId;
  /** The damage just dealt (already taken off the zombie's health) and the zombie's health before it. */
  damage: number;
  healthBefore: number;
  /** A bullet: the part it struck. */
  part?: BodyPart;
  /** A bullet: where it struck. A blast: where it went off. */
  point: Vec3;
  /** A bullet: which way it was going. */
  direction?: Vec3;
  /** A blast: 1 at its centre, 0 at its edge. */
  scale?: number;
  /** False for what never gibs: the pistols, a knife, fire. */
  gibs: boolean;
}

/** A zombie has lost something (or been opened up): what the client tears off and sprays. */
export interface GoreEvent {
  type: 'zombieDismembered';
  zombieId: EntityId;
  playerId: EntityId;
  /** The limbs it lost just now, and all it has lost since. */
  lost: LimbId[];
  limbs: number;
  /** The part struck by a bullet, or null for a blast. */
  part: BodyPart | null;
  point: Vec3;
  direction: Vec3 | null;
  source: GoreSource;
  /** The blow that did it killed the zombie. */
  lethal: boolean;
  /** It is a crawler from now on: it lost a leg and is still alive. */
  crawler: boolean;
  /** Its torso was opened up (a wound, not a limb). */
  gutted: boolean;
}

const ARMS = ['armL', 'armR'] as const;
const LEGS = ['legL', 'legR'] as const;
const other = (limb: LimbId): LimbId => limb.endsWith('L') ? (limb.replace('L', 'R') as LimbId) : (limb.replace('R', 'L') as LimbId);

function distanceToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, length = dx * dx + dy * dy + dz * dz;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy), p.z - (a.z + t * dz));
}

/**
 * Takes limbs off a zombie for a blow it has already taken, and says what came off. Call after the damage is applied
 * (the zombie's health is what is left). Deterministic: the choices it makes are seeded from the zombie and the blow.
 */
export function dismember(zombie: ZombieState, blow: GoreBlow): GoreEvent[] {
  if (!blow.gibs || blow.damage <= 0) return [];
  const share = blow.damage / Math.max(1, blow.healthBefore);
  if (share < GORE_RULES.minShare) return [];
  const lethal = zombie.health <= 0;
  const rng = new SeededRng(mix32(hashString(zombie.id) ^ Math.imul(blow.damage + 1, 0x9e3779b1) ^ Math.imul(zombie.limbs + 1, 0x85ebca6b)
    ^ Math.imul(Math.round(blow.point.y * 1000) + 7, 0xc2b2ae35) ^ (blow.source === 'bullet' ? 0x51ed : 0xb1a5)));
  const before = zombie.limbs;
  const lost: LimbId[] = [];
  const take = (limb: LimbId) => { if (!(zombie.limbs & LIMB[limb])) { zombie.limbs |= LIMB[limb]; lost.push(limb); } };
  let gutted = false;

  if (blow.source === 'bullet') {
    const part = blow.part ?? 'torso';
    if (part === 'head') { if (lethal) take('head'); }
    else if (part === 'torso') {
      const arms = ARMS.filter(arm => !(zombie.limbs & LIMB[arm]));
      if (arms.length === 0 || rng.next() < GORE_RULES.gutsChance) gutted = true;
      else take(arms[rng.int(0, arms.length)]);
    } else if (part === 'armL' || part === 'armR') take(part);
    else if (share >= GORE_RULES.legShare || lethal) {
      take(part);
      if (rng.next() < GORE_RULES.bothLegsChance) take(other(part));
    }
  } else {
    // What the blast is nearest goes first: rank every limb still on by how far its capsule is from the centre.
    const nearest = zombieBody(zombie).volumes().filter(v => v.part !== 'head' && v.part !== 'torso')
      .map(v => ({ limb: v.part as LimbId, distance: Math.max(0, distanceToSegment(blow.point, v.a, v.b) - v.radius) }))
      .reduce<Map<LimbId, number>>((best, item) => best.set(item.limb, Math.min(best.get(item.limb) ?? Infinity, item.distance)), new Map());
    const order = [...nearest].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([limb]) => limb);
    const count = 1 + Number(share >= GORE_RULES.strongShare) + Number((blow.scale ?? 0) >= GORE_RULES.closeScale) + Number(lethal);
    for (const limb of order) {
      if (lost.length >= count) break;
      if ((LEGS as readonly string[]).includes(limb) && share < GORE_RULES.legShare && !lethal) continue;
      take(limb);
    }
    if (lethal && lost.length > 0) gutted = true;
    // A blast that kills, near the skull, takes it too.
    const skull = lethal ? zombieBody(zombie).volumes().find(v => v.part === 'head') : undefined;
    if (skull && Math.hypot(blow.point.x - skull.a.x, blow.point.y - skull.a.y, blow.point.z - skull.a.z) <= GORE_RULES.headReach) take('head');
  }

  if (lost.length === 0 && !gutted) return [];
  const crawler = !(before & LEGS_MASK) && Boolean(zombie.limbs & LEGS_MASK) && zombie.health > 0;
  return [{ type: 'zombieDismembered', zombieId: zombie.id, playerId: blow.credit, lost, limbs: zombie.limbs, part: blow.source === 'bullet' ? blow.part ?? 'torso' : null,
    point: { ...blow.point }, direction: blow.direction ? { ...blow.direction } : null, source: blow.source, lethal, crawler, gutted }];
}
