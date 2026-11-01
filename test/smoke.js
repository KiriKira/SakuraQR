// Smoke test, no dependencies: node test/smoke.js [outDir]
// Encodes a URL, grows the tree, exports 3MF + STL zip in both layouts (one piece; tree upside down + separate base),
// checks every part is a closed 2-manifold (every edge on exactly two faces, one fan round every vertex, also after
// welding vertices by position as STL readers do) and the peg fits the socket, checks how the 3MF is packed (model
// first, deflated), the flat code under the plate and the GLB for animation, and writes the top view and the bottom
// view as PPM images so a decoder can confirm they scan.
const fs = require('fs'), path = require('path');
const QR = require('../js/qr.js');
const { buildCanopyTree, shadowedTops, shadowedLight, perspectiveWarp, bottomCode } = require('../js/tree.js');
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
const pending = [];   // zips are built asynchronously (CompressionStream)
const save = (name, data) => pending.push(Promise.resolve(data).then(d => fs.writeFileSync(path.join(out, name), d)));
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
  save('sakura-' + tag + '.3mf', SakuraExport.to3MF(parts, 'SakuraQR ' + text));
  save('sakura-' + tag + '-stl.zip', SakuraExport.toSTLZip(parts, 'sakura'));
  if (!merge) pending.push(SakuraExport.to3MF(parts, 'SakuraQR ' + text).then(z => check3MF(z, SakuraExport.model3mf(parts, 'SakuraQR ' + text))));
}

// 3MF packing: the model is the first entry (a zip starting with [Content_Types].xml is "Microsoft OOXML" to libmagic,
// and print services reject it), every entry deflated, and each unpacks to what was put in with the right CRC
function check3MF(z, modelXml) {
  const zlib = require('zlib'), buf = Buffer.from(z), names = [];
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xFFFFFFFF; for (const x of b) c = crcTable[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  let p = 0, model = null;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8), c = buf.readUInt32LE(p + 14), csize = buf.readUInt32LE(p + 18), size = buf.readUInt32LE(p + 22), nlen = buf.readUInt16LE(p + 26), xlen = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 30, p + 30 + nlen), body = buf.subarray(p + 30 + nlen + xlen, p + 30 + nlen + xlen + csize);
    const data = method === 8 ? zlib.inflateRawSync(body) : body;
    if (method !== 8) fail('3MF entry ' + name + ' is not deflated');
    if (data.length !== size || crc(data) !== c) fail('3MF entry ' + name + ' does not unpack to its size and CRC');
    if (name === '3D/3dmodel.model') model = data.toString('utf8');
    names.push(name); p += 30 + nlen + xlen + csize;
  }
  console.log('3MF entries', names.join(', ') + ';', (buf.length / 1024).toFixed(0), 'KB packed,', (Buffer.byteLength(modelXml) / 1024).toFixed(0), 'KB model');
  if (names[0] !== '3D/3dmodel.model' || names.length !== 3) fail('3MF does not start with the model');
  if (model !== modelXml) fail('3MF model does not unpack to the model');
}

// split layout: tree upside down on the bed with a peg on the trunk, base next to it with a socket
// (also at 1.5 mm and the smallest cube size, 1 mm, where the clearance is a large share of the peg)
// (and with the trunk in the plate's bottom-right corner, the canopy hanging past the plate)
const plateTree = shift => buildCanopyTree(qr.matrix, { quiet: 3, crown: 1, squash: 0.7, trunk: 9, lobes: 4, puff: 0.85, rough: 1, maxLedge: 2, onCanopy: false, seed: 12345, shift, over: shift ? 11 : 0 });
const CORNER = 11;   // 21 x 21 code, 3-cell border: the trunk's outer edge one cell in from the plate's corner
for (const [onCanopy, s, shift] of [[true, 4, 0], [false, 4, 0], [false, 1.5, 0], [false, 1, 0], [false, 1.5, CORNER]]) {
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
  save('sakura-split-' + tag + '.3mf', SakuraExport.to3MF(parts, 'SakuraQR ' + text));
  save('sakura-split-' + tag + '-stl.zip', SakuraExport.toSTLZip(parts, 'sakura'));
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

// GLB for animation: a valid container, every accessor in range, faces wound the way their normals point, and all
// primitives together a closed surface (welded by position); with the perspective warp, and with the canopy past the plate
const withBottom = m => Object.assign({}, m, { under: bottomCode(m, qr.matrix) });
for (const [label, m, s, warp] of [['canopy, 4 mm', model, 4, null], ['plate, 1.5 mm, warped', plateTree(0), 1.5, true], ['corner, 1.5 mm, warped', plateTree(CORNER), 1.5, true], ['flat code under the plate, 1.5 mm, warped', withBottom(plateTree(0)), 1.5, true]]) {
  const glb = SakuraExport.toGLB(m, s, colours, null, { warp: warp ? perspectiveWarp(m, s, 800) : null, shade: cb => 1 + ((cb.c + cb.r + cb.k) % 3 - 1) * 0.08 });
  fs.writeFileSync(path.join(out, 'sakura-' + label.replace(/[^a-z0-9.]+/g, '-') + '.glb'), glb);
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (dv.getUint32(0, true) !== 0x46546C67 || dv.getUint32(4, true) !== 2 || dv.getUint32(8, true) !== glb.length) { fail('GLB header (' + label + ')'); continue; }
  const jsLen = dv.getUint32(12, true), json = JSON.parse(Buffer.from(glb.subarray(20, 20 + jsLen)).toString('utf8'));
  const binLen = dv.getUint32(20 + jsLen, true), bin = glb.subarray(28 + jsLen, 28 + jsLen + binLen);
  if (dv.getUint32(16, true) !== 0x4E4F534A || dv.getUint32(24 + jsLen, true) !== 0x004E4942 || jsLen % 4 || binLen < json.buffers[0].byteLength) fail('GLB chunks (' + label + ')');
  const read = i => {
    const a = json.accessors[i], v = json.bufferViews[a.bufferView], n = a.count * (a.type === 'VEC3' ? 3 : 1);
    if (v.byteOffset % 4 || v.byteOffset + v.byteLength > binLen) fail('bufferView out of range (' + label + ')');
    const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array }[a.componentType];
    return new T(bin.buffer.slice(bin.byteOffset + v.byteOffset, bin.byteOffset + v.byteOffset + n * T.BYTES_PER_ELEMENT));
  };
  const all = { verts: [], tris: [] }, box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  let misWound = 0;
  for (const mesh of json.meshes) for (const pr of mesh.primitives) {
    const P = read(pr.attributes.POSITION), Nn = read(pr.attributes.NORMAL), I = read(pr.indices), a = json.accessors[pr.attributes.POSITION];
    if (read(pr.attributes.COLOR_0).some(x => !(x >= 0 && x <= 1))) fail('COLOR_0 outside 0..1 (' + label + ')');
    for (let j = 0; j < 3; j++) for (let i = j; i < P.length; i += 3) { if (P[i] < a.min[j] || P[i] > a.max[j]) fail('POSITION outside min/max (' + label + ')'); box[j] = Math.min(box[j], P[i]); box[j + 3] = Math.max(box[j + 3], P[i]); }
    if (I.some(x => x >= P.length / 3)) fail('index out of range (' + label + ')');
    for (let t = 0; t < I.length; t += 3) {
      const [p, q, r] = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3], u = [0, 1, 2].map(j => P[q + j] - P[p + j]), v = [0, 1, 2].map(j => P[r + j] - P[p + j]);
      const c = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      if (c[0] * Nn[p] + c[1] * Nn[p + 1] + c[2] * Nn[p + 2] <= 0) misWound++;
    }
    const o = all.verts.length / 3;
    for (const x of P) all.verts.push(x * 1000);   // back to mm for audit's welding tolerance
    for (const x of I) all.tris.push(x + o);
  }
  const au = SakuraExport.audit(all), info = json.nodes[0].extras.sakuraqr;
  console.log('GLB, ' + label + ':', (glb.length / 1024).toFixed(0), 'KB,', json.meshes.map(x => x.name).join('/') + ',', au.triangles, 'triangles, open edges', au.open, ', mis-wound', misWound, '; bbox', box.map(x => (x * 1000).toFixed(1)).join(' '), 'mm');
  if (au.open || misWound) fail('GLB surface not closed or wound inwards (' + label + ')');
  // the plate's bottom on y = 0, centred (the perspective warp widens it by a fraction of a percent, as in the print)
  if (Math.abs(box[1] + (m.under ? s / 1000 : 0)) > 1e-7 || !!info.bottom !== !!m.under || Math.abs(box[0] / (-m.P * s / 2000) - 1) > 0.005 || info.plate.cells !== m.P || info.grid.surface.length !== m.N) fail('GLB placement or info (' + label + ')');
}

// the flat code under the plate: the code mirrored left to right, so that turned over it reads the right way round;
// in both layouts every part stays a closed 2-manifold, the base gets a closed bottom and the peg still fits the socket
{
  const m = withBottom(plateTree(0)), P = m.P;
  for (let r = 0; r < m.n; r++) for (let c = 0; c < m.n; c++) {
    const cb = m.under[(r + m.q) * P + (m.q + m.n - 1 - c)];
    if ((cb.color === 'dark') !== !!qr.matrix[r][c]) { fail('flat code under the plate is not the mirrored code'); r = m.n; break; }
  }
  if (m.under.length !== P * P || m.under.some(cb => (cb.c < m.q || cb.r < m.q || cb.c >= m.q + m.n || cb.r >= m.q + m.n) && cb.color !== 'light')) fail('flat code: plate not covered or quiet zone not light');
  for (const layout of ['one-piece', 'split']) {
    const parts = SakuraExport.buildParts(m, 1.5, colours, null, { layout, warp: perspectiveWarp(m, 1.5, 800) });
    const bad = parts.filter(p => { const a = SakuraExport.audit(p); return a.open || a.nonManifold || a.badVerts; });
    const zmin = Math.min(...parts.flatMap(p => p.verts.filter((_, i) => i % 3 === 2)));
    console.log('flat code under the plate, ' + layout + ':', parts.map(p => p.object + '/' + p.key).join(' '), bad.length ? 'NOT closed: ' + bad.map(p => p.key) : 'all closed', ', lowest z', zmin.toFixed(3));
    if (bad.length) fail('flat code: ' + layout + ' parts not closed');
    if (Math.abs(zmin) > 1e-9) fail('flat code: ' + layout + ' not on the bed');
  }
  // seen from below, as PPM (turned over left to right: column c shows at P - 1 - c)
  const px = 12, W = (P + 4) * px, img = Buffer.alloc(W * W * 3, 255), rgb = { dark: [217, 82, 127], light: [250, 214, 226] };
  for (const cb of m.under) for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) img.set(rgb[cb.color], (((cb.r + 2) * px + y) * W + (P - 1 - cb.c + 2) * px + x) * 3);
  fs.writeFileSync(path.join(out, 'bottomview.ppm'), Buffer.concat([Buffer.from(`P6 ${W} ${W} 255\n`), img]));
}

// top view (one pixel block per module) as PPM
const hex = { dark: [217, 82, 127], light: [250, 214, 226], wood: [110, 74, 52] };
const N = model.N, px = 12, W = N * px, img = Buffer.alloc(W * W * 3);
const top = new Array(N * N).fill(null);
for (const cb of model.cubes) { const i = cb.r * N + cb.c; if (!top[i] || cb.k >= top[i].k) top[i] = cb; }
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const c = hex[top[Math.floor(y / px) * N + Math.floor(x / px)].color]; img.set(c, (y * W + x) * 3); }
fs.writeFileSync(path.join(out, 'topview.ppm'), Buffer.concat([Buffer.from(`P6 ${W} ${W} 255\n`), img]));

Promise.all(pending).then(() => {
  console.log('size', (N * s) + ' x ' + (N * s) + ' x ' + ((model.kTopMax + 1) * s) + ' mm; files in ' + out);
  if (failed) process.exit(1);
}, e => { console.error('FAIL: ' + e.stack); process.exit(1); });
