// SakuraQR exporter: per-colour closed voxel shells -> multi-colour 3MF, per-colour binary STL (zipped),
// and a crisp top-view PNG for scan testing.
//
// Two layouts:
//  - 'one-piece': the tree standing on its plate. Print coordinates: X = column, Y = flipped row, Z = level, all in
//    millimetres, so that looking down on the print bed shows the QR code the right way round (not mirrored).
//  - 'split': the tree without its plate, turned upside down (about the X axis, so not mirrored) with its highest
//    cubes on the bed and a square peg on the trunk's end; next to it the base: the plate, a second plate layer under
//    it, the roots on top, and a square socket for the peg.
const SakuraExport = (function () {
  const PART_ORDER = ['dark', 'light', 'wood'];
  const ID = { dark: 1, light: 2, wood: 3 };

  // a block of cells: colour ids at (k * N + r) * N + c, levels k = 0 .. K - 1
  function cellGrid(N, K) {
    const g = new Uint8Array(N * N * K);
    return { N, K, g, set: (c, r, k, id) => { g[(k * N + r) * N + c] = id; } };
  }

  // closed surface of every cell of one colour: emit a face wherever the neighbour is not that colour.
  // place(c, r, k) maps a cell corner to print coordinates in cube units.
  // Every cube is grown by GROW mm on all sides first. QR patterns are full of cubes of one colour that touch only
  // along an edge or at a corner; as they are, those spots are edges with four faces (strict mesh checkers call them
  // broken faces), and splitting the vertices does not survive a reader that welds vertices by position (every STL
  // reader). Grown, such cubes overlap in a GROW*2 thick bridge, and the union of boxes that always overlap where they
  // touch is a clean closed surface. Neighbouring colours overlap by as much, which slicers clip.
  const GROW = 0.01;
  function shell(cells, colourId, s, place) {
    const { N, K, g } = cells, verts = [], tris = [], index = new Map();
    const at = (c, r, k) => (c < 0 || r < 0 || c >= N || r >= N || k < 0 || k >= K) ? 0 : g[(k * N + r) * N + c];
    // refined grid: along each axis, slab 2i is the thin layer [i - e, i + e] round lattice plane i, slab 2i + 1 the
    // inside [i + e, i + 1 - e] of cell i; a refined cell is filled if a grown cube of the colour covers it
    const n = 2 * N + 1, m = 2 * K + 1, cover = [];
    for (let x = 0; x < Math.max(n, m); x++) cover.push((x & 1) ? [x >> 1] : [(x >> 1) - 1, x >> 1]);
    const fine = new Uint8Array(n * n * m);
    for (let z = 0; z < m; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let on = 0;
      for (const k of cover[z]) for (const r of cover[y]) for (const c of cover[x]) if (at(c, r, k) === colourId) on = 1;
      fine[(z * n + y) * n + x] = on;
    }
    const filled = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < n && y < n && z < m && fine[(z * n + y) * n + x] === 1;
    const e = GROW / s, coord = i => (i >> 1) + ((i & 1) ? e : -e);   // refined plane i -> cube units
    const vid = p => {
      const key = p.join(',');
      let i = index.get(key);
      if (i === undefined) { const q = place(coord(p[0]), coord(p[1]), coord(p[2])); i = verts.length / 3; verts.push(q[0] * s, q[1] * s, q[2] * s); index.set(key, i); }
      return i;
    };
    // place() is an axis flip or shift; a flip turns a face's winding inside out
    const o = place(0, 0, 0), ax = [place(1, 0, 0), place(0, 1, 0), place(0, 0, 1)].map(v => v.map((x, j) => x - o[j]));
    const det = ax[0][0] * (ax[1][1] * ax[2][2] - ax[1][2] * ax[2][1]) - ax[0][1] * (ax[1][0] * ax[2][2] - ax[1][2] * ax[2][0]) + ax[0][2] * (ax[1][0] * ax[2][1] - ax[1][1] * ax[2][0]);
    const TAN = [[1, 2], [2, 0], [0, 1]];   // (t0, t1, axis) is right-handed
    for (let z = 0; z < m; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (!fine[(z * n + y) * n + x]) continue;
      for (let axis = 0; axis < 3; axis++) for (const sign of [1, -1]) {
        const nb = [x, y, z]; nb[axis] += sign;
        if (filled(nb[0], nb[1], nb[2])) continue;
        const [t0, t1] = TAN[axis], pt = (u, v) => { const p = [x, y, z]; if (sign > 0) p[axis] += 1; p[t0] += u; p[t1] += v; return p; };
        let q = [pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1)];   // counter-clockwise around +axis
        if (sign * det < 0) q = q.reverse();
        const ids = q.map(vid);
        tris.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
      }
    }
    return { verts, tris };
  }

  // an axis-aligned box in millimetres, faces outward
  function box(x0, y0, z0, x1, y1, z1) {
    const verts = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
    const q = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], tris = [];
    for (const [a, b, c, d] of q) tris.push(a, b, c, a, c, d);
    return { verts, tris };
  }

  // parts = [{ key, name, hex, verts, tris, object }], object 'tree' or 'base'.
  // `merge` maps a colour onto another (e.g. wood -> light for 2 colours).
  // opt = { layout: 'one-piece' | 'split', clear: peg clearance per side (mm), gap: tree-to-base spacing (mm),
  //         warp: optional map of the model's cube corners (c, r, k) to moved ones, e.g. perspectiveWarp }
  function buildParts(model, s, colours, merge, options) {
    const opt = Object.assign({ layout: 'one-piece', clear: 0.2, gap: 6, baseName: '底座' }, options);
    const { N, KMAX, kTopMax: T } = model, keys = PART_ORDER.filter(k => !(merge && merge[k]));
    const id = name => ID[(merge && merge[name]) || name];
    const wp = opt.warp || ((c, r, k) => [c, r, k]);   // warps keep k
    // grown cubes reach GROW below the bed: lift everything back onto it
    const lift = place => (c, r, k) => { const p = place(c, r, k); return [p[0], p[1], p[2] + GROW / s]; };
    const parts = (cells, place, object, suffix) => keys.map(k => Object.assign({ key: k, object }, colours[k], suffix ? { name: colours[k].name + suffix } : null, shell(cells, ID[k], s, lift(place))))
      .filter(p => p.tris.length);
    if (opt.layout !== 'split') {
      const cells = cellGrid(N, KMAX + 1);
      for (const cb of model.cubes) cells.set(cb.c, cb.r, cb.k, id(cb.color));
      return parts(cells, (c, r, k) => { const w = wp(c, r, k); return [w[0], N - w[1], k]; }, 'tree');
    }
    const trunk = new Set(model.trunkCells.map(([c, r]) => c + ',' + r)), isTrunk = cb => trunk.has(cb.c + ',' + cb.r);
    const root = cb => cb.k === 1 && cb.kind === 'wood' && !isTrunk(cb);
    // tree, upside down: level k prints at height T - k; Y runs the other way, so this is a turn, not a mirror
    const tree = cellGrid(N, T);
    for (const cb of model.cubes) if (cb.k >= 1 && !root(cb)) tree.set(cb.c, cb.r, T - cb.k, id(cb.color));
    const out = parts(tree, (c, r, k) => { const w = wp(c, r, T + 1 - k); return [w[0], w[1], k]; }, 'tree');
    // peg: the trunk's end, `clear` thinner on every side, 0.4 mm shorter than the socket is deep
    const c0 = Math.min(...model.trunkCells.map(t => t[0])), r0 = Math.min(...model.trunkCells.map(t => t[1]));
    const peg = box(c0 * s + opt.clear, r0 * s + opt.clear, T * s, (c0 + 2) * s - opt.clear, (r0 + 2) * s - opt.clear, T * s + 2 * s - 0.4);
    const pegColour = colours[(merge && merge.wood) || 'wood'];
    out.push(Object.assign({ key: 'peg', object: 'tree', name: pegColour.name + ' 榫头', hex: pegColour.hex }, peg));
    // base, the right way up: an extra plate layer, the plate, the roots; the trunk's cells stay open as the socket
    const base = cellGrid(N, 3), x0 = N + opt.gap / s;
    for (const cb of model.cubes) {
      if (cb.k === 0 && !isTrunk(cb)) { base.set(cb.c, cb.r, 0, id('light')); base.set(cb.c, cb.r, 1, id(cb.color)); }
      if (root(cb)) base.set(cb.c, cb.r, 2, id(cb.color));
    }
    return out.concat(parts(base, (c, r, k) => { const w = wp(c, r, k - 1); return [x0 + w[0], N - w[1], k]; }, 'base', ' · ' + opt.baseName));
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
    // one object per print piece (the tree, and the base when split), each grouping its colour parts
    const objects = [...new Set(parts.map(p => p.object || 'tree'))];
    objects.forEach((ob, j) => {
      out.push('  <object id="' + (parts.length + 2 + j) + '" type="model" name="' + esc(ob === 'tree' ? title : title + ' base') + '">\n   <components>\n');
      parts.forEach((p, i) => { if ((p.object || 'tree') === ob) out.push('    <component objectid="' + (i + 2) + '"/>\n'); });
      out.push('   </components>\n  </object>\n');
    });
    out.push(' </resources>\n <build>\n');
    objects.forEach((ob, j) => out.push('  <item objectid="' + (parts.length + 2 + j) + '"/>\n'));
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
    return zip(parts.map(p => ({ name: base + (p.object === 'base' ? '-base-' : '-') + p.key + '.stl', data: stl(p) })));
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
  // checked the way a reader sees the mesh: vertices closer than `weld` mm count as one (STL has no shared vertices)
  function audit(part, weld = 0.005) {
    const id = new Map(), V = part.verts, at = [];
    for (let i = 0; i < V.length; i += 3) {
      const k = [V[i], V[i + 1], V[i + 2]].map(x => Math.round(x / weld)).join();
      if (!id.has(k)) id.set(k, id.size);
      at.push(id.get(k));
    }
    const e = new Map(), T = part.tris.map(v => at[v]);
    for (let t = 0; t < T.length; t += 3) for (let j = 0; j < 3; j++) {
      const a = T[t + j], b = T[t + (j + 1) % 3], key = a < b ? a + '_' + b : b + '_' + a;
      e.set(key, (e.get(key) || 0) + 1);
    }
    let open = 0, nonManifold = 0; for (const v of e.values()) { if (v === 1) open++; else if (v > 2) nonManifold++; }
    // vertices whose triangles do not form one fan (joined through edges at that vertex)
    const fans = new Map();   // vertex -> triangles round it
    for (let t = 0; t < T.length; t += 3) for (let j = 0; j < 3; j++) { const v = T[t + j]; if (!fans.has(v)) fans.set(v, []); fans.get(v).push(t); }
    let badVerts = 0;
    for (const [v, ts] of fans) {
      const seen = new Set([ts[0]]), stack = [ts[0]];
      while (stack.length) {
        const t = stack.pop(), others = [T[t], T[t + 1], T[t + 2]].filter(x => x !== v);
        for (const u of ts) if (!seen.has(u) && [T[u], T[u + 1], T[u + 2]].some(x => others.includes(x))) { seen.add(u); stack.push(u); }
      }
      if (seen.size !== ts.length) badVerts++;
    }
    return { triangles: T.length / 3, open, nonManifold, badVerts };
  }

  return { buildParts, to3MF, toSTLZip, stl, model3mf, zip, topViewCanvas, audit };
})();
if (typeof module !== 'undefined') module.exports = SakuraExport;
