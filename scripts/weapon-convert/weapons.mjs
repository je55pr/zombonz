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
  // Second batch (2026-09-26): WaW box weapons, BO1 Cold War guns and two original wonder weapons.
  thompson: {
    source: 'thompson-submachine-gun/source/x/model/model.dae', length: 0.86,
    autoMaterials: 'thompson-submachine-gun/textures/', materials: {},
  },
  stg44: {
    source: 'stg-44/source/x/model/model.dae', length: 0.94, magazine: /Magazin/,
    autoMaterials: 'stg-44/textures/', materials: {},
  },
  fg42: {
    source: 'fg42/source/FG42.fbx', length: 0.975, flipForward: true, magazine: /^Magazine$/,
    autoMaterials: 'fg42/textures/FG42_', materials: {},
  },
  'm1-carbine': {
    source: 'm1-carbine/source/carbine_low.fbx', length: 0.904, flipForward: true,
    materials: { 'Material #43': { auto: 'm1-carbine/textures/carbine_low_Material__43_' } },
  },
  'magnum-357': {
    source: 'revolver-357-magnum/source/x/model/model.dae', length: 0.3, flipForward: true,
    // A small part floats above the revolver in the source scene.
    islandRules: [{ min: [-1, 0.1, -1], action: 'drop' }],
    materials: { Material_008: { auto: 'revolver-357-magnum/textures/Revolver_' } },
  },
  python: {
    source: 'gameready-colt-python-revolver/source/revolver_game.fbx', length: 0.29, flipForward: true,
    materials: { M_WP_Revolver: { auto: 'gameready-colt-python-revolver/textures/M_WP_Revolver_', emissive: null } },
  },
  ak74u: {
    source: 'animated-aks-74u/source/fp_hands_aks74u.fbx', length: 0.73, flipForward: true,
    // The source rigs the gun into first-person arms, posed rolled 9.4 degrees about the bore and yawed 1.25 (found
    // by fitting the gun's mirror plane: the top and bottom of the gun then sit on one vertical line along its
    // whole length); turn it upright.
    turn: { roll: 9.4, yaw: -1.25 },
    // Keep only the gun's materials.
    dropMaterials: /^(arms|bullet|__DEFAULT)$/,
    // Its reload rig parks a spare magazine behind the grip; the fitted one becomes the reload part.
    islandRules: [{ min: [0.05, -1, -0.37], max: [0.09, 1, -0.25], action: 'drop' },
      { min: [-0.07, 0.02, 0.08], max: [-0.03, 0.06, 0.12], action: 'magazine' }],
    materials: {
      aks74u: { color: [0.11, 0.11, 0.12, 1], metal: 0.8, rough: 0.5,
        normal: 'animated-aks-74u/textures/AKS74U_Normal.png', ao: 'animated-aks-74u/textures/AKS74U_AO.png' },
      'aks74u.wood': { color: [0.33, 0.16, 0.07, 1], metal: 0, rough: 0.65,
        normal: 'animated-aks-74u/textures/AKS74U_Normal.png', ao: 'animated-aks-74u/textures/AKS74U_AO.png' },
    },
  },
  commando: {
    source: 'colt-xm177e1-game-asset/source/LPUVW.fbx', length: 0.76,
    materials: { __DEFAULT: { base: 'colt-xm177e1-game-asset/textures/colt_albedo_5.png',
      normal: 'colt-xm177e1-game-asset/textures/colt2_normals_grawery.png', metallic: 'colt-xm177e1-game-asset/textures/metalness_5.png',
      roughness: 'colt-xm177e1-game-asset/textures/roughness_5.png', ao: 'colt-xm177e1-game-asset/textures/colt2_occlusion.png' } },
  },
  m14: {
    source: 'm14-rifle/source/x/m14/m14_obj.obj', length: 1.118, magazine: /^mag$/,
    materials: { Red: { auto: 'm14-rifle/textures/m14_texture_Red_' }, Blue: { auto: 'm14-rifle/textures/m14_texture_Blue_' } },
  },
  fal: {
    source: 'fn-fal/source/FN_FAL Final.fbx', length: 1.09, flipForward: true, magazine: /Cargador/,
    drop: /^Plane001$/, // a display sign beside the rifle
    materials: { Cargador: { auto: 'fn-fal/textures/Cargador_' }, Rifle: { auto: 'fn-fal/textures/Rifle_' } },
  },
  rpk: {
    source: 'rpk74m/source/Pickup_rpk74M.fbx', length: 1.06, flipForward: true, flipUp: true, magazine: /Magazine/,
    materials: { fddhddd: { auto: 'rpk74m/textures/rpk74m_low_fddhddd_' } },
  },
  mp5k: {
    source: 'mp5k/source/mp5k.fbx', length: 0.325,
    materials: { mp5: { base: 'mp5k/textures/mp5_a.png', normal: 'mp5k/textures/mp5_n.png', metal: 0.7, rough: 0.5 },
      bullets: { base: 'mp5k/textures/bullets_a.png', normal: 'mp5k/textures/bullets_n.png', metal: 1, rough: 0.4 } },
  },
  skorpion: {
    source: 'vz61-skorpion/source/Vz61_Skorpion_low.fbx', length: 0.517, magazine: /Mag/i,
    materials: { 'Material.001': { auto: 'vz61-skorpion/textures/Vz61_Skorpion_low_Material.001_' } },
  },
  spas12: {
    source: 'franchi-spas-12-shotgun/source/x/model/model.dae', length: 1.04, flipForward: true,
    // Four loose shells lie beside the shotgun in the source scene.
    islandRules: [{ max: [0.01, 1, 1], action: 'drop' }],
    materials: { initialShadingGroup: { auto: 'franchi-spas-12-shotgun/textures/initialShadingGroup_', emissive: null } },
  },
  ithaca37: {
    source: 'ithaca-37/source/x/model/model.dae', length: 1.0,
    materials: { Material: { auto: 'ithaca-37/textures/Material_' } },
  },
  rpg7: {
    source: 'rpg-7-free-model/source/export 2.fbx', length: 0.95, flipForward: true,
    drop: /^pCylinder8$/, // the warhead lies loose above the launcher in the source scene
    autoMaterials: 'rpg-7-free-model/textures/export_1_', materials: {},
  },
  irrlicht: {
    source: 'dieselpunk-signal-flare-pistol/source/x/flare_low_newham.obj', length: 0.35,
    materials: { standardSurface3SG: { auto: 'dieselpunk-signal-flare-pistol/textures/flare_low_newham_standardSurface3SG_' } },
  },
  molniya: {
    source: 'diesel-punk-ussr-gun/source/x/DieselPistol.fbx', length: 0.34, flipForward: true,
    // A spare power cell stands on display behind the pistol.
    islandRules: [{ max: [-0.03, 1, -0.14], action: 'drop' }],
    materials: { Material: { auto: 'diesel-punk-ussr-gun/textures/Material_' } },
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
  // Melee viewmodel (issue #178): the gamekorp Ka-Bar, CC0. Its FBX is version 6.1, read by fbx6.mjs; make-knife-maps.mjs
  // writes the metallic and roughness maps its single baked skin lacks. Real overall length 30 cm.
  knife: {
    source: 'kabar-knife/knife_mesh.FBX', length: 0.3, flipForward: true,
    materials: { knife: { base: 'kabar-knife/skin.jpg', metallic: 'kabar-knife/metallic.png', roughness: 'kabar-knife/roughness.png' } },
  },
};
