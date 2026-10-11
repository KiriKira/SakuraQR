// ===== Sakura QR tree — design the tree first, then paint the top pixel of every column =====
// Grid: column (c, r) = one QR module (plus a white border); level k = one cube. k = 0 is the plate.
// Cube colours: 'dark' (deep pink: blossom body + dark QR pixels), 'light' (pale pink: light QR pixels + plate), 'wood'.
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function strSeed(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function hash3(a, b, c, seed) { let h = (a * 374761393 + b * 668265263 + c * 1274126177 + seed * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function noise3(x, y, z, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), fx = x - x0, fy = y - y0, fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  const v = (i, j, k) => hash3(x0 + i, y0 + j, z0 + k, seed);
  return L(L(L(v(0, 0, 0), v(1, 0, 0), sx), L(v(0, 1, 0), v(1, 1, 0), sx), sy), L(L(v(0, 0, 1), v(1, 0, 1), sx), L(v(0, 1, 1), v(1, 1, 1), sx), sy), sz);
}

/*
 The tree is printed upside down: the flat top face that carries the code lies on the print bed, the canopy hangs
 from it and the trunk ends in a square peg that plugs into a separately printed base. Seen that way up, every cube
 rests on the cube above it (in the tree's own orientation), except the inner step of each limb, which gets a 45°
 chamfer (`chamfers`). Nothing needs supports.

 o = { quiet, crown: canopy radius / half code width, squash: canopy thickness / canopy radius,
       trunk: bare trunk height (cubes), lobes: number of outer clouds and limbs, puff: how round the clouds' rims are,
       rough: 0..1 surface lumpiness, seed }
*/
function buildCanopyTree(mat, o) {
  const n = mat.length, q = o.quiet, N = n + 2 * q, ctr = (N - 1) / 2;
  const rng = mulberry32(o.seed || 1), seed = o.seed || 1;
  const R = o.crown * n / 2, A = R * o.squash;
  const kT = o.trunk;  // kT: where the trunk forks
  const KMAX = Math.ceil(kT + R * 2.2 + A) + 4;
  const idx = (c, r, k) => (k * N + r) * N + c;
  const M = { EMPTY: 0, LEAF: 1, WOOD: 2 };
  const vox = new Uint8Array(N * N * (KMAX + 2));
  const inGrid = (c, r) => c >= 0 && r >= 0 && c < N && r < N;
  const inCode = (c, r) => c >= q && r >= q && c < q + n && r < q + n;
  const dark = (c, r) => inCode(c, r) && !!mat[r - q][c - q];

  // ---- 1. layout: short 2x2 trunk with a few roots; clouds of blossom over the code's corners, an inner tier
  //      between them and a crown cloud in the middle ----
  const tc = Math.round(ctr), tr = Math.round(ctr);
  const trunkCells = [[tc, tr], [tc + 1, tr], [tc, tr + 1], [tc + 1, tr + 1]];
  for (const [c, r] of trunkCells) for (let k = 1; k <= kT; k++) vox[idx(c, r, k)] = M.WOOD;
  for (const [c, r] of trunkCells) for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const c2 = c + dc, r2 = r + dr;
    if (inGrid(c2, r2) && !vox[idx(c2, r2, 1)] && rng() < 0.4) vox[idx(c2, r2, 1)] = M.WOOD;
  }
  const nl = o.lobes, rot = Math.PI / 4 + (rng() - 0.5) * 0.3;
  const clumps = [];
  for (let i = 0; i < nl; i++) {   // the outer clouds, each with a limb of its own
    const th = rot + i * 2 * Math.PI / nl + (rng() - 0.5) * 0.5, d = R * (0.5 + rng() * 0.18);
    clumps.push({ x: Math.round(ctr + d * Math.cos(th)), y: Math.round(ctr + d * Math.sin(th)), rx: R * (0.36 + rng() * 0.1), th, limb: true });
  }
  for (const lo of clumps.slice()) {
    const th = lo.th + Math.PI / nl, d = R * (0.28 + rng() * 0.1);
    clumps.push({ x: Math.round(ctr + d * Math.cos(th)), y: Math.round(ctr + d * Math.sin(th)), rx: R * (0.3 + rng() * 0.06) });
  }
  clumps.push({ x: tc + 0.5, y: tr + 0.5, rx: R * (0.38 + rng() * 0.05) });

  // ---- 2. blossom: every cloud hangs from one flat top face (level F) that carries the code. An outer cloud's
  //      underside is flat at the level where its 45° limb from the fork arrives, a little in from the cloud's near
  //      edge; the inner clouds hang a level lower, around the leader. Toward the rim each cloud rounds off (more
  //      so with more puff), with fluffy edges. The face sits a canopy's thickness (squash) above the highest underside.
  const fork = b => [tc + (b.x > tc + 0.5 ? 1 : 0), tr + (b.y > tr + 0.5 ? 1 : 0)];
  for (const b of clumps) if (b.limb) {
    const [c0, r0] = fork(b), dx = b.x - c0, dy = b.y - r0, d = Math.hypot(dx, dy), t = Math.max(0, d - 0.55 * b.rx) / (d || 1);
    b.bottom = kT + Math.round(Math.abs(dx * t) + Math.abs(dy * t)) + 1;
  }
  const low = clumps.filter(b => b.limb), lowest = Math.min(...low.map(b => b.bottom)), highest = Math.max(...low.map(b => b.bottom));
  for (const b of clumps) if (!b.limb) b.bottom = lowest - 1;
  const F = Math.min(KMAX - 1, Math.round(highest + A * 0.8)), round = 0.4 * o.puff;
  for (let k = 1; k <= F; k++) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (vox[idx(c, r, k)]) continue;
    const nz = (noise3(c * 0.45, r * 0.45, k * 0.45, seed) - 0.5) * 0.5 + (noise3(c * 1.2, r * 1.2, k * 1.2, seed + 9) - 0.5) * 0.3;
    for (const b of clumps) {
      const rho2 = ((c - b.x) ** 2 + (r - b.y) ** 2) / (b.rx * b.rx), depth = F - b.bottom;
      // inside while the depth below the face is less than depth · (1 − ρ²)^round
      if (rho2 < 1 && depth > 0 && (F - k) / depth - Math.pow(1 - rho2, round) + nz * o.rough * 0.4 < 0) { vox[idx(c, r, k)] = M.LEAF; break; }
    }
  }
  // the code and a one-module ring around it always sit on the face, at least two cubes thick
  for (let r = q - 1; r <= q + n; r++) for (let c = q - 1; c <= q + n; c++) if (inGrid(c, r))
    for (let k = F - 1; k <= F; k++) if (!vox[idx(c, r, k)]) vox[idx(c, r, k)] = M.LEAF;
  // a leader carries on up from the fork through the canopy to the face
  for (let k = kT + 1; k <= F; k++) vox[idx(tc, tr, k)] = M.WOOD;

  // ---- 3. limbs: from the fork, climb outward toward each outer cloud as a staircase, one cube sideways per level
  //      and two cubes thick, until they are inside the canopy ----
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let limbCubes = 0;
  const putWood = (c, r, k) => { if (inGrid(c, r) && k >= 1 && k <= F && vox[idx(c, r, k)] !== M.WOOD) { vox[idx(c, r, k)] = M.WOOD; limbCubes++; } };
  const leafy = (c, r, k) => k > F || vox[idx(c, r, k)] === M.LEAF;
  for (const b of clumps) {
    if (!b.limb) continue;
    let [c, r] = fork(b), k = kT;
    const tx = Math.round(b.x), ty = Math.round(b.y);
    for (let steps = 0; steps < 60 && !leafy(c, r, k + 1); steps++) {
      if (c !== tx || r !== ty) {
        if (Math.abs(tx - c) >= Math.abs(ty - r)) c += Math.sign(tx - c); else r += Math.sign(ty - r);
        putWood(c, r, k); putWood(c, r, k - 1);
      }
      putWood(c, r, ++k);
    }
    putWood(c, r, k + 1);   // one cube into the canopy
  }
  for (let i = idx(0, 0, F + 1); i < vox.length; i++) vox[i] = 0;

  // ---- 4. printability, upside down: a canopy column must hang unbroken from the face, so blossom below its first
  //      gap is dropped; every other cube with nothing above it (inner limb steps, roots) gets a 45° chamfer in the
  //      empty cell above it, leaning on a solid neighbour there (a one-cube gap is filled solid instead) ----
  const solid = (c, r, k) => inGrid(c, r) && k >= 1 && k <= F && vox[idx(c, r, k)] !== 0;
  let trimmed = 0, ledges = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    let g = F; while (g >= 1 && vox[idx(c, r, g)]) g--;
    for (let k = g; k >= 1; k--) if (vox[idx(c, r, k)] === M.LEAF) { vox[idx(c, r, k)] = 0; trimmed++; }
  }
  const chamfers = [];
  for (let k = F - 1; k >= 1; k--) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const v = vox[idx(c, r, k)];
    if (!v || solid(c, r, k + 1)) continue;
    if (solid(c, r, k + 2)) { vox[idx(c, r, k + 1)] = v; continue; }
    const lean = DIRS.find(([dc, dr]) => solid(c + dc, r + dr, k + 1));
    if (lean) chamfers.push({ c, r, k: k + 1, lean: [lean], hang: true }); else ledges++;
  }

  // ---- 5. paint: the face carries the code; wood that nothing can see turns blossom-coloured (fewer colour swaps) ----
  const cubes = [], topK = new Int16Array(N * N).fill(0);
  const hidden = (c, r, k) => solid(c - 1, r, k) && solid(c + 1, r, k) && solid(c, r - 1, k) && solid(c, r + 1, k) && solid(c, r, k - 1) && solid(c, r, k + 1);
  let pinkCount = 0, whiteCount = 0, woodCount = 0, kTopMax = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cubes.push({ c, r, k: 0, color: 'light', kind: 'plate' });
  for (let k = 1; k <= F; k++) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const v = vox[idx(c, r, k)]; if (!v) continue;
    const face = k === F;
    const color = face ? (dark(c, r) ? 'dark' : 'light') : v === M.WOOD && !hidden(c, r, k) ? 'wood' : 'dark';
    cubes.push({ c, r, k, color, kind: face ? 'top' : v === M.WOOD ? 'wood' : 'leaf' });
    if (face) topK[r * N + c] = k;
    if (color === 'dark') pinkCount++; else if (color === 'light') whiteCount++; else woodCount++;
    kTopMax = Math.max(kTopMax, k);
  }
  // a chamfer takes the colour of the cube it holds
  const colourAt = new Map(); for (const cb of cubes) colourAt.set(idx(cb.c, cb.r, cb.k), cb.color);
  for (const w of chamfers) w.color = colourAt.get(idx(w.c, w.r, w.k - 1));
  // colour-swap levels (two or more colours in the same cube level)
  const lv = new Map(); for (const cb of cubes.concat(chamfers)) { if (cb.k === 0) continue; if (!lv.has(cb.k)) lv.set(cb.k, new Set()); lv.get(cb.k).add(cb.color); }
  let mixedLevels = 0; for (const [, s] of lv) mixedLevels += s.size - 1;
  let onCanopy = 0; for (let r = q; r < q + n; r++) for (let c = q; c < q + n; c++) if (topK[r * N + c] === F) onCanopy++;
  return { cubes, chamfers, vox, N, n, q, KMAX, F, kT, kTopMax, topK, trunkCells, trimmed, ledges, limbCubes, pinkCount, whiteCount, woodCount, mixedLevels, onCanopy, topMin: F, topMax: F };
}

function canopyBoxes(m, s) {
  return m.cubes.map(cb => ({ x0: (cb.c - m.N / 2) * s, x1: (cb.c + 1 - m.N / 2) * s, y0: (cb.r - m.N / 2) * s, y1: (cb.r + 1 - m.N / 2) * s, z0: cb.k * s, z1: (cb.k + 1) * s, color: cb.color, kind: cb.kind }));
}
if (typeof module !== 'undefined') module.exports = { buildCanopyTree, canopyBoxes, strSeed };
