import { describe, expect, it } from 'vitest';
import { createPlayerState, equipWeapon, switchWeapon, tickWeaponState, createMysteryBox,
  useMysteryBox, tickMysteryBoxes, BOX_RULES, handleWallWeaponInteraction, createWallWeaponState,
  createWallWeaponInteractable, firePlayerWeapon, rayFromPlayer, type InteractionEvent } from '../src/core/index.ts';

const origin = { x: 0, y: 0, z: 0 };
const action = (type: string, id: `e:${number}`, playerId: `e:${number}` = 'e:1'): InteractionEvent => ({
  type: 'interactionTriggered', playerId, interactableId: id, interactionType: type, actionId: type,
});
const settle = (player: ReturnType<typeof createPlayerState>) => { for (let i = 0; i < 24; i++) tickWeaponState(player); };

describe('two-weapon inventory', () => {
  it('retains the starter on first purchase and replaces only the held gun when full', () => {
    const player = createPlayerState('e:1', origin);
    player.weapon.magazineAmmo = 3;
    equipWeapon(player, 'kar98k');
    expect(player.holsteredWeapon).toMatchObject({ weaponId: 'starter-pistol', magazineAmmo: 3 });
    equipWeapon(player, 'bar');
    expect(player.weapon.weaponId).toBe('bar');
    expect(player.holsteredWeapon?.weaponId).toBe('starter-pistol');
  });
  it('switches without refilling ammo, cancels reload and enforces draw time', () => {
    const player = createPlayerState('e:1', origin);
    player.weapon.magazineAmmo = 2;
    equipWeapon(player, 'kar98k');
    expect(switchWeapon(player)).toEqual([]);
    settle(player); player.weapon.magazineAmmo = 1; player.weapon.reloadTicksRemaining = 100;
    expect(switchWeapon(player)).toMatchObject([{ type: 'weaponSwitched', weaponId: 'starter-pistol' }]);
    expect(player.weapon.magazineAmmo).toBe(2);
    expect(player.holsteredWeapon).toMatchObject({ magazineAmmo: 1, reloadTicksRemaining: 0 });
    expect(firePlayerWeapon(player, rayFromPlayer(player, 1.62), [], [])).toEqual([]);
    settle(player);
    expect(firePlayerWeapon(player, rayFromPlayer(player, 1.62), [], [])).toHaveLength(1);
  });
  it('never creates duplicate guns when equipping an already owned gun', () => {
    const player = createPlayerState('e:1', origin);
    equipWeapon(player, 'starter-pistol'); expect(player.holsteredWeapon).toBeNull();
    equipWeapon(player, 'bar'); equipWeapon(player, 'starter-pistol');
    expect(player.weapon.weaponId).toBe('starter-pistol'); expect(player.holsteredWeapon?.weaponId).toBe('bar');
  });
  it('refills an owned holstered wall gun, never its magazine or full reserves', () => {
    const player = createPlayerState('e:1', origin, 5000);
    equipWeapon(player, 'kar98k'); settle(player); switchWeapon(player);
    const definition = { id: 'wall', weaponId: 'kar98k', position: origin, weaponCost: 200, ammoCost: 100 };
    const item = createWallWeaponInteractable('e:5', definition), wall = createWallWeaponState(definition, item.id);
    const events = handleWallWeaponInteraction(player, action('wallWeapon', item.id), [wall]);
    expect(events[0].type).toBe('wallWeaponAmmoFull'); expect(player.points).toBe(5000);
    player.holsteredWeapon!.reserveAmmo = 0; player.holsteredWeapon!.magazineAmmo = 1;
    handleWallWeaponInteraction(player, action('wallWeapon', item.id), [wall]);
    expect(player.points).toBe(4900); expect(player.weapon.weaponId).toBe('starter-pistol');
    expect(player.holsteredWeapon).toMatchObject({ reserveAmmo: 50, magazineAmmo: 1 });
  });
});

describe('mystery box lifecycle', () => {
  const setup = () => {
    const player = createPlayerState('e:1', origin, 5000), other = createPlayerState('e:2', origin, 5000);
    const { state: box, interactable } = createMysteryBox({ id: 'box', position: origin,
      cost: 950, weapons: ['kar98k', 'bar', 'mp40'] }, 'e:3');
    const tick = (count: number) => { for (let i = 0; i < count; i++) tickMysteryBoxes([box], [interactable], [player, other]); };
    const use = (buyer = player) => useMysteryBox(buyer, action('mysteryBox', 'e:3', buyer.id), [box], 22);
    return { player, other, box, interactable, tick, use };
  };
  it('charges once, rolls for three seconds, then offers the buyer a free claim', () => {
    const { player, other, box, tick, use } = setup();
    use(); expect(player.points).toBe(4050); expect(player.weapon.weaponId).toBe('starter-pistol');
    expect(use()).toEqual([]); expect(use(other)).toEqual([]);
    tick(BOX_RULES.rollTicks - 1); expect(box.phase).toBe('rolling');
    tick(1); expect(box.phase).toBe('offering');
    expect(use(other)).toEqual([]); expect(other.points).toBe(5000);
    expect(use()).toMatchObject([{ type: 'mysteryBoxClaimed', weaponId: box.lastWeapon }]);
    expect(player.weapon.weaponId).toBe(box.lastWeapon); expect(player.points).toBe(4050);
    expect(player.holsteredWeapon?.weaponId).toBe('starter-pistol');
    expect(use()).toEqual([]); tick(BOX_RULES.closingTicks); expect(box.phase).toBe('idle');
  });
  it('expires unclaimed weapons after ten seconds without replacing or refunding', () => {
    const { player, box, tick, use } = setup();
    use(); tick(BOX_RULES.rollTicks + BOX_RULES.claimTicks);
    expect(box.phase).toBe('closing'); expect(use()).toEqual([]);
    tick(BOX_RULES.closingTicks); expect(box.phase).toBe('idle');
    expect(box.ownerId).toBeNull(); expect(player.weapon.weaponId).toBe('starter-pistol'); expect(player.points).toBe(4050);
  });
  it('releases a dead buyer’s box and replays seeded rolls exactly', () => {
    const a = setup(), b = setup(); a.use(); b.use(); expect(a.box).toEqual(b.box);
    a.player.alive = false; a.tick(1); expect(a.box.phase).toBe('closing');
    a.tick(BOX_RULES.closingTicks); expect(a.box.phase).toBe('idle');
  });
  it('excludes both owned guns and does not charge when no eligible weapon remains', () => {
    const { player, box, use } = setup();
    equipWeapon(player, 'kar98k'); equipWeapon(player, 'bar'); settle(player); switchWeapon(player); settle(player);
    equipWeapon(player, 'kar98k'); // BAR holstered, Kar98k held.
    use(); expect(box.lastWeapon).toBe('mp40');
    box.phase = 'idle'; box.weapons = ['kar98k', 'bar'];
    const balance = player.points;
    expect(use()).toMatchObject([{ type: 'mysteryBoxUnavailable' }]); expect(player.points).toBe(balance);
  });
});
