(function () {
  const PINKS = { sakura: ['樱粉', '#E46F9C'], rouge: ['胭脂粉', '#D9527F'], deep: ['深樱', '#C93A72'], rose: ['玫粉', '#B92E62'] };
  const LIGHTS = { blush: ['浅粉', '#FAD6E2'], petal: ['花瓣粉', '#F7C6D6'], white: ['白', '#F5F2EF'] };
  const COLORS = { brown: '#6E4A34' };
  const FIXED = { maxLedge: 2 };
  const state = { text: '', ecc: 'Q', upper: true, mask: -1, onCanopy: false, dome: 6, module: 4, trunk: 9, crown: 1, squash: 0.7, lobes: 4, puff: 0.85, rough: 1, ledge: '2', layout: 'one-piece', clear: 0.2, wood: 'brown', pink: 'rouge', light: 'blush', view: 'orbit', dist: 200, off: 0, seedAdd: 0 };
  const $ = id => document.getElementById(id);
  let T = null, renderer, scanRenderer, scene, group, dirLight, orbitCam, topCam, phoneCam, model = null, needsRender = true;
  let blockMesh = null, blockMat = null, geomTags = null;
  const orbit = { theta: 0.72, phi: 1.1, radius: 400, init: false };
  const S = () => state.module;

  function loadScript(urls) {
    return new Promise((resolve, reject) => {
      let i = 0;
      const next = () => {
        if (i >= urls.length) return reject(new Error('load failed: ' + urls[0]));
        const s = document.createElement('script'); s.src = urls[i++]; s.async = false;
        s.onload = resolve; s.onerror = () => { s.remove(); next(); };
        document.head.appendChild(s);
      };
      next();
    });
  }

  // ---------- UI ----------
  function bindSeg(id, key, onChange) {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      state[key] = b.dataset.v;
      $(id).querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      (onChange || schedule)();
    });
  }
  function bindRange(id, key, fmt, full = true) {
    const el = $(id), out = $(id + 'Val');
    const upd = () => { state[key] = parseFloat(el.value); if (out) out.textContent = fmt(state[key]); };
    upd();
    el.addEventListener('input', () => { upd(); full ? schedule() : scheduleScan(true); });
  }
  bindSeg('ecc', 'ecc'); bindSeg('ledge', 'ledge'); bindSeg('layout', 'layout', () => { updateLayout(); updateStats(); }); bindSeg('wood', 'wood', () => applyColors());
  bindRange('module', 'module', v => v + ' mm');
  bindRange('trunk', 'trunk', v => v + ' 格');
  bindRange('crown', 'crown', v => Math.round(v * 100) + '%');
  bindRange('squash', 'squash', v => v.toFixed(2));
  bindRange('lobes', 'lobes', v => String(v));
  bindRange('rough', 'rough', v => v.toFixed(2));
  bindRange('puff', 'puff', v => v.toFixed(2));
  bindRange('dome', 'dome', v => v + ' 格');
  bindRange('mask', 'mask', v => v < 0 ? '自动' : '第 ' + v + ' 号');
  $('upper').addEventListener('change', e => { state.upper = e.target.checked; schedule(); });
  $('oncanopy').addEventListener('change', e => { state.onCanopy = e.target.checked; schedule(); });
  bindRange('dist', 'dist', v => v + ' cm', false);
  bindRange('off', 'off', v => v + ' mm', false);
  bindRange('clear', 'clear', v => v.toFixed(2) + ' mm', false);
  $('clear').addEventListener('input', () => updateStats());
  $('reseed').addEventListener('click', () => { state.seedAdd++; schedule(); });
  $('txt').addEventListener('input', schedule);
  $('panel').addEventListener('submit', e => e.preventDefault());
  function swatches(wrapId, table, key) {
    const wrap = $(wrapId);
    for (const [k, [name, hex]] of Object.entries(table)) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sw'; b.id = wrapId + '-' + k; b.style.background = hex; b.title = name; b.setAttribute('aria-label', name);
      b.setAttribute('aria-pressed', String(k === state[key]));
      b.addEventListener('click', () => { state[key] = k; wrap.querySelectorAll('.sw').forEach(x => x.setAttribute('aria-pressed', String(x === b))); applyColors(); });
      wrap.appendChild(b);
    }
  }
  swatches('pinks', PINKS, 'pink');
  swatches('lights', LIGHTS, 'light');
  document.querySelectorAll('.viewtabs button').forEach(b => b.addEventListener('click', () => {
    state.view = b.dataset.view;
    document.querySelectorAll('.viewtabs button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    $('hint').textContent = state.view === 'orbit' ? '拖动旋转 · 双指或滚轮缩放'
      : state.view === 'top' ? '无透视的正俯视，相当于从无限远处看'
      : '和扫描器同一个机位：手机水平朝下，高度和偏移见下方滑块';
    $('viewer').style.touchAction = state.view === 'orbit' ? 'none' : 'pan-y';
    needsRender = true;
  }));

  let tBuild = 0, tScan = 0;
  function schedule() { clearTimeout(tBuild); tBuild = setTimeout(rebuild, 150); }
  function scheduleScan(rerender) { if (rerender) needsRender = true; clearTimeout(tScan); tScan = setTimeout(runScan, 160); }

  // ---------- QR ----------
  // URL -> upper case when that is safe (scheme + host only, or path already upper case)
  function prepareText(raw) {
    const m = raw.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/?#]*)(.*)$/);
    if (!state.upper) return { text: raw, note: '' };
    if (!m) return { text: raw, note: '不是网址，保持原样。' };
    const rest = m[3];
    if (rest && rest !== '/' && rest !== rest.toUpperCase()) return { text: raw, note: '网址带区分大小写的路径，保持原样。' };
    const up = raw.toUpperCase();
    if (!QR.isAlnum(up)) return { text: raw, note: '含有字母数字模式不支持的字符，保持原样。' };
    return { text: up, note: '实际编码：' + up };
  }
  // pick the mask whose canopy pattern has the fewest lonely pixels (single cells unlike all 4 neighbours)
  function lonely(mat) {
    const n = mat.length; let k = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const v = mat[r][c]; let same = 0;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const rr = r + dr, cc = c + dc; if (rr >= 0 && cc >= 0 && rr < n && cc < n && mat[rr][cc] === v) same++; }
      if (same === 0) k++;
    }
    return k;
  }
  function makeMatrix(text, ecc) {
    const cands = QR.encode(text, { ecc });
    let pick;
    if (state.mask >= 0) pick = cands.find(x => x.mask === state.mask);
    else { pick = cands[0]; let best = Infinity; for (const x of cands) { const s = lonely(x.matrix); if (s < best) { best = s; pick = x; } } }
    const mode = QR.isAlnum(text) ? '字母数字模式' : '字节模式';
    return { mat: pick.matrix, n: pick.n, version: pick.version, mask: pick.mask, mode, bytes: new TextEncoder().encode(text).length };
  }

  // ---------- voxel mesh (only faces that touch air) ----------
  const hexRGB = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const jit = (a, b, c) => { let h = (a * 374761393 + b * 668265263 + c * 1274126177) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295 - 0.5; };
  const FACES = [
    { n: [0, 1, 0], q: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] },   // top (+k)
    { n: [0, -1, 0], q: [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]] }, // bottom
    { n: [1, 0, 0], q: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]] },
    { n: [-1, 0, 0], q: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]] },
    { n: [0, 0, 1], q: [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]] },   // +row
    { n: [0, 0, -1], q: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] }  // -row
  ];
  function buildBlocks(m) {
    const s = S(), N = m.N, off = -N * s / 2, pos = [], nor = [], col = [], tags = [];
    const idx = (c, r, k) => (k * N + r) * N + c;
    const filled = (c, r, k) => c >= 0 && r >= 0 && c < N && r < N && k >= 0 && (k === 0 || (k <= m.KMAX && m.vox[idx(c, r, k)] !== 0));
    for (const cb of m.cubes) {
      const sh = 1 + jit(cb.c, cb.r, cb.k) * (cb.kind === 'plate' ? 0 : cb.color === 'dark' ? 0.16 : 0.05);
      const tagv = cb.color === 'dark' ? sh : cb.color === 'wood' ? 10 + sh : (cb.kind === 'plate' ? -1 : 20 + sh);
      for (const F of FACES) {
        if (filled(cb.c + F.n[0], cb.r + F.n[2], cb.k + F.n[1])) continue;
        const quad = F.q.map(([x, y, z]) => [off + (cb.c + x) * s, (cb.k + y) * s, off + (cb.r + z) * s]);
        for (const p of [quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]]) { pos.push(p[0], p[1], p[2]); nor.push(F.n[0], F.n[1], F.n[2]); col.push(1, 1, 1); tags.push(tagv); }
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    // fix winding so every face points outward
    const P = g.getAttribute('position').array, Nn = g.getAttribute('normal').array;
    for (let i = 0; i < P.length; i += 9) {
      const ux = P[i + 3] - P[i], uy = P[i + 4] - P[i + 1], uz = P[i + 5] - P[i + 2], vx = P[i + 6] - P[i], vy = P[i + 7] - P[i + 1], vz = P[i + 8] - P[i + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      if (cx * Nn[i] + cy * Nn[i + 1] + cz * Nn[i + 2] < 0) for (let k = 0; k < 3; k++) { const t = P[i + 3 + k]; P[i + 3 + k] = P[i + 6 + k]; P[i + 6 + k] = t; }
    }
    g.computeBoundingSphere();
    geomTags = tags;
    return g;
  }
  function applyColors() {
    if (!blockMesh) return;
    const pink = hexRGB(PINKS[state.pink][1]), base = hexRGB(LIGHTS[state.light][1]), white = base, wood = hexRGB(state.wood === 'brown' ? COLORS.brown : LIGHTS[state.light][1]);
    const ca = blockMesh.geometry.getAttribute('color');
    for (let i = 0; i < geomTags.length; i++) {
      const t = geomTags[i];
      const c = t < 0 ? base : t >= 20 ? white.map(v => Math.min(1, v * (t - 20))) : t >= 10 ? wood.map(v => Math.min(1, v * (t - 10))) : pink.map(v => Math.min(1, v * t));
      ca.setXYZ(i, c[0], c[1], c[2]);
    }
    ca.needsUpdate = true;
    updateContrast(); updateStats();
    needsRender = true; scheduleScan(false);
  }

  function initThree() {
    renderer = new T.WebGLRenderer({ canvas: $('gl'), antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    const sc = document.createElement('canvas'); sc.width = sc.height = 480;
    scanRenderer = new T.WebGLRenderer({ canvas: sc, antialias: true, preserveDrawingBuffer: true });
    scanRenderer.setPixelRatio(1); scanRenderer.setSize(480, 480, false);
    scanRenderer.shadowMap.enabled = false; // scanner assumes soft, even room light
    scanRenderer.setClearColor(0x968f8b, 1);
    scene = new T.Scene();
    scene.add(new T.HemisphereLight(0xffffff, 0xd8cfd3, 0.72));
    dirLight = new T.DirectionalLight(0xffffff, 0.36);
    dirLight.position.set(-140, 320, -100); dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048); dirLight.shadow.bias = -0.0008;
    scene.add(dirLight); scene.add(dirLight.target);
    const ground = new T.Mesh(new T.PlaneGeometry(6000, 6000), new T.ShadowMaterial({ opacity: 0.12 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; ground.receiveShadow = true; scene.add(ground);
    blockMat = new T.MeshLambertMaterial({ vertexColors: true });
    group = new T.Group(); scene.add(group);
    orbitCam = new T.PerspectiveCamera(30, 1, 1, 20000);
    topCam = new T.OrthographicCamera(-100, 100, 100, -100, 1, 20000);
    phoneCam = new T.PerspectiveCamera(40, 1, 1, 20000);
    setupPointer();
    new ResizeObserver(resize).observe($('viewer'));
    resize();
    requestAnimationFrame(loop);
  }
  function resize() {
    const v = $('viewer'), w = v.clientWidth, h = v.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); needsRender = true;
  }
  const W = () => model.N * S();
  const H = () => (model.kTopMax + 1) * S();
  const clampR = r => model ? Math.min(W() * 7, Math.max(W() * 1.1, r)) : r;
  function setupPointer() {
    const el = $('viewer'), pts = new Map(); let pinch0 = 0, r0 = 0;
    el.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; el.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); r0 = orbit.radius; } });
    el.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (state.view !== 'orbit') return;
      if (pts.size === 1) {
        orbit.theta -= (e.clientX - prev[0]) * 0.008;
        orbit.phi = Math.min(1.55, Math.max(0.08, orbit.phi - (e.clientY - prev[1]) * 0.008));
      } else if (pts.size === 2 && pinch0) {
        const [a, b] = [...pts.values()]; orbit.radius = clampR(r0 * pinch0 / Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])));
      }
      needsRender = true;
    });
    const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch0 = 0; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => { if (state.view !== 'orbit') return; e.preventDefault(); orbit.radius = clampR(orbit.radius * (1 + e.deltaY * 0.0012)); needsRender = true; }, { passive: false });
  }
  function placePhone(cam, aspect) {
    const D = state.dist * 10, off = state.off;
    cam.aspect = aspect;
    cam.fov = 2 * Math.atan(((W() / 2 + off) / 0.85) / D) * 180 / Math.PI / Math.min(1, aspect);
    cam.position.set(off, D, 0); cam.up.set(0, 0, -1); cam.lookAt(off, 0, 0); cam.updateProjectionMatrix();
  }
  function placeTop(cam, aspect, margin) {
    const half = W() / 2 * margin;
    cam.left = -half * Math.max(1, aspect); cam.right = half * Math.max(1, aspect);
    cam.top = half / Math.min(1, aspect); cam.bottom = -half / Math.min(1, aspect);
    cam.position.set(0, 5000, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix();
  }
  function loop() {
    if (needsRender && model) {
      const c = renderer.domElement, aspect = c.width / c.height || 1;
      if (state.view === 'orbit') {
        const tgt = new T.Vector3(0, H() * 0.48, 0), { theta, phi, radius } = orbit;
        orbitCam.aspect = aspect; orbitCam.updateProjectionMatrix();
        orbitCam.position.set(radius * Math.sin(phi) * Math.sin(theta), tgt.y + radius * Math.cos(phi), radius * Math.sin(phi) * Math.cos(theta));
        orbitCam.lookAt(tgt);
        renderer.render(scene, orbitCam);
      } else if (state.view === 'top') { placeTop(topCam, aspect, 1.08); renderer.render(scene, topCam); }
      else { placePhone(phoneCam, aspect); renderer.render(scene, phoneCam); }
      needsRender = false;
    }
    requestAnimationFrame(loop);
  }

  // ---------- scanning ----------
  const work = document.createElement('canvas'); work.width = work.height = 480;
  const wctx = work.getContext('2d', { willReadFrequently: true });
  function decodeWith(cam) {
    scanRenderer.render(scene, cam);
    wctx.drawImage(scanRenderer.domElement, 0, 0);
    const img = wctx.getImageData(0, 0, 480, 480);
    return jsQR(img.data, 480, 480, { inversionAttempts: 'dontInvert' });
  }
  // worst misregistration (in modules) between each visible blossom and its own code cell, seen from the phone
  function misregistration() {
    const s = S(), N = model.N, D = state.dist * 10, ox = state.off; let worst = 0;
    const tf = model.topK[model.q * N + model.q], zr = tf > 0 ? (tf + 1) * s : s;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (model.topK[r * N + c] <= 0 || c < model.q || r < model.q || c >= model.q + model.n || r >= model.q + model.n) continue;
      const zTop = (model.topK[r * N + c] + 1) * s, k = (D - zr) / (D - zTop);
      const cx = (c + 0.5 - N / 2) * s, cy = (r + 0.5 - N / 2) * s;
      const px = ox + (cx - ox) * k, py = cy * k;
      worst = Math.max(worst, Math.hypot(px - cx, py - cy) / s);
    }
    return worst;
  }
  function setChip(id, cls, text) { const el = $(id); el.className = 'chip' + (cls ? ' ' + cls : ''); el.textContent = text; }
  const escapeHTML = s => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  function runScan() {
    if (!model) return;
    const target = state.encoded;
    const oc = new T.OrthographicCamera(-1, 1, 1, -1, 1, 20000); placeTop(oc, 1, 1.15);
    const r1 = decodeWith(oc);
    const pc = new T.PerspectiveCamera(40, 1, 1, 20000); placePhone(pc, 1);
    const r2 = decodeWith(pc);
    $('scanThumb').getContext('2d').drawImage(scanRenderer.domElement, 0, 0, 224, 224);
    const ok1 = !!r1 && r1.data === target, ok2 = !!r2 && r2.data === target;
    setChip('chipOrtho', ok1 ? 'ok' : 'bad', ok1 ? '正俯视 可识别' : '正俯视 失败');
    setChip('chipPhone', ok2 ? 'ok' : 'bad', '手机 ' + (state.dist / 100).toFixed(1) + ' m ' + (ok2 ? '可识别' : '失败'));
    const mis = misregistration();
    setChip('chipPara', mis < 0.3 ? 'ok' : mis < 0.5 ? 'warn' : 'bad', '错位 ' + mis.toFixed(2) + ' 格');
    const span = ((model.topMax - model.topMin) * S() / 10).toFixed(1);
    let msg;
    if (ok2) msg = '解码结果：<span class="mono">' + escapeHTML(r2.data) + '</span>';
    else if (!ok1) msg = '连正俯视都扫不出，多半是花色和白色太接近。换深一点的花色试试。';
    else if (mis >= 0.3) msg = '码点之间最大高差约 ' + span + ' cm，手机离得近时高处的码点被透视放大，错开约 ' + mis.toFixed(1) + ' 格。把手机拉高；或打开“整个码放在树冠顶上”，减小顶面拱起。';
    else msg = '几何上已基本对齐，失败多半来自偏离中心或颜色对比。把偏移调回 0，或换深一点的花色。';
    $('scanMsg').innerHTML = msg;
  }

  // ---------- rebuild ----------
  function luma(hex) { const [r, g, b] = hexRGB(hex); return 0.299 * r + 0.587 * g + 0.114 * b; }
  function updateContrast() {
    const dl = luma(LIGHTS[state.light][1]) - luma(PINKS[state.pink][1]);
    $('contrastInfo').textContent = '与高光色灰度差 ' + Math.round(dl * 100) + '%' + (dl < 0.22 ? ' · 偏低，易失败' : dl < 0.3 ? ' · 够用' : ' · 稳');
  }
  function updateStats() {
    if (!model) return;
    const s = S(), threeCol = state.wood === 'brown';
    const swaps = Math.round(model.mixedLevels * s / 0.2);
    const used = [[PINKS[state.pink][0], PINKS[state.pink][1]], [LIGHTS[state.light][0], LIGHTS[state.light][1]]].concat(threeCol ? [['棕', COLORS.brown]] : []);
    const ledgeText = { 1: '全部 45° 台阶，免支撑', 2: '最多悬挑 2 格（' + (2 * s) + ' mm）', 3: '最多悬挑 3 格（' + (3 * s) + ' mm），需支撑' }[model.maxH];
    const cells = [
      ['<span class="mono">' + W().toFixed(0) + ' × ' + W().toFixed(0) + ' × ' + H().toFixed(0) + '</span>', '成品尺寸 mm'],
      ['<span class="palette">' + used.map(c => '<i style="background:' + c[1] + '" title="' + c[0] + '"></i>').join('') + '&nbsp;' + used.length + ' 色</span>', used.map(c => c[0]).join(' · ')],
      [model.onCanopy + ' / ' + (model.n * model.n), '码点落在树冠顶上 / 全部码点' + (model.onCanopy === model.n * model.n ? '' : '（其余印在底座上）')],
      [model.trimmed + ' 块', '为免支撑削掉的悬空花块 · ' + ledgeText],
      ['~' + swaps + ' 次', '换色次数（0.2 mm 层高，单喷头）'],
      ['~' + Math.round(swaps * 0.3) + ' g · ' + (swaps * 50 / 3600).toFixed(1) + ' h', 'AMS 冲刷废料与额外耗时（粗估）；双喷头约为 0']
    ];
    $('stats').innerHTML = cells.map(([v, l]) => '<div class="stat"><b>' + v + '</b><span>' + l + '</span></div>').join('');
    // what a small cube size means in practice: the trunk is two cubes thick, the peg one clearance thinner per side
    const pegW = 2 * s - 2 * state.clear;
    $('moduleNote').textContent = '树宽约 ' + W().toFixed(0) + ' mm，树干 ' + (2 * s) + ' mm 粗' + (state.layout === 'split' ? '，榫头 ' + pegW.toFixed(1) + ' mm 见方' : '') + '。'
      + (s < 3 ? '方块小于 3 mm 时细节只有几条线宽，建议 0.2 mm 喷嘴或 0.12 mm 层高；手机也要离得更近，大约和方块边长成正比。' : '');
    $('exportInfo').textContent = '当前模型 ' + W().toFixed(0) + ' × ' + W().toFixed(0) + ' × ' + H().toFixed(0) + ' mm，' + used.length + ' 个颜色部件。';
  }
  function rebuild() {
    if (!T) return;
    state.text = $('txt').value.trim();
    const prep = prepareText(state.text);
    state.encoded = prep.text;
    $('upperNote').textContent = prep.note;
    $('rowDome').hidden = !state.onCanopy;
    $('ledgeNote').textContent = { '1': '树冠底部按 45° 台阶收进去，完全不需要支撑，树冠底面会尖一些。', '2': '每级台阶最多往外伸 2 格。树冠更圆，大多数打印机能直接打，边缘可能轻微下垂。', '3': '树冠底面最圆，但 3 格悬挑需要开启支撑。' }[state.ledge];
    const err = $('err');
    if (!state.text) { err.textContent = '先输入一些文字。'; err.hidden = false; return; }
    let mi;
    try { mi = makeMatrix(state.encoded, state.ecc); }
    catch (e) { err.textContent = '内容太长，当前纠错等级放不下。缩短文字或换低一级纠错。'; err.hidden = false; return; }
    if (mi.version > 4) { err.textContent = '码已到版本 ' + mi.version + '（' + mi.n + '×' + mi.n + '），方块很密，树会很大。建议缩短内容或用短链接。'; err.hidden = false; }
    else err.hidden = true;
    $('verInfo').textContent = '版本 ' + mi.version + ' · ' + mi.n + '×' + mi.n + ' · ' + mi.mode;
    $('maskVal').textContent = (state.mask < 0 ? '自动 · ' : '') + '第 ' + mi.mask + ' 号';

    model = buildCanopyTree(mi.mat, Object.assign({}, FIXED, {
      crown: state.onCanopy ? state.crown * 1.45 : state.crown, squash: state.squash, trunk: state.trunk, lobes: state.lobes, rough: state.rough, puff: state.puff,
      quiet: state.onCanopy ? 5 : 3, onCanopy: state.onCanopy, dome: state.dome, capDepth: 4,
      maxLedge: parseInt(state.ledge, 10), seed: strSeed(state.encoded) + state.seedAdd * 7919
    }));
    while (group.children.length) { const c = group.children[0]; group.remove(c); if (c.geometry) c.geometry.dispose(); }
    blockMesh = new T.Mesh(buildBlocks(model), blockMat); blockMesh.castShadow = true; blockMesh.receiveShadow = true;
    group.add(blockMesh);
    const w = W(), sh = dirLight.shadow.camera;
    sh.left = -w; sh.right = w; sh.top = w; sh.bottom = -w; sh.near = 1; sh.far = 2000; sh.updateProjectionMatrix();
    if (!orbit.init) { orbit.radius = Math.max(w, H()) * 3.1; orbit.init = true; }
    orbit.radius = clampR(orbit.radius);
    $('loading').hidden = true;
    applyColors();
  }

  // ---------- export ----------
  function updateLayout() {
    const split = state.layout === 'split';
    $('rowClear').hidden = !split;
    $('layoutNote').textContent = split
      ? '树去掉底座倒过来打，树冠最高的那几格贴着平台，树干末端是方榫；底座单独正着打，中间留方孔。支撑耗材大约少一半到三分之二，也更矮、更好拆，但会落在树冠顶面（码点）上，可能留下痕迹。'
      : '整棵树连底座正着打，支撑都在树冠下面看不到的地方。';
  }
  updateLayout();
  function exportColours() {
    return {
      dark: { name: '花 ' + PINKS[state.pink][0], hex: PINKS[state.pink][1] },
      light: { name: '高光 ' + LIGHTS[state.light][0], hex: LIGHTS[state.light][1] },
      wood: { name: '树干 棕', hex: COLORS.brown }
    };
  }
  function exportParts() {
    return SakuraExport.buildParts(model, S(), exportColours(), state.wood === 'brown' ? null : { wood: 'light' }, { layout: state.layout, clear: state.clear });
  }
  function baseName() {
    const host = (state.encoded || 'sakura').replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
    return 'sakuraqr-' + (host || 'tree').slice(0, 40);
  }
  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function busy(btn, fn) {
    if (!model) return;
    const label = btn.textContent; btn.disabled = true; btn.textContent = '正在生成…';
    setTimeout(() => {
      try { fn(); $('exportInfo').textContent = '已生成：' + lastExport; }
      catch (e) { $('exportInfo').textContent = '导出失败：' + e.message; }
      finally { btn.disabled = false; btn.textContent = label; }
    }, 30);
  }
  let lastExport = '';
  $('dl3mf').addEventListener('click', e => busy(e.currentTarget, () => {
    const parts = exportParts();
    download(baseName() + '.3mf', SakuraExport.to3MF(parts, 'SakuraQR ' + state.encoded), 'model/3mf');
    lastExport = baseName() + '.3mf（' + parts.map(p => p.name).join('、') + '）';
  }));
  $('dlstl').addEventListener('click', e => busy(e.currentTarget, () => {
    const parts = exportParts();
    download(baseName() + '-stl.zip', SakuraExport.toSTLZip(parts, baseName()), 'application/zip');
    lastExport = baseName() + '-stl.zip（' + parts.length + ' 个 STL）';
  }));
  $('dlpng').addEventListener('click', e => busy(e.currentTarget, () => {
    const hex = { dark: PINKS[state.pink][1], light: LIGHTS[state.light][1], wood: state.wood === 'brown' ? COLORS.brown : LIGHTS[state.light][1] };
    const cv = SakuraExport.topViewCanvas(model, hex, 24);
    // add a white margin so phone scanners find the code easily
    const pad = 48, out = document.createElement('canvas');
    out.width = out.height = cv.width + pad * 2;
    const g = out.getContext('2d'); g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, out.width, out.height); g.drawImage(cv, pad, pad);
    out.toBlob(b => download(baseName() + '-top.png', b), 'image/png');
    lastExport = baseName() + '-top.png';
  }));

  Promise.all([
    loadScript(['https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js']),
    loadScript(['https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js', 'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js'])
  ]).then(() => {
    T = window.THREE;
    initThree();
    rebuild();
  }).catch(() => {
    $('loading').textContent = '3D 引擎或二维码库没加载出来，请检查网络后刷新。';
  });
})();
