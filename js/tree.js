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
       maxLedge: 1..3 longest sideways overhang, seed,
       shift: move the tree this many cells toward the code's bottom-right corner (the one without a finder pattern),
       over: room on the right and bottom, past the plate, for a shifted canopy to hang over (no plate there) }
*/
function buildCanopyTree(mat, o) {
  const n = mat.length, q = o.quiet, P = n + 2 * q, N = P + (o.over || 0), ctr = q + (n - 1) / 2;   // P: plate width
  const cx = ctr + (o.shift || 0), cy = ctr + (o.shift || 0);   // tree centre
  const rng = mulberry32(o.seed || 1), seed = o.seed || 1;
  const R = o.crown * n / 2, A = R * o.squash, L = Math.max(1, Math.min(3, o.maxLedge || 2));
  const kT = o.trunk, Kc = kT + A * 0.62;  // kT: where the trunk forks
  const KMAX = Math.ceil(kT + A * 2.2) + 4;
  const idx = (c, r, k) => (k * N + r) * N + c;
  const M = { EMPTY: 0, LEAF: 1, WOOD: 2 };
  const vox = new Uint8Array(N * N * (KMAX + 1));
  const inGrid = (c, r) => c >= 0 && r >= 0 && c < N && r < N;
  const onPlate = (c, r) => c < P && r < P;
  const dark = (c, r) => c >= q && r >= q && c < q + n && r < q + n && !!mat[r - q][c - q];
  const inCode = (c, r) => c >= q && r >= q && c < q + n && r < q + n;

  // ---- 1. skeleton: short 2x2 trunk that forks into a few limbs; a cloud of blossom at each limb tip ----
  const tc = Math.round(cx), tr = Math.round(cy);
  const trunkCells = [[tc, tr], [tc + 1, tr], [tc, tr + 1], [tc + 1, tr + 1]];
  for (const [c, r] of trunkCells) for (let k = 1; k <= kT; k++) vox[idx(c, r, k)] = M.WOOD;
  for (const [c, r] of trunkCells) for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const c2 = c + dc, r2 = r + dr;
    if (inGrid(c2, r2) && onPlate(c2, r2) && !vox[idx(c2, r2, 1)] && rng() < 0.4) vox[idx(c2, r2, 1)] = M.WOOD;
  }
  const nl = o.lobes, rot = o.onCanopy ? Math.PI / 4 + (rng() - 0.5) * 0.3 : rng() * Math.PI * 2;
  const clumps = [];
  let limbCubes = 0;
  const putWood = (c, r, k) => { if (inGrid(c, r) && k >= 1 && k <= KMAX && vox[idx(c, r, k)] !== M.WOOD) { vox[idx(c, r, k)] = M.WOOD; limbCubes++; } };
  // limb: from the trunk top, climb outward as a staircase (L sideways per level), 2 cubes thick near the base
  function limb(c0, r0, k0, tx, ty, tz, thick) {
    let c = c0, r = r0, k = k0, steps = 0;
    while ((c !== tx || r !== ty || k < tz) && steps++ < 200) {
      for (let s = 0; s < L && (c !== tx || r !== ty); s++) {
        const dx = tx - c, dy = ty - r;
        if (Math.abs(dx) >= Math.abs(dy)) c += Math.sign(dx); else r += Math.sign(dy);
        putWood(c, r, k); if (thick) putWood(c, r, k - 1);
      }
      if (k < tz || (c === tx && r === ty)) { k++; putWood(c, r, k); }
      if (c === tx && r === ty && k >= tz) break;
    }
    return [c, r, k];
  }
  for (let i = 0; i < nl; i++) {
    const th = rot + i * 2 * Math.PI / nl + (rng() - 0.5) * 0.5;
    const d = R * (0.5 + rng() * 0.18);
    const tx = Math.round(cx + d * Math.cos(th)), ty = Math.round(cy + d * Math.sin(th));
    const tz = Math.round(kT + A * (0.25 + rng() * 0.3));
    const startC = tc + (Math.cos(th) > 0 ? 1 : 0), startR = tr + (Math.sin(th) > 0 ? 1 : 0);
    const tip = limb(startC, startR, kT, tx, ty, tz, true);
    const rx = R * (0.36 + rng() * 0.1);
    clumps.push({ x: tip[0], y: tip[1], z: tip[2] + rx * 0.45, rx, rz: rx * o.puff, th });
  }
  // leader up the middle, with an upper tier of clouds between the lower limbs and a crown cloud on top
  const lead = Math.round(kT + A * 0.75);
  for (let k = kT + 1; k <= lead; k++) putWood(tc, tr, k);
  const lower = clumps.slice();
  for (let i = 0; i < lower.length; i++) {
    const th = lower[i].th + Math.PI / lower.length;
    const d = R * (0.28 + rng() * 0.1);
    const tx = Math.round(cx + d * Math.cos(th)), ty = Math.round(cy + d * Math.sin(th));
    const kk = Math.round(kT + A * (0.55 + rng() * 0.2));
    const tip = limb(tc, tr, Math.round(kT + A * 0.35), tx, ty, kk, false);
    const rx = R * (0.3 + rng() * 0.06);
    clumps.push({ x: tip[0], y: tip[1], z: tip[2] + rx * 0.5, rx, rz: rx * o.puff });
  }
  { const rx = R * (0.38 + rng() * 0.05); clumps.push({ x: tc + 0.5, y: tr + 0.5, z: lead + rx * 0.45, rx, rz: rx * o.puff }); }

  // ---- 2. blossom clouds: flat-bottomed, rounder on top, fluffy edges ----
  for (let k = 1; k <= KMAX; k++) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (vox[idx(c, r, k)]) continue;
    let f = Infinity;
    for (const b of clumps) {
      const dz = k - b.z, sz = dz < 0 ? b.rz * 0.7 : b.rz;   // flatter underside
      const dx = (c - b.x) / b.rx, dy = (r - b.y) / b.rx;
      f = Math.min(f, Math.hypot(dx, dy, dz / sz));
    }
    const nz = (noise3(c * 0.45, r * 0.45, k * 0.45, seed) - 0.5) * 0.5 + (noise3(c * 1.2, r * 1.2, k * 1.2, seed + 9) - 0.5) * 0.3;
    if (f + nz * o.rough < 1) vox[idx(c, r, k)] = M.LEAF;
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

  // ---- 3. printability: bottom-up, keep only what rests on the layer below or hangs ≤ L cubes sideways ----
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let trimmed = 0, unsupportedWood = 0;
  for (let k = 1; k <= KMAX; k++) {
    const dist = new Int16Array(N * N).fill(-1), queue = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (!vox[idx(c, r, k)]) continue;
      if ((k === 1 && onPlate(c, r)) || vox[idx(c, r, k - 1)]) { dist[r * N + c] = 0; queue.push(c, r); }
    }
    for (let h = 0; h < queue.length; h += 2) {
      const c = queue[h], r = queue[h + 1], d = dist[r * N + c]; if (d >= L) continue;
      for (const [dc, dr] of DIRS) { const c2 = c + dc, r2 = r + dr; if (!inGrid(c2, r2) || !vox[idx(c2, r2, k)] || dist[r2 * N + c2] >= 0) continue; dist[r2 * N + c2] = d + 1; queue.push(c2, r2); }
    }
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const i = idx(c, r, k); if (!vox[i] || dist[r * N + c] >= 0) continue;
      if (vox[i] === M.LEAF) { vox[i] = 0; trimmed++; } else unsupportedWood++;
    }
  }

  // ---- 3b. a canopy hanging past the plate: shrink the grid to what it uses ----
  if (N > P) {
    let used = P;
    for (let k = 1; k <= KMAX; k++) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (vox[idx(c, r, k)]) used = Math.max(used, c + 1, r + 1);
    if (used < N) {
      const v2 = new Uint8Array(used * used * (KMAX + 1));
      for (let k = 0; k <= KMAX; k++) for (let r = 0; r < used; r++) for (let c = 0; c < used; c++) v2[(k * used + r) * used + c] = vox[idx(c, r, k)];
      return buildFrom(v2, used);
    }
  }
  return buildFrom(vox, N);

  function buildFrom(vox, N) {
  const idx = (c, r, k) => (k * N + r) * N + c;
  // ---- 4. paint: the top cube of every column carries one QR pixel ----
  const cubes = [], topK = new Int16Array(N * N).fill(0);
  const paint = new Map();
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    let top = 0; for (let k = KMAX; k >= 1; k--) if (vox[idx(c, r, k)]) { top = k; break; }
    topK[r * N + c] = top;
    if (!onPlate(c, r)) { if (top) paint.set(idx(c, r, top), hash3(c, r, top, seed) < 0.45 ? 'light' : 'dark'); continue; }   // canopy past the plate: highlights like the code's
    paint.set(idx(c, r, top), inCode(c, r) && dark(c, r) ? 'dark' : 'light');
  }
  let pinkCount = 0, whiteCount = 0, woodCount = 0, kTopMax = 0;
  for (let r = 0; r < P; r++) for (let c = 0; c < P; c++) {
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
  // colour-swap levels (two or more colours in the same cube level)
  const lv = new Map(); for (const cb of cubes) { if (!lv.has(cb.k)) lv.set(cb.k, new Set()); lv.get(cb.k).add(cb.color); }
  let mixedLevels = 0; for (const [, s] of lv) mixedLevels += s.size - 1;
  // which code cells sit on the canopy (vs. on the plate)
  let onCanopy = 0, topMin = Infinity, topMax = 0;
  for (let r = q; r < q + n; r++) for (let c = q; c < q + n; c++) { const t = topK[r * N + c]; if (t > 0) { onCanopy++; topMin = Math.min(topMin, t); topMax = Math.max(topMax, t); } }
  return { cubes, vox, N, P, n, q, KMAX, trunkCells, capTop, kTopMax, kT, topK, trimmed, unsupportedWood, limbCubes, pinkCount, whiteCount, woodCount, mixedLevels, onCanopy, topMin, topMax, maxH: L };
  }
}

// Perspective compensation: cubes need not all be the same size. Shrink every level towards the code's centre as a
// camera D0 mm above the bed (straight over the code) sees it shrink, so each column becomes a thin frustum pointing
// at that camera, its side walls edge-on. From there every top face lands on its own cell of the plate's grid, as if
// the code were flat. Returns a map of grid corners (c, r, k in cubes; the plate's top is k = 1) to warped ones.
function perspectiveWarp(m, s, D0) {
  const H = D0 / s, cc = m.q + m.n / 2;
  return (c, r, k) => { const f = (H - k) / (H - 1); return [cc + (c - cc) * f, cc + (r - cc) * f, k]; };
}

// Which columns have their top face in shadow, for a lamp in direction az (degrees in the plate's plane, 0 = towards
// +c, 90 = towards +r, so 225 = the code's top-left) at elevation el: march from the middle of each top face
// towards the lamp and see whether it runs into a cube.
function shadowedTops(m, az, el) {
  const a = az * Math.PI / 180, e = el * Math.PI / 180, st = 0.05;
  const dx = Math.cos(a) * Math.cos(e) * st, dy = Math.sin(a) * Math.cos(e) * st, dz = Math.sin(e) * st;
  const { N, KMAX, vox } = m, out = new Uint8Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    let x = c + 0.5, y = r + 0.5, z = m.topK[r * N + c] + 1.001;
    for (;;) {
      x += dx; y += dy; z += dz;
      const ci = Math.floor(x), ri = Math.floor(y), ki = Math.floor(z);
      if (ki > KMAX || ci < 0 || ri < 0 || ci >= N || ri >= N) break;
      if (vox[(ki * N + ri) * N + ci]) { out[r * N + c] = 1; break; }
    }
  }
  return out;
}
// light code modules a shadow map darkens (they read as dark)
function shadowedLight(m, sh, mat) {
  let k = 0;
  for (let r = 0; r < m.n; r++) for (let c = 0; c < m.n; c++) if (!mat[r][c] && sh[(r + m.q) * m.N + c + m.q]) k++;
  return k;
}

// A flat code under the plate, read from below: one more layer of cubes under the whole plate, the same pattern
// mirrored left to right (turned over, the plate's columns run the other way), quiet zone light. No height steps,
// no canopy, no shadows: the fallback when the 3D code on top does not scan. Cubes { c, r, color } at level -1.
function bottomCode(m, mat) {
  const out = [];
  for (let r = 0; r < m.P; r++) for (let c = 0; c < m.P; c++) {
    const i = r - m.q, j = m.n - 1 - (c - m.q);
    const dark = i >= 0 && i < m.n && j >= 0 && j < m.n && mat[i][j];
    out.push({ c, r, k: -1, color: dark ? 'dark' : 'light', kind: 'under' });
  }
  return out;
}

function canopyBoxes(m, s) {
  return m.cubes.map(cb => ({ x0: (cb.c - m.N / 2) * s, x1: (cb.c + 1 - m.N / 2) * s, y0: (cb.r - m.N / 2) * s, y1: (cb.r + 1 - m.N / 2) * s, z0: cb.k * s, z1: (cb.k + 1) * s, color: cb.color, kind: cb.kind }));
}
if (typeof module !== 'undefined') module.exports = { buildCanopyTree, canopyBoxes, strSeed, shadowedTops, shadowedLight, perspectiveWarp, bottomCode };
