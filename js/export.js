// SakuraQR exporter: per-colour closed shells -> multi-colour 3MF, per-colour binary STL (zipped),
// and a crisp top-view PNG for scan testing.
//
// Everything is exported the way it prints: the tree upside down with the code face on the bed, its trunk ending in a
// square peg, and next to it the base with a matching socket. Print coordinates: X = column, Y = row, Z up, in
// millimetres; this is the assembled tree turned over about the X axis, so it is not mirrored.
const SakuraExport = (function () {
  const PART_ORDER = ['dark', 'light', 'wood'];
  const ID = { dark: 1, light: 2, wood: 3 };

  // Cells of the tree as printed: level p = F - k (p = 0 lies on the bed), plus the peg one level further up under the
  // trunk. Chamfers hang above a step in the tree, so printed they stand under it. `merge` maps a colour onto another
  // (e.g. wood -> light for 2 colours).
  function printGrid(model, merge) {
    const { N, F } = model, P = F + 1, g = new Uint8Array(N * N * P), pieces = new Map();
    const at = (c, r, p) => (p * N + r) * N + c;
    const col = name => ID[(merge && merge[name]) || name];
    for (const cb of model.cubes) if (cb.k > 0) g[at(cb.c, cb.r, F - cb.k)] = col(cb.color);
    for (const [c, r] of model.trunkCells) g[at(c, r, F)] = col('wood');
    for (const w of model.chamfers) { const i = at(w.c, w.r, F - w.k); g[i] = col(w.color); pieces.set(i, w); }
    return { g, pieces, P };
  }

  // Which part of a cell face a cell covers. A face is split into four quarter triangles around its centre, one per
  // cell edge: bit 2j (2j + 1) is the quarter on the low (high) edge of the face's j-th tangent axis. A cube covers
  // whole faces; a chamfer wedge (z ≥ distance from the face it leans on) covers half of its two side faces.
  const TANGENTS = [[1, 2], [0, 2], [0, 1]];
  const QUARTERS = [[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[0, 0], [1, 0]], [[0, 1], [1, 1]]];   // outer edge, as (u, v)
  const quarter = (axis, tAxis, sign) => 1 << (2 * TANGENTS[axis].indexOf(tAxis) + (sign > 0 ? 1 : 0));
  const leanAxis = ([dc, dr]) => dc ? [0, dc] : [1, dr];
  function coverage(piece, axis, sign) {
    if (!piece) return 15;
    if (axis === 2) return sign > 0 ? 15 : 0;
    const [la, ls] = leanAxis(piece.lean[0]);
    if (la === axis) return ls === sign ? 15 : 0;
    return quarter(axis, la, ls) | quarter(axis, 2, 1);
  }
  // the sloped underside of a (standing) wedge in cell-local (c, r, z), split at its side faces' centres
  function slopes(piece) {
    const [a, sa] = leanAxis(piece.lean[0]), u = 1 - a;
    const P = (t, v, z) => { const p = [0, 0, z]; p[a] = sa > 0 ? 1 - t : t; p[u] = v; return p; };
    const n = [0, 0, -1]; n[a] = -sa;
    return [
      { n, p: [P(0, 0, 0), P(0.5, 0, 0.5), P(0.5, 1, 0.5), P(0, 1, 0)] },
      { n, p: [P(0.5, 0, 0.5), P(1, 0, 1), P(1, 1, 1), P(0.5, 1, 0.5)] }
    ];
  }
  // the parts of a standing wedge that are not whole cell faces (for the preview)
  function pieceFaces(piece) {
    const out = slopes(piece);
    for (let axis = 0; axis < 2; axis++) for (const sign of [1, -1]) {
      const m = coverage(piece, axis, sign); if (!m || m === 15) continue;
      const [t0, t1] = TANGENTS[axis], n = [0, 0, 0]; n[axis] = sign;
      const pt = ([u, v]) => { const p = [0, 0, 0]; p[axis] = sign > 0 ? 1 : 0; p[t0] = u; p[t1] = v; return p; };
      for (let b = 0; b < 4; b++) if (m & (1 << b)) out.push({ n, p: [pt(QUARTERS[b][0]), pt(QUARTERS[b][1]), pt([0.5, 0.5])] });
    }
    return out;
  }

  // closed surface of every cell of one colour: each quarter face a cell of that colour covers and its neighbour of
  // the same colour does not, plus the sloped undersides of its wedges. `zOf(p)` gives the height of level plane p.
  function shell(grid, N, colourId, s, zOf) {
    const { g, pieces, P } = grid, verts = [], tris = [], index = new Map();
    const inside = (c, r, p) => c >= 0 && r >= 0 && p >= 0 && c < N && r < N && p < P;
    const vid = q => {
      const key = q[0] * 2 + ',' + q[1] * 2 + ',' + q[2] * 2;
      let i = index.get(key);
      if (i === undefined) {
        const p0 = Math.floor(q[2]), z = p0 === q[2] ? zOf(p0) : (zOf(p0) + zOf(p0 + 1)) / 2;
        i = verts.length / 3; verts.push(q[0] * s, q[1] * s, z); index.set(key, i);
      }
      return i;
    };
    const tri = (a, b, c, n) => {   // triangle facing n
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const dot = (u[1] * v[2] - u[2] * v[1]) * n[0] + (u[2] * v[0] - u[0] * v[2]) * n[1] + (u[0] * v[1] - u[1] * v[0]) * n[2];
      if (dot > 0) tris.push(vid(a), vid(b), vid(c)); else tris.push(vid(a), vid(c), vid(b));
    };
    const poly = (p, n) => { for (let i = 2; i < p.length; i++) tri(p[0], p[i - 1], p[i], n); };
    for (let p = 0; p < P; p++) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const i = (p * N + r) * N + c;
      if (g[i] !== colourId) continue;
      const me = pieces.get(i), cell = [c, r, p];
      for (let axis = 0; axis < 3; axis++) for (const sign of [1, -1]) {
        const nb = cell.slice(); nb[axis] += sign;
        const j = inside(nb[0], nb[1], nb[2]) ? (nb[2] * N + nb[1]) * N + nb[0] : -1;
        const show = coverage(me, axis, sign) & ~(j >= 0 && g[j] === colourId ? coverage(pieces.get(j), axis, -sign) : 0);
        if (!show) continue;
        const [t0, t1] = TANGENTS[axis], n = [0, 0, 0]; n[axis] = sign;
        const pt = (u, v) => { const q = cell.slice(); if (sign > 0) q[axis] += 1; q[t0] += u; q[t1] += v; return q; };
        if (show === 15) { poly([pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1)], n); continue; }
        for (let b = 0; b < 4; b++) if (show & (1 << b)) tri(pt(...QUARTERS[b][0]), pt(...QUARTERS[b][1]), pt(0.5, 0.5), n);
      }
      if (me) for (const f of slopes(me)) poly(f.p.map(q => [q[0] + c, q[1] + r, q[2] + p]), f.n);
    }
    return { verts, tris };
  }

  // base: a slab with a square through-hole for the peg, `clear` mm wider than the trunk on every side
  function baseMesh(model, s, opt, x0) {
    const { N, trunkCells } = model, T = opt.baseCubes * s;
    const c0 = Math.min(...trunkCells.map(t => t[0])), r0 = Math.min(...trunkCells.map(t => t[1]));
    const X = [x0, x0 + c0 * s - opt.clear, x0 + (c0 + 2) * s + opt.clear, x0 + N * s];
    const Y = [0, (N - r0 - 2) * s - opt.clear, (N - r0) * s + opt.clear, N * s];   // the base prints the right way up
    const verts = [], tris = [], vi = {};
    const v = (x, y, z) => { const k = x + ',' + y + ',' + z; if (vi[k] === undefined) { vi[k] = verts.length / 3; verts.push(X[x], Y[y], z * T); } return vi[k]; };
    const quad = (a, b, c, d) => tris.push(a, b, c, a, c, d);   // counter-clockwise seen from outside
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      if (i === 1 && j === 1) continue;   // the hole
      quad(v(i, j, 1), v(i + 1, j, 1), v(i + 1, j + 1, 1), v(i, j + 1, 1));
      quad(v(i, j, 0), v(i, j + 1, 0), v(i + 1, j + 1, 0), v(i + 1, j, 0));
    }
    const wall = (a, b) => quad(v(...a, 0), v(...b, 0), v(...b, 1), v(...a, 1));   // a -> b with the solid on the left
    for (const [a, b] of [[[0, 0], [1, 0]], [[1, 0], [2, 0]], [[2, 0], [3, 0]], [[3, 0], [3, 1]], [[3, 1], [3, 2]], [[3, 2], [3, 3]],
      [[3, 3], [2, 3]], [[2, 3], [1, 3]], [[1, 3], [0, 3]], [[0, 3], [0, 2]], [[0, 2], [0, 1]], [[0, 1], [0, 0]],
      [[1, 1], [1, 2]], [[1, 2], [2, 2]], [[2, 2], [2, 1]], [[2, 1], [1, 1]]]) wall(a, b);
    return { verts, tris };
  }

  // parts = [{ key, name, hex, verts, tris }]: the tree's colour parts, then 'base'.
  // opt = { baseCubes: base thickness in cubes, clear: socket clearance (mm), gap: spacing on the bed (mm) }
  const DEFAULTS = { baseCubes: 2, clear: 0.2, gap: 6 };
  function buildParts(model, s, colours, merge, options) {
    const opt = Object.assign({}, DEFAULTS, options), grid = printGrid(model, merge), F = model.F;
    // the peg reaches 0.4 mm short of the bottom of the base
    const zOf = p => p <= F ? p * s : F * s + opt.baseCubes * s - 0.4;
    const parts = PART_ORDER.filter(k => !(merge && merge[k])).map(k => Object.assign({ key: k }, colours[k], shell(grid, model.N, ID[k], s, zOf)))
      .filter(p => p.tris.length);
    const base = colours.base || colours.light;
    parts.push(Object.assign({ key: 'base', name: base.name, hex: base.hex }, baseMesh(model, s, opt, model.N * s + opt.gap)));
    return parts;
  }

  // ---- binary STL ----
  function stl(part) {
    const n = part.tris.length / 3, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
    const head = 'SakuraQR ' + part.name;
    for (let i = 0; i < 80; i++) dv.setUint8(i, i < head.length ? head.charCodeAt(i) & 0x7f : 32);
    dv.setUint32(80, n, true);
    const V = part.verts;
    for (let t = 0; t < n; t++) {
      const o = 84 + t * 50, a = part.tris[t * 3] * 3, b = part.tris[t * 3 + 1] * 3, c = part.tris[t * 3 + 2] * 3;
      const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
      for (let j = 0; j < 3; j++) { const v = part.tris[t * 3 + j] * 3; dv.setFloat32(o + 12 + j * 12, V[v], true); dv.setFloat32(o + 16 + j * 12, V[v + 1], true); dv.setFloat32(o + 20 + j * 12, V[v + 2], true); }
      dv.setUint16(o + 48, 0, true);
    }
    return new Uint8Array(buf);
  }

  // ---- 3MF (core spec): one object per colour, grouped as components of a single build item ----
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = x => (Math.round(x * 1000) / 1000).toString();
  function model3mf(parts, title) {
    const out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n');
    out.push(' <metadata name="Title">' + esc(title) + '</metadata>\n <metadata name="Application">SakuraQR</metadata>\n <resources>\n  <basematerials id="1">\n');
    for (const p of parts) out.push('   <base name="' + esc(p.name) + '" displaycolor="' + p.hex.toUpperCase() + 'FF"/>\n');
    out.push('  </basematerials>\n');
    parts.forEach((p, i) => {
      out.push('  <object id="' + (i + 2) + '" type="model" name="' + esc(p.name) + '" pid="1" pindex="' + i + '">\n   <mesh>\n    <vertices>\n');
      const V = p.verts, chunk = [];
      for (let v = 0; v < V.length; v += 3) chunk.push('     <vertex x="' + num(V[v]) + '" y="' + num(V[v + 1]) + '" z="' + num(V[v + 2]) + '"/>\n');
      out.push(chunk.join(''), '    </vertices>\n    <triangles>\n');
      const T = p.tris, tc = [];
      for (let t = 0; t < T.length; t += 3) tc.push('     <triangle v1="' + T[t] + '" v2="' + T[t + 1] + '" v3="' + T[t + 2] + '"/>\n');
      out.push(tc.join(''), '    </triangles>\n   </mesh>\n  </object>\n');
    });
    const tree = parts.map((p, i) => i).filter(i => parts[i].key !== 'base'), gid = parts.length + 2;
    out.push('  <object id="' + gid + '" type="model" name="' + esc(title) + '">\n   <components>\n');
    tree.forEach(i => out.push('    <component objectid="' + (i + 2) + '"/>\n'));
    out.push('   </components>\n  </object>\n </resources>\n <build>\n  <item objectid="' + gid + '"/>\n');
    parts.forEach((p, i) => { if (p.key === 'base') out.push('  <item objectid="' + (i + 2) + '"/>\n'); });
    out.push(' </build>\n</model>\n');
    return out.join('');
  }
  const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>\n';
  const RELS = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>\n';

  // ---- minimal ZIP writer (stored, no compression) ----
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = u8 => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const utf8 = s => new TextEncoder().encode(s);
  function zip(files) { // [{ name, data: Uint8Array | string }]
    const chunks = [], central = []; let offset = 0;
    const d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const name = utf8(f.name), data = typeof f.data === 'string' ? utf8(f.data) : f.data, crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = chunks.concat(central, [new Uint8Array(end.buffer)]);
    const total = all.reduce((a, c) => a + c.length, 0), out = new Uint8Array(total); let p = 0;
    for (const c of all) { out.set(c, p); p += c.length; }
    return out;
  }

  function to3MF(parts, title) {
    return zip([
      { name: '[Content_Types].xml', data: CONTENT_TYPES },
      { name: '_rels/.rels', data: RELS },
      { name: '3D/3dmodel.model', data: model3mf(parts, title) }
    ]);
  }
  function toSTLZip(parts, base) {
    return zip(parts.map(p => ({ name: base + '-' + p.key + '.stl', data: stl(p) })));
  }

  // top view as pixels: the colour of the highest cube in every column, `px` pixels per module
  function topViewCanvas(model, hex, px, doc) {
    const { N, KMAX } = model, cv = (doc || document).createElement('canvas');
    cv.width = cv.height = N * px; const g = cv.getContext('2d');
    const top = new Array(N * N).fill(null);
    for (const cb of model.cubes) { const i = cb.r * N + cb.c; if (!top[i] || cb.k >= top[i].k) top[i] = cb; }
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { g.fillStyle = hex[top[r * N + c].color]; g.fillRect(c * px, r * px, px, px); }
    return cv;
  }

  // edges shared by != 2 triangles (0 for a clean closed manifold)
  function audit(part) {
    const e = new Map(), T = part.tris;
    for (let t = 0; t < T.length; t += 3) for (let j = 0; j < 3; j++) {
      const a = T[t + j], b = T[t + (j + 1) % 3], key = a < b ? a + '_' + b : b + '_' + a;
      e.set(key, (e.get(key) || 0) + 1);
    }
    let open = 0, nonManifold = 0; for (const v of e.values()) { if (v === 1) open++; else if (v > 2) nonManifold++; }
    return { triangles: T.length / 3, open, nonManifold };
  }

  return { buildParts, to3MF, toSTLZip, stl, model3mf, zip, topViewCanvas, audit, pieceFaces, coverage, printGrid };
})();
if (typeof module !== 'undefined') module.exports = SakuraExport;
