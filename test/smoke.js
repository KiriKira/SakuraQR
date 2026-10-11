// Smoke test, no dependencies: node test/smoke.js [outDir]
// Encodes a URL, grows the tree, checks it prints without supports, exports 3MF + STL zip, checks every part is a
// closed shell, and writes the top view as a PPM image so a decoder can confirm it scans.
const fs = require('fs'), path = require('path');
const QR = require('../js/qr.js');
const { buildCanopyTree, strSeed } = require('../js/tree.js');
const SakuraExport = require('../js/export.js');

const out = process.argv[2] || path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });

const OPTS = { quiet: 5, crown: 1.45, squash: 0.7, trunk: 9, lobes: 4, puff: 0.85, rough: 1, maxLedge: 1, onCanopy: true, dome: 6, capDepth: 4 };
const text = 'HTTPS://MUQUE.JP';
const qr = QR.encode(text, { ecc: 'Q', mask: 1 });
const model = buildCanopyTree(qr.matrix, Object.assign({}, OPTS, { seed: 12345 }));
const s = 4;
const colours = { dark: { name: 'blossom', hex: '#D9527F' }, light: { name: 'highlight', hex: '#FAD6E2' }, wood: { name: 'trunk', hex: '#6E4A34' } };
let failed = false;
const fail = msg => { console.error('FAIL: ' + msg); failed = true; };

// Support-free printing, checked on the cells themselves (cubes and chamfer pieces):
//  - everything is face-connected to the plate (a face counts when both sides cover part of it)
//  - every cube stands on a cube or a chamfer piece, or bridges one cube between two cubes in its own layer
//  - every chamfer piece is held by what it leans on: a wedge by whole cubes, a corner piece by the wedges beside it
function printability(m) {
  const { N, KMAX } = m, I = (c, r, k) => (k * N + r) * N + c, cell = new Map();
  for (const cb of m.cubes) cell.set(I(cb.c, cb.r, cb.k), null);
  for (const p of m.chamfers) cell.set(I(p.c, p.r, p.k), p);
  const has = (c, r, k) => c >= 0 && r >= 0 && k >= 0 && c < N && r < N && k <= KMAX && cell.has(I(c, r, k));
  const cube = (c, r, k) => has(c, r, k) && cell.get(I(c, r, k)) === null;
  const cov = (c, r, k, axis, sign) => has(c, r, k) ? SakuraExport.coverage(cell.get(I(c, r, k)), axis, sign) : 0;
  const seen = new Set(), stack = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { seen.add(I(c, r, 0)); stack.push([c, r, 0]); }
  while (stack.length) {
    const p = stack.pop();
    for (let axis = 0; axis < 3; axis++) for (const sign of [1, -1]) {
      const q = p.slice(); q[axis] += sign;
      if (has(...q) && !seen.has(I(...q)) && (cov(...p, axis, sign) & cov(...q, axis, -sign))) { seen.add(I(...q)); stack.push(q); }
    }
  }
  const r = { floating: 0, ledges: 0, bridges: 0, badPieces: 0 };
  for (const i of cell.keys()) if (!seen.has(i)) r.floating++;
  for (const { c, r: rr, k } of m.cubes) if (k > 0 && !has(c, rr, k - 1)) {
    if ((cube(c - 1, rr, k) && cube(c + 1, rr, k)) || (cube(c, rr - 1, k) && cube(c, rr + 1, k))) r.bridges++; else r.ledges++;
  }
  for (const p of m.chamfers) {
    if (p.shape === 'wedge') { for (const [dc, dr] of p.lean) if (!cube(p.c + dc, p.r + dr, p.k)) r.badPieces++; continue; }
    const [dx, dy] = p.lean[0];
    for (const [axis, sign, c2, r2] of [[0, dx, p.c + dx, p.r], [1, dy, p.c, p.r + dy]]) {
      const mine = SakuraExport.coverage(p, axis, sign);
      if ((mine & cov(c2, r2, p.k, axis, -sign)) !== mine) r.badPieces++;
    }
  }
  return r;
}
function checkTree(label, m) {
  const p = printability(m);
  console.log(label.padEnd(28), m.cubes.length + ' cubes, ' + m.chamfers.length + ' chamfers, ' + p.bridges + ' one-cube bridges,',
    'code on canopy ' + m.onCanopy + '/' + m.n * m.n + ', ' + (m.kTopMax + 1) * s + ' mm tall');
  if (p.floating) fail(label + ': ' + p.floating + ' cells not connected to the plate');
  if (p.ledges) fail(label + ': ' + p.ledges + ' flat overhangs (need supports)');
  if (p.badPieces) fail(label + ': ' + p.badPieces + ' chamfers not held by their neighbours');
  if (m.onCanopy !== m.n * m.n) fail(label + ': ' + (m.n * m.n - m.onCanopy) + ' code cells fell off the canopy');
}
checkTree(text, model);
// a few more codes and tree shapes
for (const [t, extra] of [['HTTPS://EXAMPLE.COM/ABC', { seed: 7 }], ['https://github.com/KiriKira/SakuraQR', { seed: 3, trunk: 5, lobes: 6 }],
  ['HTTPS://A.CO', { seed: 11, crown: 1.7, squash: 1, rough: 1.6, dome: 0 }]]) {
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

// top view (one pixel block per module) as PPM
const hex = { dark: [217, 82, 127], light: [250, 214, 226], wood: [110, 74, 52] };
const N = model.N, px = 12, W = N * px, img = Buffer.alloc(W * W * 3);
const top = new Array(N * N).fill(null);
for (const cb of model.cubes) { const i = cb.r * N + cb.c; if (!top[i] || cb.k >= top[i].k) top[i] = cb; }
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const c = hex[top[Math.floor(y / px) * N + Math.floor(x / px)].color]; img.set(c, (y * W + x) * 3); }
fs.writeFileSync(path.join(out, 'topview.ppm'), Buffer.concat([Buffer.from(`P6 ${W} ${W} 255\n`), img]));

console.log('size', (N * s) + ' x ' + (N * s) + ' x ' + ((model.kTopMax + 1) * s) + ' mm; files in ' + out);
if (failed) process.exit(1);
