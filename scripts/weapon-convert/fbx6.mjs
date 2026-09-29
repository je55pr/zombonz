// Minimal reader for FBX 6.1 binary files (three.js FBXLoader needs 7000 or later, and Blender 4.5 needs 7100).
// Geometry only: vertices, polygons, normals and UVs of every Model, with its local transform. Used for the gamekorp Ka-Bar knife.
import { inflateSync } from 'node:zlib';
import * as THREE from 'three';

function readProperty(view, bytes, offset) {
  const type = String.fromCharCode(bytes[offset]); offset += 1;
  switch (type) {
    case 'Y': return [view.getInt16(offset, true), offset + 2];
    case 'C': return [bytes[offset] !== 0, offset + 1];
    case 'I': return [view.getInt32(offset, true), offset + 4];
    case 'F': return [view.getFloat32(offset, true), offset + 4];
    case 'D': return [view.getFloat64(offset, true), offset + 8];
    case 'L': return [Number(view.getBigInt64(offset, true)), offset + 8];
    case 'S': case 'R': {
      const length = view.getUint32(offset, true); offset += 4;
      const slice = bytes.subarray(offset, offset + length);
      return [type === 'S' ? Buffer.from(slice).toString('latin1') : slice, offset + length];
    }
    case 'f': case 'd': case 'l': case 'i': case 'b': {
      const count = view.getUint32(offset, true), encoding = view.getUint32(offset + 4, true), compressed = view.getUint32(offset + 8, true);
      offset += 12;
      const size = { f: 4, d: 8, l: 8, i: 4, b: 1 }[type];
      let data = bytes.subarray(offset, offset + (encoding ? compressed : count * size));
      if (encoding) data = inflateSync(data);
      const copy = new Uint8Array(data).buffer;
      const array = { f: Float32Array, d: Float64Array, i: Int32Array, b: Uint8Array, l: BigInt64Array }[type];
      return [Array.from(new array(copy, 0, count), Number), offset + (encoding ? compressed : count * size)];
    }
    default: throw new Error(`FBX: unknown property type ${type}`);
  }
}

function readNodes(view, bytes, offset, end) {
  const nodes = [];
  while (offset < end) {
    const nodeEnd = view.getUint32(offset, true);
    if (nodeEnd === 0) return { nodes, offset: offset + 13 };
    const count = view.getUint32(offset + 4, true), nameLength = bytes[offset + 12];
    const name = Buffer.from(bytes.subarray(offset + 13, offset + 13 + nameLength)).toString('latin1');
    let cursor = offset + 13 + nameLength;
    const props = [];
    for (let i = 0; i < count; i++) { const [value, next] = readProperty(view, bytes, cursor); props.push(value); cursor = next; }
    let children = [];
    if (cursor < nodeEnd) children = readNodes(view, bytes, cursor, nodeEnd).nodes;
    nodes.push({ name, props, children });
    offset = nodeEnd;
  }
  return { nodes, offset };
}

const child = (node, name) => node.children.find(c => c.name === name);
/** FBX 6.1 stores an array as one property per element; later versions use a single array property. */
const values = node => (node && node.props.length === 1 && Array.isArray(node.props[0]) ? node.props[0] : node?.props);

export function loadFbx6(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  const version = view.getUint32(23, true);
  if (version >= 7000) throw new Error('Use FBXLoader for FBX 7 and later.');
  const { nodes } = readNodes(view, bytes, 27, bytes.length);
  const objects = nodes.find(n => n.name === 'Objects');
  const group = new THREE.Group();
  for (const model of objects.children.filter(n => n.name === 'Model')) {
    const vertices = values(child(model, 'Vertices')), indices = values(child(model, 'PolygonVertexIndex'));
    if (!vertices || !indices) continue;
    const layerNormal = child(model, 'LayerElementNormal'), layerUv = child(model, 'LayerElementUV');
    const normals = layerNormal && values(child(layerNormal, 'Normals'));
    const uvs = layerUv && values(child(layerUv, 'UV')), uvIndex = layerUv && values(child(layerUv, 'UVIndex'));
    const normalMapping = layerNormal && child(layerNormal, 'MappingInformationType')?.props[0];
    const positions = [], outNormals = [], outUvs = [];
    // Polygons end at the negative index (~index); fan-triangulate each one.
    let polygon = [], corner = 0;
    const emit = (list, cornerAt) => {
      for (let k = 1; k + 1 < list.length; k++) {
        for (const at of [0, k, k + 1]) {
          const { vertex, corner: c } = { vertex: list[at], corner: cornerAt[at] };
          positions.push(vertices[vertex * 3], vertices[vertex * 3 + 1], vertices[vertex * 3 + 2]);
          if (normals) {
            const n = normalMapping === 'ByVertice' ? vertex : c;
            outNormals.push(normals[n * 3], normals[n * 3 + 1], normals[n * 3 + 2]);
          }
          if (uvs) { const u = uvIndex ? uvIndex[c] : c; outUvs.push(uvs[u * 2], uvs[u * 2 + 1]); }
        }
      }
    };
    let corners = [];
    for (const raw of indices) {
      const last = raw < 0, vertex = last ? ~raw : raw;
      polygon.push(vertex); corners.push(corner++);
      if (last) { emit(polygon, corners); polygon = []; corners = []; }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (outNormals.length) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(outNormals, 3));
    else geometry.computeVertexNormals();
    if (outUvs.length) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(outUvs, 2));
    const name = model.props[0].split('\0')[0];
    const properties = child(model, 'Properties60');
    const prop = key => properties?.children.find(p => p.props[0] === key);
    const vector = key => { const p = prop(key); return p ? [p.props[3], p.props[4], p.props[5]] : null; };
    const t = vector('Lcl Translation'), r = vector('Lcl Rotation'), s = vector('Lcl Scaling');
    // Bake the local transform in here, so the mesh carries none. A mirroring one (a negative scale, as this knife has)
    // turns triangles inside out, so their winding is reversed to compensate.
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...(t ?? [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(r ?? [0, 0, 0]).map(v => v * Math.PI / 180), 'XYZ')),
      new THREE.Vector3(...(s ?? [1, 1, 1])));
    geometry.applyMatrix4(matrix);
    if (matrix.determinant() < 0) {
      for (const attribute of Object.values(geometry.attributes)) {
        for (let i = 0; i < attribute.count; i += 3) {
          for (let c = 0; c < attribute.itemSize; c++) {
            const a = attribute.getComponent(i + 1, c); attribute.setComponent(i + 1, c, attribute.getComponent(i + 2, c)); attribute.setComponent(i + 2, c, a);
          }
        }
      }
    }
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ name: name.replace(/^Model::/, '') }));
    mesh.name = name.replace(/^Model::/, '');
    group.add(mesh);
  }
  return group;
}
