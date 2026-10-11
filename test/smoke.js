// Smoke test, no dependencies: node test/smoke.js [outDir]
// Encodes a URL, grows the tree, checks it prints upside down without supports, exports 3MF + STL zip, checks every
// part is a closed shell and the peg fits the socket, and writes the top view as a PPM image so a decoder can confirm
// it scans.
const fs = require('fs'), path = require('path');
const QR = require('../js/qr.js');
const { buildCanopyTree, strSeed } = require('../js/tree.js');
const SakuraExport = require('../js/export.js');

const out = process.argv[2] || path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });

const OPTS = { quiet: 5, crown: 1.45, squash: 0.7, trunk: 9, lobes: 4, puff: 0.85, rough: 1 };
const text = 'HTTPS://MUQUE.JP';
const qr = QR.encode(text, { ecc: 'Q', mask: 1 });
const model = buildCanopyTree(qr.matrix, Object.assign({}, OPTS, { seed: 12345 }));
const s = 4;
const colours = { dark: { name: 'blossom', hex: '#D9527F' }, light: { name: 'highlight', hex: '#FAD6E2' }, wood: { name: 'trunk', hex: '#6E4A34' } };
let failed = false;
const fail = msg => { console.error('FAIL: ' + msg); failed = true; };

// Upside down on the bed (level 0 = the code face), every cell must be held from below:
//  - everything is face-connected to the bed (a face counts when both cells cover part of it)
//  - every cube stands on a cube or a chamfer wedge
//  - every wedge leans on a whole cube
function printability(m) {
  const { g, pieces, P } = SakuraExport.printGrid(m, null), N = m.N, I = (c, r, p) => (p * N + r) * N + c;
  const has = (c, r, p) => c >= 0 && r >= 0 && p >= 0 && c < N && r < N && p < P && g[I(c, r, p)] !== 0;
  const cube = (c, r, p) => has(c, r, p) && !pieces.has(I(c, r, p));
  const cov = (c, r, p, axis, sign) => has(c, r, p) ? SakuraExport.coverage(pieces.get(I(c, r, p)), axis, sign) : 0;
  const res = { floating: 0, overhangs: 0, badWedges: 0, onBed: 0 };
  const seen = new Set(), stack = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (has(c, r, 0)) { seen.add(I(c, r, 0)); stack.push([c, r, 0]); res.onBed++; }
  while (stack.length) {
    const p = stack.pop();
    for (let axis = 0; axis < 3; axis++) for (const sign of [1, -1]) {
      const q = p.slice(); q[axis] += sign;
      if (has(...q) && !seen.has(I(...q)) && (cov(...p, axis, sign) & cov(...q, axis, -sign))) { seen.add(I(...q)); stack.push(q); }
    }
  }
  for (let p = 0; p < P; p++) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (!has(c, r, p)) continue;
    if (!seen.has(I(c, r, p))) res.floating++;
    const w = pieces.get(I(c, r, p));
    if (w) { if (!cube(c + w.lean[0][0], r + w.lean[0][1], p)) res.badWedges++; }
    else if (p > 0 && !has(c, r, p - 1)) res.overhangs++;
  }
  return res;
}
function checkTree(label, m) {
  const p = printability(m);
  console.log(label.padEnd(28), m.cubes.length + ' cubes, ' + m.chamfers.length + ' chamfers, ' + p.onBed + ' cubes on the bed,',
    'code on the face ' + m.onCanopy + '/' + m.n * m.n + ', ' + (m.F + 1) * s + ' mm tall');
  if (p.floating) fail(label + ': ' + p.floating + ' cells not connected to the bed');
  if (p.overhangs) fail(label + ': ' + p.overhangs + ' cubes with nothing under them (need supports)');
  if (p.badWedges) fail(label + ': ' + p.badWedges + ' chamfers not leaning on a cube');
  if (m.onCanopy !== m.n * m.n) fail(label + ': ' + (m.n * m.n - m.onCanopy) + ' code cells are not on the face');
}
checkTree(text, model);
// a few more codes and tree shapes
for (const [t, extra] of [['HTTPS://EXAMPLE.COM/ABC', { seed: 7 }], ['https://github.com/KiriKira/SakuraQR', { seed: 3, trunk: 5, lobes: 6 }],
  ['HTTPS://A.CO', { seed: 11, crown: 1.7, squash: 1, rough: 1.6 }]]) {
  checkTree(t.slice(0, 28), buildCanopyTree(QR.encode(t, { ecc: 'Q' })[0].matrix, Object.assign({}, OPTS, extra, { seed: strSeed(t) + extra.seed })));
}

for (const [label, merge] of [['3 colours', null], ['2 colours', { wood: 'light' }]]) {
  const parts = SakuraExport.buildParts(model, s, colours, merge);
  console.log(label + ':');
  for (const p of parts) {
    const a = SakuraExport.audit(p);
    console.log('  ' + p.key.padEnd(6), String(a.triangles).padStart(6), 'triangles, open edges', a.open, ', edges shared by >2 faces', a.nonManifold);
    if (a.open) fail('open edges in the ' + p.key + ' shell');
  }
  const tag = merge ? '2c' : '3c';
  fs.writeFileSync(path.join(out, 'sakura-' + tag + '.3mf'), SakuraExport.to3MF(parts, 'SakuraQR ' + text));
  fs.writeFileSync(path.join(out, 'sakura-' + tag + '-stl.zip'), SakuraExport.toSTLZip(parts, 'sakura'));
}

// the peg (top of the printed tree) must fit the socket with the clearance on every side and not reach its bottom
{
  const parts = SakuraExport.buildParts(model, s, colours, null), bbox = (p, f) => {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.verts.length; i += 3) if (f(p.verts[i], p.verts[i + 1], p.verts[i + 2])) for (let j = 0; j < 3; j++) { b[j] = Math.min(b[j], p.verts[i + j]); b[j + 3] = Math.max(b[j + 3], p.verts[i + j]); }
    return b;
  };
  const wood = parts.find(p => p.key === 'wood'), base = parts.find(p => p.key === 'base'), top = model.F * s;
  const peg = bbox(wood, (x, y, z) => z > top + 0.01), baseBox = bbox(base, () => true);
  const pegW = peg[3] - peg[0], pegD = peg[4] - peg[1], pegL = peg[5] - top;
  // the socket's walls are the base vertices strictly inside its outline
  const hole = bbox(base, (x, y) => x > baseBox[0] + 0.01 && x < baseBox[3] - 0.01 && y > baseBox[1] + 0.01 && y < baseBox[4] - 0.01);
  const holeW = hole[3] - hole[0], holeD = hole[4] - hole[1], depth = baseBox[5] - baseBox[2];
  console.log('peg ' + pegW.toFixed(2) + ' x ' + pegD.toFixed(2) + ' x ' + pegL.toFixed(2) + ' mm, socket ' + holeW.toFixed(2) + ' x ' + holeD.toFixed(2) + ' x ' + depth.toFixed(2) + ' mm');
  if (Math.abs(holeW - pegW - 0.4) > 1e-6 || Math.abs(holeD - pegD - 0.4) > 1e-6) fail('socket is not 0.2 mm wider than the peg on every side');
  if (!(pegL < depth)) fail('peg is longer than the socket is deep');
}

// top view (one pixel block per module) as PPM
const hex = { dark: [217, 82, 127], light: [250, 214, 226], wood: [110, 74, 52] };
const N = model.N, px = 12, W = N * px, img = Buffer.alloc(W * W * 3);
const top = new Array(N * N).fill(null);
for (const cb of model.cubes) { const i = cb.r * N + cb.c; if (!top[i] || cb.k >= top[i].k) top[i] = cb; }
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const c = hex[top[Math.floor(y / px) * N + Math.floor(x / px)].color]; img.set(c, (y * W + x) * 3); }
fs.writeFileSync(path.join(out, 'topview.ppm'), Buffer.concat([Buffer.from(`P6 ${W} ${W} 255\n`), img]));

console.log('tree ' + (N * s) + ' x ' + (N * s) + ' x ' + ((model.F + 1) * s) + ' mm, printed upside down; base ' + (N * s) + ' x ' + (N * s) + ' x 8 mm; files in ' + out);
if (failed) process.exit(1);
