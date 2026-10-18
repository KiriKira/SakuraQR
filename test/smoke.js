// Smoke test, no dependencies: node test/smoke.js [outDir]
// Encodes a URL, grows the tree, exports 3MF + STL zip in both layouts (one piece; tree upside down + separate base),
// checks every part is a closed 2-manifold (every edge on exactly two faces, one fan round every vertex, also after
// welding vertices by position as STL readers do) and the peg fits the socket, and writes the top view as a PPM image so a
// decoder can confirm it scans.
const fs = require('fs'), path = require('path');
const QR = require('../js/qr.js');
const { buildCanopyTree, shadowedTops, shadowedLight } = require('../js/tree.js');
const SakuraExport = require('../js/export.js');

const out = process.argv[2] || path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });

const text = 'HTTPS://MUQUE.JP';
const qr = QR.encode(text, { ecc: 'Q', mask: 1 });
const model = buildCanopyTree(qr.matrix, {
  quiet: 5, crown: 1.45, squash: 0.7, trunk: 9, lobes: 4, puff: 0.85, rough: 1,
  maxLedge: 2, onCanopy: true, dome: 6, capDepth: 4, seed: 12345
});
const s = 4;
const colours = { dark: { name: 'blossom', hex: '#D9527F' }, light: { name: 'highlight', hex: '#FAD6E2' }, wood: { name: 'trunk', hex: '#6E4A34' } };

let failed = false;
const fail = msg => { console.error('FAIL: ' + msg); failed = true; };
for (const [label, merge] of [['3 colours', null], ['2 colours', { wood: 'light' }]]) {
  const parts = SakuraExport.buildParts(model, s, colours, merge);
  console.log(label + ':');
  for (const p of parts) {
    const a = SakuraExport.audit(p);
    console.log('  ' + p.key.padEnd(6), String(a.triangles).padStart(6), 'triangles, open edges', a.open, ', edges shared by >2 faces', a.nonManifold, ', vertices not on one fan', a.badVerts);
    if (a.open || a.nonManifold || a.badVerts) fail('the ' + p.key + ' shell is not a closed 2-manifold');
  }
  const tag = merge ? '2c' : '3c';
  fs.writeFileSync(path.join(out, 'sakura-' + tag + '.3mf'), SakuraExport.to3MF(parts, 'SakuraQR ' + text));
  fs.writeFileSync(path.join(out, 'sakura-' + tag + '-stl.zip'), SakuraExport.toSTLZip(parts, 'sakura'));
}

// split layout: tree upside down on the bed with a peg on the trunk, base next to it with a socket
// (also at the smallest cube size, 1.5 mm, where the clearance is a large share of the peg)
// (and with the trunk in the plate's bottom-right corner, the canopy hanging past the plate)
const plateTree = shift => buildCanopyTree(qr.matrix, { quiet: 3, crown: 1, squash: 0.7, trunk: 9, lobes: 4, puff: 0.85, rough: 1, maxLedge: 2, onCanopy: false, seed: 12345, shift, over: shift ? 11 : 0 });
const CORNER = 11;   // 21 x 21 code, 3-cell border: the trunk's outer edge one cell in from the plate's corner
for (const [onCanopy, s, shift] of [[true, 4, 0], [false, 4, 0], [false, 1.5, 0], [false, 1.5, CORNER]]) {
  const m = onCanopy ? model : plateTree(shift);
  const parts = SakuraExport.buildParts(m, s, colours, null, { layout: 'split', clear: 0.2 });
  console.log('split, ' + s + ' mm cubes, code ' + (onCanopy ? 'on the canopy' : 'on canopy and base') + (shift ? ', tree shifted ' + shift : '') + ':');
  for (const p of parts) {
    const a = SakuraExport.audit(p);
    console.log('  ' + (p.object + '/' + p.key).padEnd(11), String(a.triangles).padStart(6), 'triangles, open edges', a.open, ', edges shared by >2 faces', a.nonManifold, ', vertices not on one fan', a.badVerts);
    if (a.open || a.nonManifold || a.badVerts) fail('the split ' + p.object + ' ' + p.key + ' shell is not a closed 2-manifold');
  }
  const bbox = ps => { const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (const p of ps) for (let i = 0; i < p.verts.length; i += 3) for (let j = 0; j < 3; j++) { b[j] = Math.min(b[j], p.verts[i + j]); b[j + 3] = Math.max(b[j + 3], p.verts[i + j]); } return b; };
  const tree = bbox(parts.filter(p => p.object === 'tree' && p.key !== 'peg')), peg = bbox(parts.filter(p => p.key === 'peg')), base = bbox(parts.filter(p => p.object === 'base'));
  if (Math.abs(tree[2]) > 1e-9 || Math.abs(base[2]) > 1e-9) fail('split pieces do not sit on the bed');
  if (base[0] <= tree[3]) fail('base overlaps the tree on the bed');
  if (!(peg[2] <= tree[5] && peg[2] > tree[5] - 0.05)) fail('peg does not start at the trunk end');   // it reaches a little into the trunk (cubes are grown 0.01 mm)
  // socket: trunk footprint in the base (its cells are empty in the base's plate); the peg is 0.2 mm thinner per side
  const plate = m.cubes.filter(c => c.k === 0).length, baseCells = new Set(m.trunkCells.map(([c, r]) => c + ',' + r));
  const pegW = peg[3] - peg[0], pegD = peg[4] - peg[1], pegL = peg[5] - peg[2];
  console.log('  peg ' + pegW.toFixed(2) + ' x ' + pegD.toFixed(2) + ' x ' + pegL.toFixed(2) + ' mm into a ' + (2 * s) + ' x ' + (2 * s) + ' x ' + (2 * s) + ' mm socket; base ' + (base[3] - base[0]) + ' x ' + (base[4] - base[1]) + ' x ' + (base[5] - base[2]) + ' mm');
  if (Math.abs(2 * s - pegW - 0.4) > 1e-6 || Math.abs(2 * s - pegD - 0.4) > 1e-6 || !(pegL < 2 * s)) fail('peg does not fit the socket');
  if (plate !== m.P * m.P || baseCells.size !== 4) fail('unexpected plate or trunk');
  const tag = (onCanopy ? 'canopy' : 'plate') + (shift ? '-corner' : '') + '-' + s + 'mm';
  fs.writeFileSync(path.join(out, 'sakura-split-' + tag + '.3mf'), SakuraExport.to3MF(parts, 'SakuraQR ' + text));
  fs.writeFileSync(path.join(out, 'sakura-split-' + tag + '-stl.zip'), SakuraExport.toSTLZip(parts, 'sakura'));
}

// a lamp off the code's top-left corner, 60° up: with the trunk in the bottom-right corner the canopy's shadow falls
// past the code (light modules in shadow read as dark)
{
  const A = plateTree(0), B = plateTree(CORNER), P = A.P;
  if (B.P !== P || B.cubes.filter(c => c.k === 0).length !== P * P) fail('corner tree: plate changed size');
  if (!B.cubes.some(c => c.k > 0 && (c.c >= P || c.r >= P))) fail('corner tree: canopy does not reach past the plate');
  if (B.cubes.some(c => c.k > 0 && (c.c === B.N - 1 || c.r === B.N - 1) && B.N === P + 11)) fail('corner tree: canopy cut off at the grid edge');
  if (B.cubes.some(c => c.k === 1 && c.kind === 'wood' && (c.c >= P || c.r >= P))) fail('corner tree: roots off the plate');
  const com = [0, 1].map(j => B.cubes.reduce((a, c) => a + (j ? c.r : c.c) + 0.5, 0) / B.cubes.length);
  const a = shadowedLight(A, shadowedTops(A, 225, 60), qr.matrix), b = shadowedLight(B, shadowedTops(B, 225, 60), qr.matrix);
  console.log('light modules in a top-left lamp\'s shadow: centred tree', a, ', corner tree', b, '; corner tree\'s centre of mass', com.map(v => (P - v).toFixed(1)).join(' / '), 'cells inside the plate edge');
  if (!(b * 3 < a)) fail('the corner tree does not move the shadow off the code');
  if (Math.max(...com) > P - 3) fail('corner tree tips over');
}

// top view (one pixel block per module) as PPM
const hex = { dark: [217, 82, 127], light: [250, 214, 226], wood: [110, 74, 52] };
const N = model.N, px = 12, W = N * px, img = Buffer.alloc(W * W * 3);
const top = new Array(N * N).fill(null);
for (const cb of model.cubes) { const i = cb.r * N + cb.c; if (!top[i] || cb.k >= top[i].k) top[i] = cb; }
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const c = hex[top[Math.floor(y / px) * N + Math.floor(x / px)].color]; img.set(c, (y * W + x) * 3); }
fs.writeFileSync(path.join(out, 'topview.ppm'), Buffer.concat([Buffer.from(`P6 ${W} ${W} 255\n`), img]));

console.log('size', (N * s) + ' x ' + (N * s) + ' x ' + ((model.kTopMax + 1) * s) + ' mm; files in ' + out);
if (failed) process.exit(1);
