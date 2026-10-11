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
 o = { quiet, crown: canopy radius / half code width, squash: vertical / horizontal canopy radius,
       trunk: bare trunk height (cubes), lobes: number of side lobes, rough: 0..1 surface lumpiness,
       maxLedge: 1..3 longest sideways overhang, seed }
*/
function buildCanopyTree(mat, o) {
  const n = mat.length, q = o.quiet, N = n + 2 * q, ctr = (N - 1) / 2;
  const rng = mulberry32(o.seed || 1), seed = o.seed || 1;
  const R = o.crown * n / 2, A = R * o.squash, L = Math.max(1, Math.min(3, o.maxLedge || 1));
  const kT = o.trunk, Kc = kT + A * 0.62;  // kT: where the trunk forks
  const KMAX = Math.ceil(kT + A * 2.2) + 4;
  const idx = (c, r, k) => (k * N + r) * N + c;
  const M = { EMPTY: 0, LEAF: 1, WOOD: 2 };
  const vox = new Uint8Array(N * N * (KMAX + 1));
  const inGrid = (c, r) => c >= 0 && r >= 0 && c < N && r < N;
  const dark = (c, r) => c >= q && r >= q && c < q + n && r < q + n && !!mat[r - q][c - q];
  const inCode = (c, r) => c >= q && r >= q && c < q + n && r < q + n;

  // ---- 1. skeleton: short 2x2 trunk that forks into a few limbs; a cloud of blossom at each limb tip ----
  const tc = Math.round(ctr), tr = Math.round(ctr);
  const trunkCells = [[tc, tr], [tc + 1, tr], [tc, tr + 1], [tc + 1, tr + 1]];
  for (const [c, r] of trunkCells) for (let k = 1; k <= kT; k++) vox[idx(c, r, k)] = M.WOOD;
  for (const [c, r] of trunkCells) for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const c2 = c + dc, r2 = r + dr;
    if (inGrid(c2, r2) && !vox[idx(c2, r2, 1)] && rng() < 0.4) vox[idx(c2, r2, 1)] = M.WOOD;
  }
  const nl = o.lobes, rot = o.onCanopy ? Math.PI / 4 + (rng() - 0.5) * 0.3 : rng() * Math.PI * 2;
  const clumps = [];
  let limbCubes = 0;
  const putWood = (c, r, k) => { if (inGrid(c, r) && k >= 1 && k <= KMAX && vox[idx(c, r, k)] !== M.WOOD) { vox[idx(c, r, k)] = M.WOOD; limbCubes++; } };
  // limb: climb outward at 45°, one cube sideways (or one diagonally) per level, then straight up to tz.
  // Every limb cube stands on wood or overhangs it by one cube, so limbs print without supports (see step 3);
  // a limb whose target is far away simply ends higher than tz.
  function limb(c0, r0, k0, tx, ty, tz) {
    let c = c0, r = r0, k = k0;
    while (c !== tx || r !== ty) {
      const sx = Math.sign(tx - c), sy = Math.sign(ty - r);
      k++;
      if (sx && sy) { putWood(c + sx, r, k); putWood(c, r + sy, k); }
      c += sx; r += sy;
      putWood(c, r, k); if (!(sx && sy)) putWood(c, r, k - 1);
    }
    while (k < tz) putWood(c, r, ++k);
    return [c, r, k];
  }
  for (let i = 0; i < nl; i++) {
    const th = rot + i * 2 * Math.PI / nl + (rng() - 0.5) * 0.5;
    const d = R * (0.5 + rng() * 0.18);
    const tx = Math.round(ctr + d * Math.cos(th)), ty = Math.round(ctr + d * Math.sin(th));
    const tz = Math.round(kT + A * (0.25 + rng() * 0.3));
    const startC = tc + (Math.cos(th) > 0 ? 1 : 0), startR = tr + (Math.sin(th) > 0 ? 1 : 0);
    const tip = limb(startC, startR, kT, tx, ty, tz);
    const rx = R * (0.36 + rng() * 0.1);
    clumps.push({ x: tip[0], y: tip[1], z: tip[2] + rx * 0.45, rx, rz: rx * o.puff, th, tip });
  }
  // leader up the middle, with an upper tier of clouds between the lower limbs and a crown cloud on top
  const lead = Math.round(kT + A * 0.75);
  for (let k = kT + 1; k <= lead; k++) putWood(tc, tr, k);
  const lower = clumps.slice();
  for (let i = 0; i < lower.length; i++) {
    const th = lower[i].th + Math.PI / lower.length;
    const d = R * (0.28 + rng() * 0.1);
    const tx = Math.round(ctr + d * Math.cos(th)), ty = Math.round(ctr + d * Math.sin(th));
    const kk = Math.round(kT + A * (0.55 + rng() * 0.2));
    const tip = limb(tc, tr, Math.round(kT + A * 0.35), tx, ty, kk);
    const rx = R * (0.3 + rng() * 0.06);
    clumps.push({ x: tip[0], y: tip[1], z: tip[2] + rx * 0.5, rx, rz: rx * o.puff, tip });
  }
  { const rx = R * (0.38 + rng() * 0.05); clumps.push({ x: tc + 0.5, y: tr + 0.5, z: lead + rx * 0.45, rx, rz: rx * o.puff, tip: [tc + 0.5, tr + 0.5, lead] }); }

  // ---- 2. blossom clouds: rounder on top, fluffy edges; underneath, each cloud stays inside a 45° cone that opens
  //      upward from the tip of its own limb, so the cloud prints without supports, resting on its limb ----
  for (let k = 1; k <= KMAX; k++) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (vox[idx(c, r, k)]) continue;
    const nz = (noise3(c * 0.45, r * 0.45, k * 0.45, seed) - 0.5) * 0.5 + (noise3(c * 1.2, r * 1.2, k * 1.2, seed + 9) - 0.5) * 0.3;
    for (const b of clumps) {
      if (Math.max(Math.abs(c - b.tip[0]), Math.abs(r - b.tip[1])) > k - b.tip[2] + 0.5) continue;
      const dz = k - b.z, sz = dz < 0 ? b.rz * 0.7 : b.rz;   // flatter underside
      if (Math.hypot((c - b.x) / b.rx, (r - b.y) / b.rx, dz / sz) + nz * o.rough < 1) { vox[idx(c, r, k)] = M.LEAF; break; }
    }
  }

  // ---- 2b. umbrella cap: the whole code sits on one gently domed top surface ----
  let pits = 0, capTop = 0;
  if (o.onCanopy) {
    const half = n / 2 + 1, Rc = half * Math.SQRT2;
    let maxTop = 0;
    for (let r = q - 1; r <= q + n; r++) for (let c = q - 1; c <= q + n; c++) for (let k = KMAX; k >= 1; k--) if (vox[idx(c, r, k)]) { maxTop = Math.max(maxTop, k); break; }
    capTop = maxTop - 1;
    const target = (c, r) => capTop - Math.round(o.dome * ((c - ctr) ** 2 + (r - ctr) ** 2) / (Rc * Rc));
    for (let r = q - 1; r <= q + n; r++) for (let c = q - 1; c <= q + n; c++) {
      if (!inGrid(c, r)) continue;
      const T = target(c, r);
      for (let k = T + 1; k <= KMAX; k++) if (vox[idx(c, r, k)] === M.LEAF) vox[idx(c, r, k)] = 0;
      let top = 0; for (let k = T; k >= 1; k--) if (vox[idx(c, r, k)]) { top = k; break; }
      const from = top >= T - o.capDepth ? top + 1 : T - 2;
      for (let k = Math.max(1, from); k <= T; k++) if (!vox[idx(c, r, k)]) vox[idx(c, r, k)] = M.LEAF;
    }
  }

  // ---- 3. printability (FDM, no supports). A cube may stand on the cube below it, or overhang by one cube:
  //      next to a solid cell one level down (that cell anchors a 45° wedge under the ledge), or diagonally next to
  //      one when both cubes beside it overhang that way too (a corner piece joins their two wedges). Step 3c
  //      adds these chamfers, so the slicer only ever sees 45° slopes. maxLedge 2–3 also keeps longer flat ledges
  //      (measured from the nearest cube that stands on something); those need supports.
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]], DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const solid = (c, r, k) => inGrid(c, r) && (k === 0 || (k <= KMAX && vox[idx(c, r, k)] !== 0));
  const sideways = (c, r, k) => DIRS.filter(([dc, dr]) => solid(c + dc, r + dr, k - 1));
  const diagonal = (c, r, k) => DIAG.filter(([dc, dr]) => solid(c + dc, r + dr, k - 1) && solid(c + dc, r, k) && solid(c, r + dr, k));
  const chamferable = (c, r, k) => {
    if (solid(c, r, k - 1)) return true;
    for (const [dc, dr] of DIRS) if (solid(c + dc, r + dr, k - 1)) return true;
    for (const [dc, dr] of DIAG) if (solid(c + dc, r + dr, k - 1) && solid(c + dc, r, k) && solid(c, r + dr, k)) return true;
    return false;
  };
  const inward = (c, r) => Math.hypot(c - tc - 0.5, r - tr - 0.5);
  // 3a. wood and the cubes that carry the code are never trimmed. Top-down, each of them that cannot be chamfered gets
  //     a new blossom cube one level down, in the neighbouring cell (sideways or diagonal) from which the tree is the
  //     fewest levels away (`cost`, counted bottom-up). That cube is kept too, so the additions form a 45° strut that
  //     ends on the nearest limb or cloud. A diagonal step also fills the two cells beside it, for the corner chamfer.
  const STEPS = [[0, 0]].concat(DIRS, DIAG);
  const cost = new Float32Array(vox.length);
  for (let k = 2; k <= KMAX; k++) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (chamferable(c, r, k)) continue;
    let best = Infinity;
    for (const [dc, dr] of STEPS) if (inGrid(c + dc, r + dr)) best = Math.min(best, cost[idx(c + dc, r + dr, k - 1)]);
    cost[idx(c, r, k)] = best + 1;
  }
  const keep = new Uint8Array(vox.length);
  let added = 0;
  for (let i = 0; i < vox.length; i++) if (vox[i] === M.WOOD) keep[i] = 1;
  if (o.onCanopy) for (let r = q - 1; r <= q + n; r++) for (let c = q - 1; c <= q + n; c++) {
    if (!inGrid(c, r)) continue;
    for (let k = KMAX; k >= 1; k--) if (vox[idx(c, r, k)]) { keep[idx(c, r, k)] = 1; break; }
  }
  for (let k = KMAX; k >= 2; k--) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (!vox[idx(c, r, k)] || !keep[idx(c, r, k)]) continue;
    if (!chamferable(c, r, k)) {
      let to = null, best = Infinity;
      for (const [dc, dr] of STEPS) {
        if (!inGrid(c + dc, r + dr)) continue;   // ties: not straight down, then toward the trunk
        const t = cost[idx(c + dc, r + dr, k - 1)] + (dc || dr ? 0 : 0.5) + inward(c + dc, r + dr) * 1e-3;
        if (t < best) { best = t; to = [dc, dr]; }
      }
      const add = (c2, r2, k2) => { const j = idx(c2, r2, k2); if (!vox[j]) { vox[j] = M.LEAF; keep[j] = 1; added++; } };
      add(c + to[0], r + to[1], k - 1);
      if (to[0] && to[1]) { add(c + to[0], r, k); add(c, r + to[1], k); }
    }
    if (solid(c, r, k - 1)) keep[idx(c, r, k - 1)] = 1;
    for (const [dc, dr] of sideways(c, r, k)) keep[idx(c + dc, r + dr, k - 1)] = 1;
    for (const [dc, dr] of diagonal(c, r, k)) { keep[idx(c + dc, r + dr, k - 1)] = 1; keep[idx(c + dc, r, k)] = 1; keep[idx(c, r + dr, k)] = 1; }
  }
  // 3b. bottom-up, drop the other blossom cubes that would hang in the air
  let trimmed = 0, unsupported = 0;
  for (let k = 1; k <= KMAX; k++) {
    const dist = new Int16Array(N * N).fill(-1), queue = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (!vox[idx(c, r, k)]) continue;
      if (solid(c, r, k - 1)) { dist[r * N + c] = 0; queue.push(c, r); }
    }
    for (let h = 0; h < queue.length; h += 2) {
      const c = queue[h], r = queue[h + 1], d = dist[r * N + c]; if (d >= L) continue;
      for (const [dc, dr] of DIRS) { const c2 = c + dc, r2 = r + dr; if (!inGrid(c2, r2) || !vox[idx(c2, r2, k)] || dist[r2 * N + c2] >= 0) continue; dist[r2 * N + c2] = d + 1; queue.push(c2, r2); }
    }
    const drop = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const i = idx(c, r, k); if (!vox[i] || dist[r * N + c] >= 0 || chamferable(c, r, k)) continue;
      if (vox[i] === M.LEAF && !keep[i]) drop.push(i); else unsupported++;   // 3a makes this 0
    }
    // a dropped cube can be what a diagonal ledge leaned on, so repeat until the layer is stable
    for (const i of drop) vox[i] = 0;
    trimmed += drop.length;
    if (drop.length) k--;
  }
  // 3c. chamfers. Under every one-cube ledge, a 45° wedge fills the empty cell below it, leaning on a solid
  //     neighbour cell (a one-cube gap above a cube is filled solid instead). A diagonal ledge gets a corner piece
  //     between the wedges under the two cubes beside it; those wedges must lean towards the same cell, so a wedge
  //     asked to lean two ways at right angles becomes a valley (two wedges in one cell), and one asked to lean
  //     opposite ways sits between two solid cells and becomes a cube (a one-cube bridge).
  const wedges = new Map(), corners = [];
  let ledges = 0;
  function wedge(c, r, k) {
    const v = vox[idx(c, r, k)];
    let lean = null;
    for (const [dc, dr] of sideways(c, r, k))
      if (!lean || (vox[idx(c + dc, r + dr, k - 1)] === v && vox[idx(c + lean[0], r + lean[1], k - 1)] !== v)) lean = [dc, dr];
    if (!lean) return false;
    if (solid(c, r, k - 2)) vox[idx(c, r, k - 1)] = v;
    else wedges.set(idx(c, r, k - 1), { c, r, k: k - 1, lean: [lean] });
    return true;
  }
  const ledge = (c, r, k) => vox[idx(c, r, k)] && !solid(c, r, k - 1) && !wedges.has(idx(c, r, k - 1));
  for (let k = 2; k <= KMAX; k++) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (ledge(c, r, k)) wedge(c, r, k);
  for (let k = 2; k <= KMAX; k++) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (!ledge(c, r, k) || wedge(c, r, k)) continue;
    const d = diagonal(c, r, k).find(([dx, dy]) => wedges.has(idx(c + dx, r, k - 1)) && wedges.has(idx(c, r + dy, k - 1)));
    if (!d) { ledges++; continue; }                        // a flat ledge (maxLedge > 1): needs supports
    const [dx, dy] = d;
    let bridged = false;
    for (const [sc, sr, lc, lr] of [[c + dx, r, 0, dy], [c, r + dy, dx, 0]]) {
      const i = idx(sc, sr, k - 1), w = wedges.get(i);
      if (w.lean.some(([a, b]) => a === lc && b === lr)) continue;
      if (w.lean.some(([a, b]) => a === -lc && b === -lr)) { wedges.delete(i); vox[i] = vox[idx(sc, sr, k)]; wedge(sc, sr, k - 1); bridged = true; }
      else w.lean.push([lc, lr]);
    }
    if (bridged) wedge(c, r, k); else corners.push({ c, r, k: k - 1, dc: dx, dr: dy });
  }

  // ---- 4. paint: the top cube of every column carries one QR pixel ----
  const cubes = [], topK = new Int16Array(N * N).fill(0);
  const paint = new Map();
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    let top = 0; for (let k = KMAX; k >= 1; k--) if (vox[idx(c, r, k)]) { top = k; break; }
    topK[r * N + c] = top;
    paint.set(idx(c, r, top), inCode(c, r) && dark(c, r) ? 'dark' : 'light');
  }
  let pinkCount = 0, whiteCount = 0, woodCount = 0, kTopMax = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    // plate cube: painted only where nothing stands on it
    const pc = paint.get(idx(c, r, 0)) || 'light';
    cubes.push({ c, r, k: 0, color: pc, kind: 'plate' });
  }
  for (let k = 1; k <= KMAX; k++) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const v = vox[idx(c, r, k)]; if (!v) continue;
    const painted = paint.get(idx(c, r, k));
    const color = painted || (v === M.WOOD ? 'wood' : 'dark');
    cubes.push({ c, r, k, color, kind: painted ? 'top' : v === M.WOOD ? 'wood' : 'leaf' });
    if (color === 'dark') pinkCount++; else if (color === 'light') whiteCount++; else woodCount++;
    kTopMax = Math.max(kTopMax, k);
  }
  // a chamfer takes the colour of the ledge cube it holds up
  const colourAt = new Map(); for (const cb of cubes) colourAt.set(idx(cb.c, cb.r, cb.k), cb.color);
  // chamfer pieces in the empty cell under a ledge: 'wedge' leans on the solid neighbour(s) in `lean` (one, or two at
  // right angles); 'corner' sits diagonally off the solid cell at (dc, dr) and joins the two wedges beside it
  const chamfers = [...wedges.values()].map(w => ({ c: w.c, r: w.r, k: w.k, shape: 'wedge', lean: w.lean }))
    .concat(corners.map(w => ({ c: w.c, r: w.r, k: w.k, shape: 'corner', lean: [[w.dc, w.dr]] })));
  for (const w of chamfers) w.color = colourAt.get(idx(w.c, w.r, w.k + 1));
  // colour-swap levels (two or more colours in the same cube level)
  const lv = new Map(); for (const cb of cubes.concat(chamfers)) { if (!lv.has(cb.k)) lv.set(cb.k, new Set()); lv.get(cb.k).add(cb.color); }
  let mixedLevels = 0; for (const [, s] of lv) mixedLevels += s.size - 1;
  // which code cells sit on the canopy (vs. on the plate)
  let onCanopy = 0, topMin = Infinity, topMax = 0;
  for (let r = q; r < q + n; r++) for (let c = q; c < q + n; c++) { const t = topK[r * N + c]; if (t > 0) { onCanopy++; topMin = Math.min(topMin, t); topMax = Math.max(topMax, t); } }
  return { cubes, chamfers, vox, N, n, q, KMAX, capTop, kTopMax, kT, topK, trimmed, unsupported, added, ledges, limbCubes, pinkCount, whiteCount, woodCount, mixedLevels, onCanopy, topMin, topMax, maxH: L };
}

function canopyBoxes(m, s) {
  return m.cubes.map(cb => ({ x0: (cb.c - m.N / 2) * s, x1: (cb.c + 1 - m.N / 2) * s, y0: (cb.r - m.N / 2) * s, y1: (cb.r + 1 - m.N / 2) * s, z0: cb.k * s, z1: (cb.k + 1) * s, color: cb.color, kind: cb.kind }));
}
if (typeof module !== 'undefined') module.exports = { buildCanopyTree, canopyBoxes, strSeed };
