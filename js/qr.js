// Minimal QR encoder (versions 1-6, byte or alphanumeric mode, ECC L/M/Q/H, any of the 8 masks).
const QR = (function () {
  const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
  // [ecCodewordsPerBlock, blocksG1, dataPerBlockG1, blocksG2, dataPerBlockG2] by version, then L,M,Q,H
  const EC = {
    1: { L: [7, 1, 19, 0, 0], M: [10, 1, 16, 0, 0], Q: [13, 1, 13, 0, 0], H: [17, 1, 9, 0, 0] },
    2: { L: [10, 1, 34, 0, 0], M: [16, 1, 28, 0, 0], Q: [22, 1, 22, 0, 0], H: [28, 1, 16, 0, 0] },
    3: { L: [15, 1, 55, 0, 0], M: [26, 1, 44, 0, 0], Q: [18, 2, 17, 0, 0], H: [22, 2, 13, 0, 0] },
    4: { L: [20, 1, 80, 0, 0], M: [18, 2, 32, 0, 0], Q: [26, 2, 24, 0, 0], H: [16, 4, 9, 0, 0] },
    5: { L: [26, 1, 108, 0, 0], M: [24, 2, 43, 0, 0], Q: [18, 2, 15, 2, 16], H: [22, 2, 11, 2, 12] },
    6: { L: [18, 2, 68, 0, 0], M: [16, 4, 27, 0, 0], Q: [24, 4, 19, 0, 0], H: [28, 4, 15, 0, 0] }
  };
  const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };
  const ECBITS = { L: 1, M: 0, Q: 3, H: 2 };
  // GF(256)
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => a && b ? EXP[LOG[a] + LOG[b]] : 0;
  function rsGen(n) { let g = [1]; for (let i = 0; i < n; i++) { const ng = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= mul(g[j], EXP[i]); } g = ng; } return g; }
  function rsEncode(data, n) { const g = rsGen(n), res = data.concat(new Array(n).fill(0)); for (let i = 0; i < data.length; i++) { const f = res[i]; if (f) for (let j = 0; j < g.length; j++) res[i + j] ^= mul(g[j], f); } return res.slice(data.length); }

  const isAlnum = s => [...s].every(ch => ALNUM.includes(ch));
  function bitsFor(text, mode, ver) {
    const bits = [];
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
    if (mode === 'alnum') {
      put(2, 4); put(text.length, ver < 10 ? 9 : 11);
      for (let i = 0; i < text.length; i += 2) {
        if (i + 1 < text.length) put(ALNUM.indexOf(text[i]) * 45 + ALNUM.indexOf(text[i + 1]), 11);
        else put(ALNUM.indexOf(text[i]), 6);
      }
    } else {
      const bytes = Array.from(new TextEncoder().encode(text));
      put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); for (const b of bytes) put(b, 8);
    }
    return bits;
  }
  function capacity(ver, ecc) { const e = EC[ver][ecc]; return e[1] * e[2] + e[3] * e[4]; }

  function encode(text, { ecc = 'M', mode = 'auto', version = 0, mask = -1 } = {}) {
    if (mode === 'auto') mode = isAlnum(text) ? 'alnum' : 'byte';
    let ver = version, bits;
    for (let v = version || 1; v <= 6; v++) { bits = bitsFor(text, mode, v); if (bits.length <= capacity(v, ecc) * 8) { ver = v; break; } if (version) break; }
    if (!ver || bits.length > capacity(ver, ecc) * 8) throw new Error('too long');
    const cap = capacity(ver, ecc) * 8;
    for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let p = 0; data.length < cap / 8; p++) data.push(p % 2 ? 0x11 : 0xEC);
    // blocks + ECC + interleave
    const e = EC[ver][ecc], blocks = []; let off = 0;
    for (let g = 0; g < 2; g++) for (let b = 0; b < e[1 + g * 2]; b++) { const d = data.slice(off, off + e[2 + g * 2]); off += d.length; blocks.push({ d, ec: rsEncode(d, e[0]) }); }
    const cw = [];
    const maxD = Math.max(...blocks.map(b => b.d.length));
    for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d.length) cw.push(b.d[i]);
    for (let i = 0; i < e[0]; i++) for (const b of blocks) cw.push(b.ec[i]);
    const n = 17 + 4 * ver;
    const best = [];
    for (let m = 0; m < 8; m++) if (mask < 0 || m === mask) best.push(build(n, ver, ecc, cw, m));
    return mask >= 0 ? best[0] : best; // a single matrix, or all 8 candidates
  }

  function build(n, ver, ecc, cw, mask) {
    const M = Array.from({ length: n }, () => new Array(n).fill(0)), F = Array.from({ length: n }, () => new Array(n).fill(false));
    const set = (r, c, v) => { M[r][c] = v ? 1 : 0; F[r][c] = true; };
    const finder = (r0, c0) => { for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) { const rr = r0 + r, cc = c0 + c; if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue; const on = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)); set(rr, cc, on); } };
    finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
    for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const al = ALIGN[ver];
    const last = al.length - 1;
    for (let a = 0; a < al.length; a++) for (let b = 0; b < al.length; b++) { if ((a === 0 && b === 0) || (a === 0 && b === last) || (a === last && b === 0)) continue; const r = al[a], c = al[b]; for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1); }
    set(4 * ver + 9, 8, 1);
    // reserve format areas
    for (let i = 0; i < 9; i++) { if (!F[8][i]) set(8, i, 0); if (!F[i][8]) set(i, 8, 0); }
    for (let i = 0; i < 8; i++) { if (!F[8][n - 1 - i]) set(8, n - 1 - i, 0); if (!F[n - 1 - i][8]) set(n - 1 - i, 8, 0); }
    // data
    const bits = []; for (const b of cw) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
    let bi = 0, up = true;
    for (let c = n - 1; c > 0; c -= 2) {
      if (c === 6) c--;
      for (let i = 0; i < n; i++) { const r = up ? n - 1 - i : i; for (const cc of [c, c - 1]) { if (F[r][cc]) continue; M[r][cc] = bi < bits.length ? bits[bi++] : 0; } }
      up = !up;
    }
    const maskFn = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
      (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
      (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0, (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0][mask];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!F[r][c] && maskFn(r, c)) M[r][c] ^= 1;
    // format info
    let fmt = (ECBITS[ecc] << 3) | mask, rem = fmt << 10;
    for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
    const fbits = ((fmt << 10) | rem) ^ 0x5412;
    const fb = i => (fbits >> i) & 1;
    for (let i = 0; i <= 5; i++) M[i][8] = fb(i);
    M[7][8] = fb(6); M[8][8] = fb(7); M[8][7] = fb(8);
    for (let i = 9; i < 15; i++) M[8][14 - i] = fb(i);
    for (let i = 0; i < 8; i++) M[8][n - 1 - i] = fb(i);
    for (let i = 8; i < 15; i++) M[n - 15 + i][8] = fb(i);
    M[n - 8][8] = 1;
    return { matrix: M.map(row => row.map(v => !!v)), n, version: ver, ecc, mask };
  }
  return { encode, isAlnum, capacity };
})();
if (typeof module !== 'undefined') module.exports = QR;
