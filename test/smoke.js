// Smoke test, no dependencies: node test/smoke.js [outDir]
// Encodes a URL, grows the tree, exports 3MF + STL zip, checks every part is a closed shell,
// and writes the top view as a PPM image so a decoder can confirm it scans.
const fs = require('fs'), path = require('path');
const QR = require('../js/qr.js');
const { buildCanopyTree } = require('../js/tree.js');
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
for (const [label, merge] of [['3 colours', null], ['2 colours', { wood: 'light' }]]) {
  const parts = SakuraExport.buildParts(model, s, colours, merge);
  console.log(label + ':');
  for (const p of parts) {
    const a = SakuraExport.audit(p);
    console.log('  ' + p.key.padEnd(6), String(a.triangles).padStart(6), 'triangles, open edges', a.open, ', edges shared by >2 faces', a.nonManifold);
    if (a.open) failed = true;
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
if (failed) { console.error('FAIL: open edges in an exported shell'); process.exit(1); }
