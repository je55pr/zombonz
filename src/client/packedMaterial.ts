import * as THREE from 'three';
import { isUpgradedWeapon, upgradeGlow } from '../core/upgrades.ts';

/**
 * The finish of a Pack-a-Punched gun: a dark, metallic, space-age skin over the whole gun (its own colour textures are
 * dropped; its normal and occlusion maps stay, so the detail does), crossed by glowing circuit-board traces in the gun's own
 * colour (`glow`, from its row in upgrades.ts), with a slow pulse running along the barrel.
 *
 * The traces are worked out in the shader from the gun's own space, projected onto the model from three sides, so they
 * cover every part however its texture is laid out, at the same scale everywhere: fine traces about 1.4 cm to a cell and a
 * coarser, bolder set over them. Traces run between the middles of cells' edges. Whether an edge is open is decided once
 * per edge, so a trace carries on into the next cell, and a pad sits wherever traces meet or end.
 */
const FINISH = 0x1b1f27;

const VERTEX_DECLARATIONS = `
varying vec3 vPapPos;
varying vec3 vPapNormal;
`;
const VERTEX_BODY = `
vPapPos = position;
vPapNormal = normal;
`;
const FRAGMENT_DECLARATIONS = `
varying vec3 vPapPos;
varying vec3 vPapNormal;
uniform vec3 papGlow;
uniform float papTime;

float papHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// One layer of circuit board on a plane, in cells of one unit: 1 on a trace, 0 off it, with a soft edge.
float papBoard(vec2 uv, float seed, float width, float open) {
  vec2 cell = floor(uv);
  vec2 f = fract(uv) - 0.5;
  float l = 1.0 - step(open, papHash(cell + vec2(seed, 1.7)));
  float r = 1.0 - step(open, papHash(cell + vec2(1.0, 0.0) + vec2(seed, 1.7)));
  float b = 1.0 - step(open, papHash(cell + vec2(seed, 9.1)));
  float t = 1.0 - step(open, papHash(cell + vec2(0.0, 1.0) + vec2(seed, 9.1)));
  float d = 10.0;
  if (l > 0.5) d = min(d, length(f - vec2(clamp(f.x, -0.5, 0.0), 0.0)));
  if (r > 0.5) d = min(d, length(f - vec2(clamp(f.x, 0.0, 0.5), 0.0)));
  if (b > 0.5) d = min(d, length(f - vec2(0.0, clamp(f.y, -0.5, 0.0))));
  if (t > 0.5) d = min(d, length(f - vec2(0.0, clamp(f.y, 0.0, 0.5))));
  float count = l + r + b + t;
  // A pad where traces meet or end (not where one simply passes through or turns a corner).
  if (count > 0.5 && abs(count - 2.0) > 0.5) d = min(d, length(f) - width * 1.4);
  // Coverage of the pixel: a line thinner than a pixel is dimmer, not wider. Seen from so far that a cell is under a few pixels,
  // the layer fades out, or its lines would only average into a haze.
  float aa = max(max(fwidth(uv.x), fwidth(uv.y)), 1e-4);
  return clamp(0.5 + (width - d) / aa, 0.0, 1.0) * (1.0 - smoothstep(0.2, 0.5, aa));
}

// The traces at a point of the gun, blended over the three faces it might be seen from.
float papCircuit(vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(5.0));
  w /= (w.x + w.y + w.z + 1e-4);
  float fine = w.x * papBoard(p.zy / 0.014, 0.0, 0.03, 0.3) + w.y * papBoard(p.xz / 0.014, 3.0, 0.03, 0.3)
    + w.z * papBoard(p.xy / 0.014, 7.0, 0.03, 0.3);
  float coarse = w.x * papBoard(p.zy / 0.06, 11.0, 0.02, 0.22) + w.y * papBoard(p.xz / 0.06, 13.0, 0.02, 0.22)
    + w.z * papBoard(p.xy / 0.06, 17.0, 0.02, 0.22);
  return max(fine * 0.6, coarse);
}
`;
const FRAGMENT_BODY = `
{
  float papLines = papCircuit(vPapPos, normalize(vPapNormal));
  float papPulse = 0.72 + 0.28 * sin(vPapPos.z * 16.0 - papTime * 2.4);
  totalEmissiveRadiance += papGlow * papLines * papPulse * 1.7;
}
`;

/** `source` with `code` added after the first `marker`, or null if the marker is not there (three.js changed its shader chunks). */
function addAfter(source: string, marker: string, code: string): string | null {
  return source.includes(marker) ? source.replace(marker, () => `${marker}\n${code}`) : null;
}

/** A copy of `source` with the Pack-a-Punch finish, glowing `glow`. The source's own material is never written to. */
export function makePackedMaterial(source: THREE.MeshStandardMaterial, glow: number): THREE.MeshStandardMaterial {
  const material = source.clone();
  const colour = new THREE.Color(glow);
  material.map = null; material.metalnessMap = null; material.roughnessMap = null; material.emissiveMap = null;
  // Almost black, whatever the glow: a metal reflects its own colour, so a tinted finish lights up in the colour instead of the lines.
  material.color.setHex(FINISH);
  material.metalness = 0.7; material.roughness = 0.4;
  material.emissive.setHex(0x000000); material.emissiveIntensity = 1;
  material.userData.packedGlow = colour;
  const uniforms = { papGlow: { value: colour }, papTime: { value: 0 } };
  // Every packed material runs the same program, whatever its colour: the colour is a uniform.
  material.customProgramCacheKey = () => 'pack-a-punch-circuit';
  material.onBeforeCompile = shader => {
    const vertex = addAfter(addAfter(shader.vertexShader, '#include <common>', VERTEX_DECLARATIONS) ?? '',
      '#include <begin_vertex>', VERTEX_BODY);
    const fragment = addAfter(addAfter(shader.fragmentShader, '#include <common>', FRAGMENT_DECLARATIONS) ?? '',
      '#include <emissivemap_fragment>', FRAGMENT_BODY);
    // If a three.js upgrade moves the places these go, the gun is still drawn dark and glowing at its edge, without the traces.
    if (!vertex || !fragment) { console.warn('Pack-a-Punch circuit lines unavailable: three.js shader chunks have changed'); return; }
    shader.vertexShader = vertex; shader.fragmentShader = fragment;
    shader.uniforms.papGlow = uniforms.papGlow; shader.uniforms.papTime = uniforms.papTime;
  };
  material.onBeforeRender = () => { uniforms.papTime.value = performance.now() / 1000; };
  return material;
}

/** A Pack-a-Punched gun's glow as a CSS colour, for its name on the HUD; null for any other gun. */
export function packedGlowCss(weaponId: string): string | null {
  const glow = upgradeGlow(weaponId);
  return isUpgradedWeapon(weaponId) && glow !== undefined ? `#${glow.toString(16).padStart(6, '0')}` : null;
}
