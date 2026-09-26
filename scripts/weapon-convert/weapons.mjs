// Per-weapon conversion settings. Lengths are real overall lengths in metres.
const pbr = (dir, prefix, names) => ({
  base: `${dir}/${prefix}${names.base}`, normal: `${dir}/${prefix}${names.normal}`,
  metallic: names.metallic && `${dir}/${prefix}${names.metallic}`,
  roughness: names.roughness && `${dir}/${prefix}${names.roughness}`,
  ao: names.ao && `${dir}/${prefix}${names.ao}`,
});
const shotgunPart = part => pbr('double-barrel-shotgun/textures', `shotgun_${part}_low_`,
  { base: 'BaseColor.png', normal: 'Normal.png', metallic: 'Metallic.png', roughness: 'Roughness.png' });
const mg42 = size => pbr('mg42/textures', `mg42-low_MG42-${size}_`,
  { base: 'BaseColor_sRGB.png', normal: 'Normal_Raw.png', metallic: 'Metallic_Raw.png', roughness: 'Roughness_Raw.png' });
const m97 = set => pbr('winchester-model-1897/textures', `m97_${set}`,
  { base: 'a.png', normal: 'n.png', metallic: 'm_2.png', roughness: 'r_2.png', ao: '2_occlusion.png' });
const mosin = part => pbr('mosin-nagant-m91/textures', `Mosin${part}_MAT_`,
  { base: 'albedo.jpeg', normal: 'normal.png', metallic: 'metallic.jpeg', roughness: 'roughness.jpeg', ao: 'AO.jpeg' });

export const WEAPONS = {
  'double-barrel': {
    source: 'double-barrel-shotgun/source/x/shotgun.fbx', length: 1.14,
    materials: Object.fromEntries(['chambers', 'forearm', 'realese', 'trigger', 'stock', 'barrel']
      .map(part => [`${part}_low`, shotgunPart(part)])),
  },
  'm1-garand': {
    source: 'm1-garand/source/x/m1garand.fbx', length: 1.107,
    // The clip and rounds sit outside the rifle in the source scene.
    drop: /^(Casing|Clip|Bullets)$/, flipForward: true,
    materials: {
      Metal: { base: 'm1-garand/textures/metal_color.jpeg', metal: 0.85, rough: 0.45 },
      Wood: { base: 'm1-garand/textures/wood_color.jpeg', metal: 0, rough: 0.7 },
      Rubber: { color: [0.04, 0.04, 0.04, 1], metal: 0, rough: 0.9 },
      Bullet_Gold: { color: [0.78, 0.58, 0.26, 1], metal: 1, rough: 0.35 },
      Bullet_Brass: { color: [0.7, 0.5, 0.24, 1], metal: 1, rough: 0.4 },
    },
  },
  mg42: {
    source: 'mg42/source/x/mg42 sketchfab/mg42-low.fbx', length: 1.22,
    materials: { checker1k: mg42('1k'), checker2k: mg42('2k') },
  },
  mosin: {
    source: 'mosin-nagant-m91/source/x/model/model.dae', length: 1.287,
    materials: { MosinBody_MAT: mosin('Body'), MosinDetail_MAT: mosin('Detail') },
  },
  // The source is a .blend; blend-to-glb.py exports it first (loose shell and lights removed).
  // UV sampling against each atlas's transparency shows material .007 uses the m97 set and .008 the m97_1 set.
  'trench-gun': {
    source: 'winchester-model-1897/source/x/m97.glb', length: 1.0, flipForward: true,
    materials: { 'm97mat.007': m97(''), 'm97mat.008': m97('1_') },
  },
  mp40: {
    source: 'mp-40-ww2-submachine-gun/source/x/MP 40.obj', length: 0.833, magazine: /^MP40.001/,
    materials: { MP40: pbr('mp-40-ww2-submachine-gun/textures', 'MP40_',
      { base: 'Base_Color.png', normal: 'Normal_OpenGL.png', metallic: 'Metallic.png', roughness: 'Roughness.png' }) },
  },
  ppsh41: {
    source: 'ppsh-41/source/PPSh-41.fbx', length: 0.843, flipForward: true,
    materials: { PPSH: pbr('ppsh-41/textures', 'PPSH_',
      { base: 'BaseColor.png', normal: 'Normal.png', metallic: 'Metallic.png', roughness: 'Roughness.png' }) },
  },
  springfield: {
    source: 'm1903-a3-springfield/source/Springfield M1903 A3 (Sketchfab).fbx', length: 1.105,
    // The source parks the floorplate piece beside the rifle.
    drop: /Cartridge|Bullet|Magazine/, up: [0, 1, 0], forward: [1, 0, 0],
    materials: { 'M1903 A3': pbr('m1903-a3-springfield/textures', 'M1903_A3_',
      { base: 'Base_color.png', normal: 'Normal_OpenGL.png', metallic: 'Metallic.png', roughness: 'Roughness.png', ao: 'Mixed_AO.png' }) },
  },
};
