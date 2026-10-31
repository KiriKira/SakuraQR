// Builds the three walking figures for scene.js as glTF binaries: node tools/make-walkers.mjs
//
// Each figure is a voxel model (4 voxels per tree cube) skinned rigidly to five joints — hips, two arms, two legs —
// with one looping "walk" clip: legs and arms swing, the hips bob, and the hips are lifted just enough each frame
// that no foot ever dips below the ground. One mesh, one material (vertex colours) per figure.
//
// Units: 1 = one tree cube (scene.js scales by info.cell). +Y up, feet on y = 0, facing +Z.
// The root node's extras carry { unit, height, radius, stride, cycle }: stride is how far the figure moves over one
// cycle when the clip plays at speed 1, so the host can set timeScale = speed / (stride / cycle).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const V = 0.25;               // voxel edge in tree cubes
const CYCLE = 0.8;            // seconds per walk cycle (two steps)
const LEG_SWING = 28 * Math.PI / 180;
const ARM_SWING = 32 * Math.PI / 180;
const BOB = 0.5;              // extra hip lift at the passing pose, in voxels
const KEYS = 24;

// joints: 0 hips (body, head, hat, cape), 1 arm +x, 2 arm -x, 3 leg +x, 4 leg -x
const HIPS = 0, ARM_P = 1, ARM_N = 2, LEG_P = 3, LEG_N = 4;
const PIVOTS = [[0, 3, 0], [4, 6.5, 0], [-4, 6.5, 0], [2, 3, 0], [-2, 3, 0]];   // voxel units, absolute
const JOINT_NAMES = ['hips', 'arm_l', 'arm_r', 'leg_l', 'leg_r'];

function figure() {
  const parts = PIVOTS.map(() => new Map());
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const api = {
    parts,
    box(j, x0, x1, y0, y1, z0, z1, col) {
      for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) {
        if (col) parts[j].set(key(x, y, z), col); else parts[j].delete(key(x, y, z));
      }
    },
    px(j, x, y, z, col) { api.box(j, x, x + 1, y, y + 1, z, z + 1, col); },
    // mirror helper: same box on both sides of x = 0
    pair(j, x0, x1, y0, y1, z0, z1, col) { api.box(j, x0, x1, y0, y1, z0, z1, col); api.box(j, -x1, -x0, y0, y1, z0, z1, col); }
  };
  return api;
}

// The common chibi body: 2-voxel legs, 6x4x4 torso, 2x4x2 arms, 8x6x6 head with the face on the +Z side.
function base(f, c) {
  for (const [j, x0] of [[LEG_P, 1], [LEG_N, -3]]) {
    f.box(j, x0, x0 + 2, 0, 3, -1, 1, c.leg);
    f.box(j, x0, x0 + 2, 0, 1, -1, 1, c.shoe);
  }
  f.box(HIPS, -3, 3, 3, 7, -2, 2, c.torso);
  for (const [j, x0] of [[ARM_P, 3], [ARM_N, -5]]) {
    f.box(j, x0, x0 + 2, 3, 7, -1, 1, c.sleeve);
    f.box(j, x0, x0 + 2, 3, 4, -1, 1, c.hand);
  }
  f.box(HIPS, -4, 4, 7, 13, -3, 3, c.hair);
  f.box(HIPS, -3, 3, 7, 11, 2, 3, c.skin);           // face on the front layer
  f.box(HIPS, -2, -1, 8, 10, 2, 3, c.eye);
  f.box(HIPS, 1, 2, 8, 10, 2, 3, c.eye);
}

// Blue: hooded healer — blue hood with a white band and a light-blue crest, tails sticking out, short dark-blue cape.
function blue() {
  const c = {
    hood: '#2D5BD0', dark: '#1F3F9E', light: '#5FB2F0', white: '#F6F6F2', skin: '#F2BFA4', eye: '#3A8CE0',
    leg: '#F6F6F2', shoe: '#2D5BD0', torso: '#3E86E2', sleeve: '#2D5BD0', hand: '#F6F6F2', hair: '#2D5BD0'
  };
  const f = figure(); base(f, c);
  f.box(HIPS, -4, 4, 13, 14, -3, 3, c.hood);                 // hood top
  f.box(HIPS, -4, 4, 11, 12, -3, 3, c.white);                // band all round
  f.box(HIPS, -1, 1, 11, 14, 2, 3, c.light);                 // crest on the front
  f.box(HIPS, -1, 1, 13, 14, -2, 3, c.light);                // ... running over the top
  f.box(HIPS, -2, 2, 7, 8, 2, 3, c.white);                   // white muffler under the face
  f.pair(HIPS, 4, 6, 9, 10, -1, 1, c.hood);                  // hood tails
  f.pair(HIPS, 5, 6, 10, 11, -1, 1, c.hood);
  f.box(HIPS, -2, 2, 3, 7, 1, 2, c.light);                   // tunic front
  f.box(HIPS, -3, 3, 4, 5, -2, 2, c.white);                  // belt
  f.box(HIPS, -3, 3, 2, 7, -3, -2, c.dark);                  // cape
  f.box(HIPS, -4, 4, 2, 3, -3, -2, c.dark);
  f.pair(HIPS, 3, 4, 2, 3, -2, 2, c.hood);                   // tunic skirt corners
  return { name: 'walker-blue', f };
}

// Red: mage — salmon hair, wide dark-red hat with a bent tip, long robe with a dark-red front and white collar.
function red() {
  const c = {
    hat: '#E8503E', dark: '#A8202C', hair: '#F0684E', skin: '#F4C3A6', eye: '#8C1C24', white: '#FAF6F0',
    leg: '#F4C3A6', shoe: '#FAF6F0', torso: '#EC5A46', sleeve: '#EC5A46', hand: '#F4C3A6'
  };
  const f = figure(); base(f, c);
  f.px(HIPS, -3, 10, 2, c.hair); f.px(HIPS, 0, 10, 2, c.hair); f.px(HIPS, 2, 10, 2, c.hair);   // fringe
  f.box(HIPS, -4, 4, 4, 7, -3, -2, c.hair);                  // hair down the back
  f.pair(HIPS, 4, 5, 8, 11, -2, 1, c.hair);                  // side locks
  f.box(HIPS, -5, 5, 13, 14, -4, 3, c.dark);                 // brim
  f.box(HIPS, -3, 3, 14, 15, -3, 2, c.dark);                 // band
  f.box(HIPS, -3, 3, 15, 16, -3, 2, c.hat);
  f.box(HIPS, -2, 2, 16, 18, -2, 1, c.hat);
  f.box(HIPS, -2, 1, 18, 19, -2, 0, c.hat);
  f.box(HIPS, -3, -1, 19, 20, -2, -1, c.hat);                // tip bends over
  f.box(HIPS, -2, 2, 6, 7, 1, 2, c.white);                   // collar
  f.box(HIPS, -1, 1, 3, 6, 1, 2, c.dark);                    // robe front
  f.box(HIPS, -4, 4, 1, 3, -3, 2, c.torso);                  // robe skirt (legs swing inside it)
  f.box(HIPS, -4, 4, 1, 2, -3, 2, c.dark);                   // hem
  f.box(HIPS, -1, 1, 1, 3, 2, 3, c.dark);                    // front slit panel
  f.box(ARM_P, 3, 5, 4, 5, -1, 1, c.dark); f.box(ARM_N, -5, -3, 4, 5, -1, 1, c.dark);   // cuffs
  return { name: 'walker-red', f };
}

// Gold: horned warrior — gold helmet with white horns, brown hair, gold armour with a brown check, bare arms.
function gold() {
  const c = {
    helm: '#E9A62C', dark: '#9A5316', horn: '#FAF6EE', hair: '#9A5316', skin: '#F2BC9C', eye: '#5A2E0E',
    leg: '#FAF6EE', shoe: '#9A5316', torso: '#E9A62C', sleeve: '#F2BC9C', hand: '#F2BC9C', white: '#FAF6EE'
  };
  const f = figure(); base(f, c);
  f.box(HIPS, -4, 4, 11, 14, -3, 3, c.helm);                 // helmet
  f.box(HIPS, -4, 4, 11, 12, -3, 3, c.dark);                 // rim
  f.box(HIPS, -1, 1, 12, 14, 2, 3, c.dark);                  // nose guard / crest
  f.box(HIPS, -1, 1, 14, 15, -2, 2, c.helm);                 // top knob
  f.pair(HIPS, 4, 5, 12, 13, -1, 1, c.horn);                 // horns: out, then up
  f.pair(HIPS, 5, 6, 12, 15, -1, 1, c.horn);
  f.box(HIPS, -4, 4, 9, 11, -3, -2, c.hair);                 // hair at the back
  for (let x = -3; x < 3; x++) for (let y = 3; y < 7; y++) {  // checked armour, front and back
    if ((x + y) & 1) { f.px(HIPS, x, y, 1, c.dark); f.px(HIPS, x, y, -2, c.dark); }
  }
  f.box(HIPS, -1, 1, 5, 7, 1, 2, c.white);                   // strap crossing the chest
  f.box(HIPS, -3, 3, 3, 4, -2, 2, c.dark);                   // belt
  f.pair(HIPS, 1, 4, 2, 3, -2, 2, c.helm);                   // tassets
  f.box(ARM_P, 3, 5, 6, 7, -1, 1, c.helm); f.box(ARM_N, -5, -3, 6, 7, -1, 1, c.helm);   // shoulder plates
  return { name: 'walker-gold', f };
}

// ---------------------------------------------------------------------------------------------------------------

const srgbToLinear = h => [1, 3, 5].map(i => {
  const c = parseInt(h.slice(i, i + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

const DIRS = [
  { n: [1, 0, 0], q: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], q: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], q: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { n: [0, -1, 0], q: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], q: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], q: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] }
];

function mesh(parts) {
  const pos = [], nor = [], col = [], jnt = [], idx = [];
  const lin = new Map();
  parts.forEach((vox, j) => {
    for (const [k, hex] of vox) {
      const [x, y, z] = k.split(',').map(Number);
      if (!lin.has(hex)) lin.set(hex, srgbToLinear(hex));
      const c = lin.get(hex);
      for (const d of DIRS) {
        if (vox.has((x + d.n[0]) + ',' + (y + d.n[1]) + ',' + (z + d.n[2]))) continue;
        const b = pos.length / 3;
        for (const q of d.q) {
          pos.push((x + q[0]) * V, (y + q[1]) * V, (z + q[2]) * V);
          nor.push(...d.n); col.push(...c); jnt.push(j, 0, 0, 0);
        }
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    }
  });
  return { pos, nor, col, jnt, idx };
}

const quatX = a => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];

// Lowest point of a leg's voxels (relative to its pivot) when it is swung by angle a.
function legLow(vox, pivot, a) {
  let low = Infinity;
  const ca = Math.cos(a), sa = Math.sin(a);
  for (const k of vox.keys()) {
    const [, y, z] = k.split(',').map(Number);
    for (const dy of [0, 1]) for (const dz of [0, 1]) {
      const ry = y + dy - pivot[1], rz = z + dz - pivot[2];
      low = Math.min(low, ry * ca - rz * sa);
    }
  }
  return low;
}

function animation(parts) {
  const times = [], hips = [], rot = [[], [], [], []];
  for (let i = 0; i <= KEYS; i++) {
    const t = CYCLE * i / KEYS, s = Math.sin(2 * Math.PI * i / KEYS);
    const legA = LEG_SWING * s, armA = ARM_SWING * s;
    const angles = [-armA, armA, legA, -legA];          // each arm swings against the leg on its side
    // lift the hips so the lower foot just touches y = 0, plus a little bob at the passing pose
    const lowP = PIVOTS[LEG_P][1] + legLow(parts[LEG_P], PIVOTS[LEG_P], angles[2]);
    const lowN = PIVOTS[LEG_N][1] + legLow(parts[LEG_N], PIVOTS[LEG_N], angles[3]);
    const lift = -Math.min(lowP, lowN) + BOB * (1 + Math.cos(4 * Math.PI * i / KEYS)) / 2 + 0.04;
    times.push(t);
    hips.push(0, (PIVOTS[HIPS][1] + lift) * V, 0);
    angles.forEach((a, j) => rot[j].push(...quatX(a)));
  }
  const stride = 4 * (PIVOTS[LEG_P][1]) * V * Math.sin(LEG_SWING);
  return { times, hips, rot, stride };
}

function glb({ name, f }) {
  const m = mesh(f.parts);
  const anim = animation(f.parts);
  let maxY = 0, maxR = 0;
  for (let i = 0; i < m.pos.length; i += 3) {
    maxY = Math.max(maxY, m.pos[i + 1]);
    maxR = Math.max(maxR, Math.hypot(m.pos[i], m.pos[i + 2]));
  }
  maxY += Math.max(...anim.hips.filter((_, i) => i % 3 === 1)) - PIVOTS[HIPS][1] * V;

  const chunks = [], views = [], accessors = [];
  let offset = 0;
  const add = (typed, target) => {
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (buf.length % 4)) % 4;
    chunks.push(buf, Buffer.alloc(pad));
    views.push(Object.assign({ buffer: 0, byteOffset: offset, byteLength: buf.length }, target ? { target } : {}));
    offset += buf.length + pad;
    return views.length - 1;
  };
  const acc = (typed, type, componentType, count, extra, target) => {
    accessors.push(Object.assign({ bufferView: add(typed, target), componentType, count, type }, extra || {}));
    return accessors.length - 1;
  };
  const F = 5126, UB = 5121, US = 5123;
  const nVerts = m.pos.length / 3;
  const P = new Float32Array(m.pos);
  const mn = [0, 1, 2].map(a => Math.min(...m.pos.filter((_, i) => i % 3 === a)));
  const mx = [0, 1, 2].map(a => Math.max(...m.pos.filter((_, i) => i % 3 === a)));
  const aPos = acc(P, 'VEC3', F, nVerts, { min: mn, max: mx }, 34962);
  const aNor = acc(new Float32Array(m.nor), 'VEC3', F, nVerts, null, 34962);
  const aCol = acc(new Float32Array(m.col), 'VEC3', F, nVerts, null, 34962);
  const aJnt = acc(new Uint8Array(m.jnt), 'VEC4', UB, nVerts, null, 34962);
  const W = new Float32Array(nVerts * 4); for (let i = 0; i < nVerts; i++) W[i * 4] = 1;
  const aWgt = acc(W, 'VEC4', F, nVerts, null, 34962);
  const aIdx = acc(new Uint16Array(m.idx), 'SCALAR', US, m.idx.length, null, 34963);

  // joint world positions at bind (hips at its pivot, children relative to it)
  const world = PIVOTS.map(p => p.map(v => v * V));
  const ibm = new Float32Array(16 * PIVOTS.length);
  world.forEach((w, j) => {
    const o = j * 16;
    ibm[o] = ibm[o + 5] = ibm[o + 10] = ibm[o + 15] = 1;
    ibm[o + 12] = -w[0]; ibm[o + 13] = -w[1]; ibm[o + 14] = -w[2];
  });
  const aIbm = acc(ibm, 'MAT4', F, PIVOTS.length);

  const aTime = acc(new Float32Array(anim.times), 'SCALAR', F, anim.times.length, { min: [0], max: [CYCLE] });
  const aHips = acc(new Float32Array(anim.hips), 'VEC3', F, anim.times.length);
  const aRot = anim.rot.map(r => acc(new Float32Array(r), 'VEC4', F, anim.times.length));

  // nodes: 0 root, 1 mesh, 2 hips, 3.. limbs
  const nodes = [
    { name, children: [1, 2], extras: { unit: '1 = one tree cube (info.cell)', height: +maxY.toFixed(4), radius: +maxR.toFixed(4), stride: +anim.stride.toFixed(4), cycle: CYCLE } },
    { name: name + '-mesh', mesh: 0, skin: 0 },
    { name: 'hips', translation: world[HIPS], children: [3, 4, 5, 6] }
  ];
  for (let j = 1; j < PIVOTS.length; j++) {
    nodes.push({ name: JOINT_NAMES[j], translation: world[j].map((v, a) => v - world[HIPS][a]) });
  }
  const gltf = {
    asset: { version: '2.0', generator: 'SakuraQR tools/make-walkers.mjs' },
    scene: 0, scenes: [{ name, nodes: [0] }], nodes,
    meshes: [{ name, primitives: [{ attributes: { POSITION: aPos, NORMAL: aNor, COLOR_0: aCol, JOINTS_0: aJnt, WEIGHTS_0: aWgt }, indices: aIdx, material: 0 }] }],
    materials: [{ name, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9 } }],
    skins: [{ joints: [2, 3, 4, 5, 6], inverseBindMatrices: aIbm, skeleton: 2 }],
    animations: [{
      name: 'walk',
      samplers: [{ input: aTime, output: aHips, interpolation: 'LINEAR' }, ...aRot.map(o => ({ input: aTime, output: o, interpolation: 'LINEAR' }))],
      channels: [{ sampler: 0, target: { node: 2, path: 'translation' } }, ...aRot.map((_, j) => ({ sampler: j + 1, target: { node: 3 + j, path: 'rotation' } }))]
    }],
    accessors, bufferViews: views, buffers: [{ byteLength: offset }]
  };
  let json = Buffer.from(JSON.stringify(gltf));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546C67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  const file = Buffer.concat([header, ch(json.length, 0x4E4F534A), json, ch(bin.length, 0x004E4942), bin]);
  fs.writeFileSync(path.join(OUT, name + '.glb'), file);
  console.log(name + '.glb', file.length, 'bytes,', m.idx.length / 3, 'triangles, height', maxY.toFixed(2), 'radius', maxR.toFixed(2), 'stride', anim.stride.toFixed(2));
}

fs.mkdirSync(OUT, { recursive: true });
for (const fig of [blue(), red(), gold()]) glb(fig);
