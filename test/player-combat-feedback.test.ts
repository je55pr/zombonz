import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('../src/client/runtimeAssets.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/runtimeAssets.ts')>(),
  loadModel: () => new Promise(() => {}),
}));

import { PlayerView } from '../src/client/playerView.ts';
import { createPlayerState, upgradeGlow } from '../src/core/index.ts';

afterEach(() => vi.unstubAllGlobals());

function stubCanvas(): void {
  vi.stubGlobal('document', { createElement: () => {
    const context = new Proxy({ measureText: () => ({ width: 40 }) } as Record<string | symbol, unknown>,
      { get: (target, key) => target[key] ?? (target[key] = vi.fn()) });
    return { width: 0, height: 0, getContext: () => context };
  } });
}

describe('remote player combat feedback', () => {
  it('reuses one muzzle flash for replicated firing and expires it after four ticks', () => {
    stubCanvas();
    const view = new PlayerView('Buddy', 1);
    const player = createPlayerState('e:2', { x: 0, y: 0, z: 0 });
    const flash = view.root.getObjectByName('remote-muzzle-flash') as THREE.Mesh;

    view.update(player, undefined, 1, 10);
    expect(flash.visible).toBe(false);
    view.events([{ type: 'weaponFired', playerId: player.id, weaponId: 'starter-pistol' }], player.id, 10);
    view.update(player, undefined, 1, 10);
    expect(flash.visible).toBe(true);
    view.update(player, undefined, 1, 13);
    expect(flash.visible).toBe(true);
    view.update(player, undefined, 1, 14);
    expect(flash.visible).toBe(false);
    expect(view.root.getObjectByName('remote-muzzle-flash')).toBe(flash);
    view.dispose();
  });

  it('uses upgraded muzzle colours and ignores somebody else firing', () => {
    stubCanvas();
    const view = new PlayerView('Buddy', 1);
    const player = createPlayerState('e:2', { x: 0, y: 0, z: 0 });
    const flash = view.root.getObjectByName('remote-muzzle-flash') as THREE.Mesh;
    const material = flash.material as THREE.MeshBasicMaterial;

    view.events([{ type: 'weaponFired', playerId: 'e:3', weaponId: 'starter-pistol-pap' }], player.id, 20);
    view.update(player, undefined, 1, 20);
    expect(flash.visible).toBe(false);

    view.events([{ type: 'weaponFired', playerId: player.id, weaponId: 'starter-pistol-pap' }], player.id, 20);
    view.update(player, undefined, 1, 20);
    expect(flash.visible).toBe(true);
    expect(material.color.getHex()).toBe(upgradeGlow('starter-pistol-pap'));
    view.dispose();
  });
});
