// SakuraQR exporter: per-colour closed voxel shells -> multi-colour 3MF, per-colour binary STL (zipped),
// and a crisp top-view PNG for scan testing.
//
// Print coordinates: X = column, Y = flipped row, Z = level, all in millimetres, so that looking down
// on the print bed shows the QR code the right way round (not mirrored).
const SakuraExport = (function () {
  const PART_ORDER = ['dark', 'light', 'wood'];

  // colour of every cell (k = 0 is the plate) and the chamfer piece in it, if any.
  // `merge` maps a colour onto another (e.g. wood -> light for 2 colours)
  function colourGrid(model, merge) {
    const { N, KMAX } = model, g = new Uint8Array(N * N * (KMAX + 2)), pieces = new Map();
    const id = { dark: 1, light: 2, wood: 3 };
    for (const cb of model.cubes.concat(model.chamfers || [])) {
      const i = (cb.k * N + cb.r) * N + cb.c;
      g[i] = id[(merge && merge[cb.color]) || cb.color];
      if (cb.shape) pieces.set(i, cb);
    }
    return { g, pieces };
  }

  // Which part of a cell face a cell covers. A face is split into four quarter triangles around its centre, one per
  // cell edge: bit 2j (or 2j + 1) is the quarter on the low (high) edge of the face's j-th tangent axis.
  // A cube covers whole faces; a chamfer piece covers half of some side faces (cut along a diagonal).
  const TANGENTS = [[1, 2], [0, 2], [0, 1]];
  const QUARTERS = [[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[0, 0], [1, 0]], [[0, 1], [1, 1]]];   // outer edge, as (u, v)
  const quarter = (axis, tAxis, sign) => 1 << (2 * TANGENTS[axis].indexOf(tAxis) + (sign > 0 ? 1 : 0));
  const leanAxis = ([dc, dr]) => dc ? [0, dc] : [1, dr];
  function coverage(piece, axis, sign) {
    if (!piece) return 15;
    if (axis === 2) return sign > 0 ? 15 : 0;
    if (piece.shape === 'corner') {   // z ≥ max(distance from its two inner faces)
      const [dx, dy] = piece.lean[0];
      if (axis === 0 && sign === dx) return quarter(0, 1, dy) | quarter(0, 2, 1);
      if (axis === 1 && sign === dy) return quarter(1, 0, dx) | quarter(1, 2, 1);
      return 0;
    }
    let m = 0;                        // wedge: z ≥ min(distance from each face it leans on)
    for (const l of piece.lean) {
      const [la, ls] = leanAxis(l);
      if (la === axis && ls === sign) return 15;
      if (la !== axis) m |= quarter(axis, la, ls) | quarter(axis, 2, 1);
    }
    return m;
  }
  // the surface of a chamfer piece that is not a whole cell face (for the preview): its sloped underside and the
  // half-covered side faces, as polygons in cell-local (c, r, k), each with its outward normal
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
  // the sloped underside of a chamfer piece as polygons in cell-local (c, r, k), each with its outward normal
  function slopes(piece) {
    const at = (sign, t) => sign > 0 ? 1 - t : t;            // t = distance from the face on that side
    const P = (a, ta, b, tb, z) => { const p = [0, 0, z]; p[a[0]] = at(a[1], ta); p[b[0]] = at(b[1], tb); return p; };
    const nrm = ([axis, sign]) => { const v = [0, 0, -1]; v[axis] = -sign; return v; };
    if (piece.shape === 'corner') {
      const [dx, dy] = piece.lean[0], X = [0, dx], Y = [1, dy];
      return [
        { n: nrm(X), p: [P(X, 0.5, Y, 0, 0.5), P(X, 1, Y, 0, 1), P(X, 1, Y, 1, 1), P(X, 0, Y, 0, 0)] },
        { n: nrm(Y), p: [P(X, 0, Y, 0.5, 0.5), P(X, 0, Y, 1, 1), P(X, 1, Y, 1, 1), P(X, 0, Y, 0, 0)] }
      ];
    }
    if (piece.lean.length === 1) {
      const A = leanAxis(piece.lean[0]), U = [1 - A[0], -1];
      return [
        { n: nrm(A), p: [P(A, 0, U, 0, 0), P(A, 0.5, U, 0, 0.5), P(A, 0.5, U, 1, 0.5), P(A, 0, U, 1, 0)] },
        { n: nrm(A), p: [P(A, 0.5, U, 0, 0.5), P(A, 1, U, 0, 1), P(A, 1, U, 1, 1), P(A, 0.5, U, 1, 0.5)] }
      ];
    }
    const A = leanAxis(piece.lean[0]), B = leanAxis(piece.lean[1]);   // valley: two wedges at right angles
    return [
      { n: nrm(A), p: [P(A, 0.5, B, 1, 0.5), P(A, 1, B, 1, 1), P(A, 0, B, 0, 0), P(A, 0, B, 1, 0)] },
      { n: nrm(B), p: [P(A, 1, B, 0.5, 0.5), P(A, 1, B, 1, 1), P(A, 0, B, 0, 0), P(A, 1, B, 0, 0)] }
    ];
  }

  // closed surface of every cell of one colour: emit each quarter face a cell of that colour covers and its
  // neighbour of the same colour does not, plus the sloped undersides of its chamfer pieces
  function shell(model, grid, colourId, s) {
    const { N, KMAX } = model, { g, pieces } = grid, verts = [], tris = [], index = new Map();
    const inside = (c, r, k) => c >= 0 && r >= 0 && k >= 0 && c < N && r < N && k <= KMAX;
    // vertices on a half-cube lattice; print X = c, Y = N - r (so the top view is not mirrored), Z = k
    const vid = p => {
      const key = p[0] * 2 + ',' + p[1] * 2 + ',' + p[2] * 2;
      let i = index.get(key);
      if (i === undefined) { i = verts.length / 3; verts.push(p[0] * s, (N - p[1]) * s, p[2] * s); index.set(key, i); }
      return i;
    };
    // triangle facing `n` (grid coordinates); the Y flip mirrors the mesh, so the winding is swapped on output
    const tri = (a, b, c, n) => {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const dot = (u[1] * v[2] - u[2] * v[1]) * n[0] + (u[2] * v[0] - u[0] * v[2]) * n[1] + (u[0] * v[1] - u[1] * v[0]) * n[2];
      if (dot > 0) tris.push(vid(a), vid(c), vid(b)); else tris.push(vid(a), vid(b), vid(c));
    };
    const poly = (p, n) => { for (let i = 2; i < p.length; i++) tri(p[0], p[i - 1], p[i], n); };
    for (let k = 0; k <= KMAX; k++) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const i = (k * N + r) * N + c;
      if (g[i] !== colourId) continue;
      const me = pieces.get(i), cell = [c, r, k];
      for (let axis = 0; axis < 3; axis++) for (const sign of [1, -1]) {
        const nb = cell.slice(); nb[axis] += sign;
        const j = inside(nb[0], nb[1], nb[2]) ? (nb[2] * N + nb[1]) * N + nb[0] : -1;
        const other = j >= 0 && g[j] === colourId ? coverage(pieces.get(j), axis, -sign) : 0;
        const show = coverage(me, axis, sign) & ~other;
        if (!show) continue;
        const [t0, t1] = TANGENTS[axis], n = [0, 0, 0]; n[axis] = sign;
        const pt = (u, v) => { const p = cell.slice(); if (sign > 0) p[axis] += 1; p[t0] += u; p[t1] += v; return p; };
        if (show === 15) { poly([pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1)], n); continue; }
        for (let b = 0; b < 4; b++) if (show & (1 << b)) tri(pt(...QUARTERS[b][0]), pt(...QUARTERS[b][1]), pt(0.5, 0.5), n);
      }
      if (me) for (const f of slopes(me)) poly(f.p.map(p => [p[0] + c, p[1] + r, p[2] + k]), f.n);
    }
    return { verts, tris };
  }

  // parts = [{ key, name, hex, verts, tris }]
  function buildParts(model, s, colours, merge) {
    const grid = colourGrid(model, merge);
    const id = { dark: 1, light: 2, wood: 3 };
    return PART_ORDER.filter(k => !(merge && merge[k])).map(k => Object.assign({ key: k }, colours[k], shell(model, grid, id[k], s)))
      .filter(p => p.tris.length);
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
    const gid = parts.length + 2;
    out.push('  <object id="' + gid + '" type="model" name="' + esc(title) + '">\n   <components>\n');
    parts.forEach((p, i) => out.push('    <component objectid="' + (i + 2) + '"/>\n'));
    out.push('   </components>\n  </object>\n </resources>\n <build>\n  <item objectid="' + gid + '"/>\n </build>\n</model>\n');
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

  return { buildParts, to3MF, toSTLZip, stl, model3mf, zip, topViewCanvas, audit, pieceFaces, coverage };
})();
if (typeof module !== 'undefined') module.exports = SakuraExport;
