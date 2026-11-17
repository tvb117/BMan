'use strict';

// Everything is drawn in code with canvas shapes & gradients (no sprite files).
// World drawing uses tile units: ctx is scaled so 1 unit = 1 tile.
const Renderer = (() => {
  let canvas, ctx, dpr = 1, W = 0, H = 0, ts = 40, ox = 0, oy = 0;
  let sprites = {}, floorCanvas = null, floorKey = '', noiseCv = null, scratch = null;
  let particles = [], popups = [], banner = null, clock = 0;
  // visual state that belongs to the game being shown
  let stateGame = null, pstate = {}, scorches = new Map(), emitters = [], footprints = [];
  let confetti = [], podiumOn = false;
  let zoom = 1, zx = COLS / 2, zy = ROWS / 2;
  const options = { duelZoom: false };
  const bg = { key: '', stars: [], tufts: [], flakes: [], steam: [], shoot: null, shootT: 3 };
  const FONT = '"Lilita One", "Arial Black", Impact, sans-serif';
  const TAU = Math.PI * 2;
  const LIFT_HARD = 0.16, LIFT_SOFT = 0.16;
  const SKIN = ['#ffd9b8', '#f2b98e', '#c98458'];
  const OUTLINE = '#1a1626';
  const DIR_ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

  // ======================================================= helpers
  function hash(x, y, s) {
    let h = (x * 374761393 + y * 668265263 + (s || 0) * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function ell(c, x, y, rx, ry, rot) { c.beginPath(); c.ellipse(x, y, rx, ry, rot || 0, 0, TAU); }
  function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, TAU); }
  function drop(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI); c.lineTo(x, y - r * 2.3); c.closePath(); }
  function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgba(hex, a) { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; }
  function shadeHex(hex, k) {
    const [r, g, b] = rgb(hex);
    const f = v => Math.max(0, Math.min(255, Math.round(k > 1 ? v + (255 - v) * (k - 1) : v * k)));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }
  function star(c, x, y, r) {
    c.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5; const r2 = i % 2 ? r * 0.45 : r; c.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2); }
    c.closePath();
  }
  // world (tile) coords -> screen pixels, including duel zoom
  function sx(x) { return ox + ts * (zx + (x - zx) * zoom); }
  function sy(y) { return oy + ts * (zy + (y - zy) * zoom); }

  function init(cv) {
    canvas = cv; ctx = cv.getContext('2d', { alpha: false });
    resize();
    window.addEventListener('resize', resize);
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ts = Math.max(16, Math.floor(Math.min(W / (COLS + 0.4), H / (ROWS + HUD_H + 0.35))));
    ox = Math.round((W - ts * COLS) / 2);
    oy = Math.round((H - ts * (ROWS + HUD_H)) / 2 + ts * HUD_H);
    sprites = {}; floorKey = ''; bg.key = '';
  }
  function setOptions(o) { Object.assign(options, o); }

  function makeCanvas(wT, hT, draw) {
    const cv = document.createElement('canvas');
    const s = ts * dpr;
    cv.width = Math.ceil(wT * s); cv.height = Math.ceil(hT * s);
    const c = cv.getContext('2d');
    c.scale(s, s);
    draw(c, s);
    return cv;
  }
  function noise() {
    if (noiseCv) return noiseCv;
    noiseCv = document.createElement('canvas');
    noiseCv.width = noiseCv.height = 128;
    const c = noiseCv.getContext('2d');
    const img = c.createImageData(128, 128);
    for (let i = 0; i < 128 * 128; i++) {
      const v = (128 + (Math.random() - 0.5) * 110) | 0;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    return noiseCv;
  }
  function grain(c, s, alpha, x, y, w, h) {
    const pat = c.createPattern(noise(), 'repeat');
    if (pat.setTransform && window.DOMMatrix) pat.setTransform(new DOMMatrix().scale(1.4 / s));
    c.save();
    c.globalAlpha = alpha; c.globalCompositeOperation = 'overlay';
    c.fillStyle = pat; c.fillRect(x, y, w, h);
    c.restore();
  }

  // ======================================================= BLOCKS
  function blockBase(c, s, L, o) {
    let g = c.createLinearGradient(0, 0.9, 0, 1 + L);
    g.addColorStop(0, o.f1); g.addColorStop(1, o.f2);
    c.fillStyle = g; rr(c, 0.02, 0.5, 0.96, 0.5 + L - 0.02, 0.1); c.fill();
    c.save(); c.clip(); grain(c, s, 0.35, 0, 0.5, 1, 1);
    g = c.createLinearGradient(0, 0.98, 0, 1.08); g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0.98, 1, 0.12);
    c.restore();
    c.lineWidth = 0.035; c.strokeStyle = o.edge; rr(c, 0.02, 0.5, 0.96, 0.5 + L - 0.02, 0.1); c.stroke();
    g = c.createLinearGradient(0, 0, 0.8, 1);
    g.addColorStop(0, o.t1); g.addColorStop(1, o.t2);
    c.fillStyle = g; rr(c, 0.02, 0.02, 0.96, 0.96, 0.13); c.fill();
    c.save(); c.clip(); grain(c, s, 0.3, 0, 0, 1, 1);
    g = c.createRadialGradient(0.25, 0.2, 0.02, 0.3, 0.3, 0.8);
    g.addColorStop(0, 'rgba(255,255,255,0.28)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 1, 1);
    c.restore();
    g = c.createLinearGradient(0, 0, 1, 1);
    g.addColorStop(0, 'rgba(255,255,255,0.6)'); g.addColorStop(0.48, 'rgba(255,255,255,0.05)');
    g.addColorStop(0.52, 'rgba(0,0,0,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
    c.strokeStyle = g; c.lineWidth = 0.07; rr(c, 0.07, 0.07, 0.86, 0.86, 0.09); c.stroke();
    c.lineWidth = 0.035; c.strokeStyle = o.edge; rr(c, 0.02, 0.02, 0.96, 0.96, 0.13); c.stroke();
  }

  function drawHard(c, s, th, L, wall) {
    const dk = wall ? 0.8 : 1;
    const o = { t1: shadeHex(th.hardTop1, dk), t2: shadeHex(th.hardTop2, dk), f1: shadeHex(th.hardFront1, dk), f2: shadeHex(th.hardFront2, dk), edge: th.hardEdge };
    blockBase(c, s, L, o);
    switch (th.style) {
      case 'garden':
        c.fillStyle = 'rgba(0,0,0,0.13)';
        for (const [x, y, r] of [[0.3, 0.35, 0.07], [0.62, 0.55, 0.09], [0.45, 0.75, 0.05], [0.75, 0.28, 0.05]]) { circle(c, x, y, r); c.fill(); }
        c.fillStyle = 'rgba(255,255,255,0.18)';
        for (const [x, y, r] of [[0.28, 0.33, 0.035], [0.6, 0.53, 0.045]]) { circle(c, x, y, r); c.fill(); }
        c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 0.025;
        c.beginPath(); c.moveTo(0.18, 0.62); c.lineTo(0.33, 0.52); c.lineTo(0.4, 0.6); c.lineTo(0.5, 0.56); c.stroke();
        if (!wall) {
          c.fillStyle = 'rgba(80,150,50,0.55)';
          circle(c, 0.82, 0.86, 0.07); c.fill(); circle(c, 0.72, 0.9, 0.05); c.fill(); circle(c, 0.12, 0.88, 0.04); c.fill();
        }
        break;
      case 'factory': {
        c.save(); rr(c, 0.05, 1, 0.9, L - 0.04, 0.05); c.clip();
        c.fillStyle = '#f2c230'; c.fillRect(0, 0.9, 1, L + 0.2);
        c.fillStyle = '#1b1d22';
        for (let i = -2; i < 8; i++) { c.beginPath(); c.moveTo(i * 0.2, 1 + L); c.lineTo(i * 0.2 + 0.1, 1 + L); c.lineTo(i * 0.2 + 0.1 + L, 1); c.lineTo(i * 0.2 + L, 1); c.fill(); }
        c.restore();
        for (const [x, y] of [[0.17, 0.17], [0.83, 0.17], [0.17, 0.83], [0.83, 0.83]]) {
          const g = c.createRadialGradient(x - 0.015, y - 0.015, 0.005, x, y, 0.05);
          g.addColorStop(0, '#e6ecf4'); g.addColorStop(1, '#5d6673');
          c.fillStyle = g; circle(c, x, y, 0.045); c.fill();
        }
        c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 0.03; rr(c, 0.28, 0.28, 0.44, 0.44, 0.06); c.stroke();
        c.strokeStyle = 'rgba(255,255,255,0.15)'; rr(c, 0.3, 0.3, 0.44, 0.44, 0.06); c.stroke();
        break;
      }
      case 'space':
        c.save();
        c.strokeStyle = '#7ff0ff'; c.lineWidth = 0.035; c.shadowColor = '#7ff0ff'; c.shadowBlur = 0.15 * s;
        rr(c, 0.18, 0.18, 0.64, 0.64, 0.1); c.stroke();
        c.restore();
        c.fillStyle = 'rgba(127,240,255,0.6)'; c.fillRect(0.12, 1 + L * 0.45, 0.76, 0.03);
        c.fillStyle = 'rgba(127,240,255,0.9)'; circle(c, 0.5, 0.5, 0.05); c.fill();
        break;
      case 'glacier':
        c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 0.045;
        c.beginPath(); c.moveTo(0.22, 0.76); c.lineTo(0.55, 0.28); c.moveTo(0.45, 0.82); c.lineTo(0.74, 0.42); c.stroke();
        c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(0.06, 1.02, 0.88, 0.04);
        break;
    }
  }

  function drawSoft(c, s, th, L) {
    const o = { t1: th.softTop1, t2: th.softTop2, f1: th.softFront1, f2: th.softFront2, edge: th.softEdge };
    blockBase(c, s, L, o);
    switch (th.style) {
      case 'garden': {
        const lines = (dy) => {
          c.beginPath();
          for (const y of [0.35, 0.65]) { c.moveTo(0.06, y + dy); c.lineTo(0.94, y + dy); }
          c.moveTo(0.5, 0.05 + dy); c.lineTo(0.5, 0.35 + dy);
          c.moveTo(0.28, 0.35 + dy); c.lineTo(0.28, 0.65 + dy); c.moveTo(0.72, 0.35 + dy); c.lineTo(0.72, 0.65 + dy);
          c.moveTo(0.5, 0.65 + dy); c.lineTo(0.5, 0.95 + dy);
          c.moveTo(0.28, 1 + dy); c.lineTo(0.28, 1 + L + dy); c.moveTo(0.72, 1 + dy); c.lineTo(0.72, 1 + L + dy);
          c.stroke();
        };
        c.lineWidth = 0.03; c.strokeStyle = 'rgba(255,220,180,0.35)'; lines(0.022);
        c.lineWidth = 0.035; c.strokeStyle = 'rgba(90,38,8,0.5)'; lines(0);
        break;
      }
      case 'factory': {
        c.fillStyle = 'rgba(255,240,200,0.45)'; c.fillRect(0.42, 0.05, 0.16, 0.9); c.fillRect(0.42, 1, 0.16, L - 0.03);
        c.strokeStyle = 'rgba(79,50,22,0.35)'; c.lineWidth = 0.02; c.strokeRect(0.42, 0.05, 0.16, 0.9);
        c.strokeStyle = 'rgba(79,50,22,0.55)'; c.lineWidth = 0.025;
        c.beginPath(); c.moveTo(0.12, 0.2); c.lineTo(0.3, 0.2); c.moveTo(0.12, 0.27); c.lineTo(0.26, 0.27);
        c.moveTo(0.68, 0.75); c.lineTo(0.86, 0.75); c.stroke();
        c.fillStyle = 'rgba(79,50,22,0.5)';
        c.beginPath(); c.moveTo(0.76, 0.18); c.lineTo(0.82, 0.28); c.lineTo(0.7, 0.28); c.fill();
        break;
      }
      case 'space': {
        c.fillStyle = 'rgba(255,255,255,0.3)';
        c.beginPath(); c.moveTo(0.1, 0.1); c.lineTo(0.55, 0.1); c.lineTo(0.35, 0.5); c.closePath(); c.fill();
        c.fillStyle = 'rgba(40,0,80,0.3)';
        c.beginPath(); c.moveTo(0.9, 0.9); c.lineTo(0.45, 0.9); c.lineTo(0.65, 0.5); c.closePath(); c.fill();
        c.fillStyle = 'rgba(255,200,255,0.25)';
        c.beginPath(); c.moveTo(0.55, 0.1); c.lineTo(0.9, 0.1); c.lineTo(0.9, 0.45); c.lineTo(0.65, 0.5); c.closePath(); c.fill();
        c.fillStyle = '#fff'; circle(c, 0.72, 0.25, 0.03); c.fill();
        break;
      }
      case 'glacier': {
        c.fillStyle = 'rgba(120,160,200,0.25)';
        for (const [x, y, r] of [[0.3, 0.4, 0.1], [0.65, 0.65, 0.12], [0.7, 0.3, 0.06]]) { circle(c, x, y, r); c.fill(); }
        c.fillStyle = '#fff';
        for (const [x, y] of [[0.25, 0.25], [0.55, 0.45], [0.8, 0.8]]) { circle(c, x, y, 0.02); c.fill(); }
        break;
      }
    }
  }

  function sprite(name, make) { if (!sprites[name]) sprites[name] = make(); return sprites[name]; }
  function hardSprite(th, wall) { return sprite(th.style + (wall ? ':wall' : ':hard'), () => makeCanvas(1, 1 + LIFT_HARD, (c, s) => drawHard(c, s, th, LIFT_HARD, wall))); }
  function softSprite(th) { return sprite(th.style + ':soft', () => makeCanvas(1, 1 + LIFT_SOFT, (c, s) => drawSoft(c, s, th, LIFT_SOFT))); }
  function shadowSprite() {
    return sprite('shadow', () => makeCanvas(1.7, 1.7, (c, s) => {
      c.filter = `blur(${Math.max(1, s * 0.09)}px)`;
      c.fillStyle = 'rgba(0,0,0,0.5)';
      rr(c, 0.32, 0.34, 1.0, 1.0, 0.18); c.fill();
      c.filter = 'none';
    }));
  }

  // ======================================================= FLOOR
  function drawFloorTile(c, x, y, th, sp) {
    const alt = (x + y) % 2 === 0;
    c.fillStyle = alt ? th.floorA : th.floorB;
    c.fillRect(x, y, 1.01, 1.01);
    const r1 = hash(x, y, 1), r2 = hash(x, y, 2), r3 = hash(x, y, 3);
    switch (th.style) {
      case 'garden': {
        const g = c.createRadialGradient(x + r1, y + r2, 0.05, x + r1, y + r2, 0.8);
        g.addColorStop(0, 'rgba(255,255,160,0.10)'); g.addColorStop(1, 'rgba(0,60,0,0.06)');
        c.fillStyle = g; c.fillRect(x, y, 1, 1);
        c.lineWidth = 0.028;
        for (let i = 0; i < 6; i++) {
          const gx = x + 0.1 + hash(x, y, 10 + i) * 0.8, gy = y + 0.15 + hash(x, y, 20 + i) * 0.75;
          c.strokeStyle = i % 2 ? th.floorDot : 'rgba(30,90,20,0.45)';
          c.beginPath(); c.moveTo(gx - 0.035, gy); c.lineTo(gx - 0.055, gy - 0.075); c.moveTo(gx, gy); c.lineTo(gx + 0.005, gy - 0.095); c.moveTo(gx + 0.035, gy); c.lineTo(gx + 0.06, gy - 0.07); c.stroke();
        }
        if (r1 > 0.82) {
          const fx = x + 0.2 + r2 * 0.6, fy = y + 0.2 + r3 * 0.6;
          c.fillStyle = r2 > 0.5 ? '#fff7b0' : '#ffb8d6';
          for (let k = 0; k < 5; k++) { const a = k * TAU / 5; circle(c, fx + Math.cos(a) * 0.035, fy + Math.sin(a) * 0.035, 0.028); c.fill(); }
          c.fillStyle = '#ffb020'; circle(c, fx, fy, 0.022); c.fill();
        }
        break;
      }
      case 'factory':
        c.fillStyle = 'rgba(0,0,0,0.12)';
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
          const px = x + 0.14 + i * 0.24, py = y + 0.14 + j * 0.24;
          c.save(); c.translate(px, py); c.rotate((i + j) % 2 ? 0.8 : -0.8); c.fillRect(-0.06, -0.015, 0.12, 0.03); c.restore();
        }
        c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 0.025; c.strokeRect(x + 0.02, y + 0.02, 0.96, 0.96);
        c.strokeStyle = 'rgba(255,255,255,0.12)'; c.strokeRect(x + 0.045, y + 0.045, 0.93, 0.93);
        if (r1 > 0.75) { c.fillStyle = 'rgba(30,20,10,0.12)'; ell(c, x + 0.3 + r2 * 0.4, y + 0.3 + r3 * 0.4, 0.18, 0.1, r1 * 3); c.fill(); }
        break;
      case 'space':
        c.strokeStyle = 'rgba(90,120,240,0.35)'; c.lineWidth = 0.02; c.strokeRect(x + 0.03, y + 0.03, 0.94, 0.94);
        c.fillStyle = 'rgba(90,120,240,0.4)';
        for (const [a, b] of [[0.08, 0.08], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92]]) { circle(c, x + a, y + b, 0.018); c.fill(); }
        c.fillStyle = 'rgba(255,255,255,0.8)';
        if (r1 > 0.45) { circle(c, x + r2, y + r3, 0.01 + r1 * 0.012); c.fill(); }
        break;
      case 'glacier': {
        const g = c.createLinearGradient(x, y, x + 1, y + 1);
        g.addColorStop(0, 'rgba(255,255,255,0.15)'); g.addColorStop(1, 'rgba(40,80,130,0.08)');
        c.fillStyle = g; c.fillRect(x, y, 1, 1);
        if (r1 > 0.5) { c.fillStyle = 'rgba(255,255,255,0.9)'; circle(c, x + 0.2 + r2 * 0.6, y + 0.2 + r3 * 0.6, 0.02); c.fill(); }
        c.strokeStyle = 'rgba(60,100,150,0.2)'; c.lineWidth = 0.02; c.strokeRect(x, y, 1, 1);
        break;
      }
    }
    if (sp && sp.type === 'ice') {
      const g = c.createLinearGradient(x, y, x + 1, y + 1);
      g.addColorStop(0, '#d6f3ff'); g.addColorStop(0.5, '#9ad8f5'); g.addColorStop(1, '#6cbbe6');
      c.fillStyle = g; c.fillRect(x, y, 1.01, 1.01);
      c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 0.035;
      c.beginPath(); c.moveTo(x + 0.15 + r1 * 0.2, y + 0.8); c.lineTo(x + 0.45 + r1 * 0.2, y + 0.3);
      c.moveTo(x + 0.5 + r2 * 0.2, y + 0.85); c.lineTo(x + 0.7 + r2 * 0.2, y + 0.55); c.stroke();
      c.strokeStyle = 'rgba(40,110,170,0.35)'; c.lineWidth = 0.02; c.strokeRect(x, y, 1, 1);
    }
  }

  function getFloor(game) {
    const key = game.mapVersion + ':' + ts + ':' + dpr + ':' + game.arena.id;
    if (floorKey === key && floorCanvas) return floorCanvas;
    floorKey = key;
    const th = game.arena.theme;
    floorCanvas = makeCanvas(COLS, ROWS, (c, s) => {
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) drawFloorTile(c, x, y, th, game.special[y][x]);
      grain(c, s, 0.22, 0, 0, COLS, ROWS);
      if (th.style === 'space') {
        for (const [nx, ny, col] of [[4, 4, 'rgba(160,60,255,0.18)'], [11, 9, 'rgba(40,180,255,0.15)']]) {
          const g = c.createRadialGradient(nx, ny, 0.2, nx, ny, 5);
          g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
          c.fillStyle = g; c.fillRect(0, 0, COLS, ROWS);
        }
      }
    });
    return floorCanvas;
  }

  // ======================================================= SPECIAL TILES
  function drawConveyor(c, x, y, dir, t) {
    c.save();
    c.translate(x + 0.5, y + 0.5); c.rotate(DIR_ANGLE[dir]);
    const g = c.createLinearGradient(0, -0.42, 0, 0.42);
    g.addColorStop(0, '#2b2e36'); g.addColorStop(0.5, '#454a56'); g.addColorStop(1, '#2b2e36');
    c.fillStyle = g; c.fillRect(-0.5, -0.42, 1, 0.84);
    c.fillStyle = '#1a1c22'; c.fillRect(-0.5, -0.47, 1, 0.08); c.fillRect(-0.5, 0.39, 1, 0.08);
    c.fillStyle = '#7c8494';
    for (let i = 0; i < 2; i++) { const a = (((t * RULES.conveyorSpeed) % 0.5) + i * 0.5) - 0.5; c.fillRect(a, -0.46, 0.06, 0.04); c.fillRect(a, 0.42, 0.06, 0.04); }
    c.beginPath(); c.rect(-0.5, -0.38, 1, 0.76); c.clip();
    c.strokeStyle = '#f2c230'; c.lineWidth = 0.09; c.lineCap = 'round'; c.lineJoin = 'round';
    for (let i = 0; i < 3; i++) {
      const a = ((i * 0.5 + t * RULES.conveyorSpeed) % 1.5) - 0.75;
      c.beginPath(); c.moveTo(a - 0.12, -0.22); c.lineTo(a + 0.06, 0); c.lineTo(a - 0.12, 0.22); c.stroke();
    }
    c.restore();
  }
  function drawWarp(c, x, y, sp, t) {
    const cx = x + 0.5, cy = y + 0.5;
    const g = c.createRadialGradient(cx, cy, 0.02, cx, cy, 0.5);
    g.addColorStop(0, `hsla(${sp.hue},100%,85%,1)`);
    g.addColorStop(0.5, `hsla(${sp.hue},90%,50%,0.8)`);
    g.addColorStop(1, `hsla(${sp.hue},90%,30%,0)`);
    c.fillStyle = g; circle(c, cx, cy, 0.5); c.fill();
    c.lineWidth = 0.04; c.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      const a = t * (3 + k) + k * 2;
      c.strokeStyle = `hsla(${sp.hue + k * 20},100%,${70 + k * 8}%,0.9)`;
      c.beginPath(); c.arc(cx, cy, 0.14 + k * 0.1, a, a + Math.PI * 1.2); c.stroke();
    }
    c.fillStyle = '#05030f'; circle(c, cx, cy, 0.08); c.fill();
  }

  // ======================================================= FLAMES
  function flameScale(f) {
    const k = f.t / RULES.flameTime;
    return Math.max(0, Math.min(1, (1 - k) * 10, k * 3));
  }
  function drawFlameGlow(c, x, y, f) {
    const s = flameScale(f);
    if (s <= 0) return;
    const cx = x + 0.5, cy = y + 0.5;
    const g = c.createRadialGradient(cx, cy, 0.05, cx, cy, 1.1);
    g.addColorStop(0, `rgba(255,170,60,${0.35 * s})`); g.addColorStop(1, 'rgba(255,90,0,0)');
    c.fillStyle = g; c.fillRect(cx - 1.1, cy - 1.1, 2.2, 2.2);
  }
  const FLAME_STOPS = [[0, 'rgba(255,40,0,0)'], [0.1, 'rgba(230,40,0,0.9)'], [0.28, '#ff7a10'], [0.42, '#ffd24a'], [0.5, '#fffbea'], [0.58, '#ffd24a'], [0.72, '#ff7a10'], [0.9, 'rgba(230,40,0,0.9)'], [1, 'rgba(255,40,0,0)']];
  function drawFlame(c, x, y, f, t) {
    const s = flameScale(f);
    if (s <= 0) return;
    const cx = x + 0.5, cy = y + 0.5;
    const Wd = 0.42 * s * (1 + 0.05 * Math.sin(t * 40 + (x + y) * 1.7));
    const arms = f.arms;
    const dirs = DIR_NAMES.filter(d => arms[d]);
    // fire tongues licking out of the blast ends
    if (dirs.length === 1 && !f.center) {
      const out = OPPOSITE[dirs[0]];
      c.save(); c.translate(cx, cy); c.rotate(DIR_ANGLE[out]);
      for (let i = 0; i < 3; i++) {
        const off = (i - 1) * 0.13 * s;
        const len = (0.38 + 0.16 * Math.sin(t * 28 + i * 2.3 + x * 1.7 + y)) * s;
        const g = c.createLinearGradient(0, 0, len, 0);
        g.addColorStop(0, '#ffc040'); g.addColorStop(0.6, 'rgba(255,90,0,0.8)'); g.addColorStop(1, 'rgba(255,40,0,0)');
        c.fillStyle = g;
        c.beginPath(); c.moveTo(0, off - 0.13 * s);
        c.quadraticCurveTo(len * 0.6, off - 0.09 * s, len, off + 0.04 * Math.sin(t * 22 + i));
        c.quadraticCurveTo(len * 0.6, off + 0.09 * s, 0, off + 0.13 * s);
        c.fill();
      }
      c.restore();
    }
    for (const dn of dirs) {
      const horiz = dn === 'left' || dn === 'right';
      const g = horiz ? c.createLinearGradient(0, cy - Wd, 0, cy + Wd) : c.createLinearGradient(cx - Wd, 0, cx + Wd, 0);
      for (const [o, col] of FLAME_STOPS) g.addColorStop(o, col);
      c.fillStyle = g;
      if (dn === 'up') c.fillRect(cx - Wd, y - 0.01, 2 * Wd, 0.51);
      else if (dn === 'down') c.fillRect(cx - Wd, cy, 2 * Wd, 0.51);
      else if (dn === 'left') c.fillRect(x - 0.01, cy - Wd, 0.51, 2 * Wd);
      else c.fillRect(cx, cy - Wd, 0.51, 2 * Wd);
    }
    const R = Wd * (f.center ? 1.45 : 1.08);
    const rg = c.createRadialGradient(cx, cy, 0, cx, cy, R);
    rg.addColorStop(0, '#fffdf0'); rg.addColorStop(0.35, '#ffe066'); rg.addColorStop(0.65, '#ff8a1a');
    rg.addColorStop(0.88, 'rgba(235,50,0,0.9)'); rg.addColorStop(1, 'rgba(235,40,0,0)');
    c.fillStyle = rg; circle(c, cx, cy, R); c.fill();
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const ph = t * 14 + i * 2.1 + x * 1.3 + y * 0.7;
      let bx = cx, by = cy;
      if (dirs.length) {
        const d = DIRS[dirs[(i + Math.floor(t * 4)) % dirs.length]];
        const along = ((t * 2.5 + i * 0.33) % 1) * 0.45;
        bx += d.x * along; by += d.y * along;
      }
      const r = Wd * (0.6 + 0.25 * Math.sin(ph));
      const g = c.createRadialGradient(bx, by, 0, bx, by, r);
      g.addColorStop(0, `rgba(255,235,150,${0.5 * s})`); g.addColorStop(1, 'rgba(255,100,0,0)');
      c.fillStyle = g; circle(c, bx, by, r); c.fill();
    }
    c.restore();
  }

  // ======================================================= BOMB
  function drawBomb(c, x, y, b, t, gt) {
    const isRemote = b.remote && !b.triggered;
    const urgency = isRemote ? 0.2 : Math.max(0, 1 - b.fuse / RULES.fuse);
    const pulse = 1 + Math.sin(t * (9 + urgency * 22)) * (0.03 + urgency * 0.04);
    const r = 0.31 * pulse;
    // squash & stretch
    let kx = 1, ky = 1, rot = 0, drop = 0;
    const age = gt !== undefined ? gt - b.born : 1;
    if (b.state !== 'fly' && age < 0.45) {
      const k = Math.exp(-age * 9) * Math.sin(age * 30);
      ky = 1 - k * 0.32; kx = 1 + k * 0.3;
      if (age < 0.1) drop = (1 - age / 0.1) * 0.25;
    }
    if (b.state === 'slide') { rot = Math.sin(t * 28) * 0.18; ky *= 0.94; kx *= 1.06; }
    if (!isRemote && b.fuse < 0.4 && b.state !== 'fly') {
      const k = 1 - b.fuse / 0.4, w = Math.sin(t * 60) * 0.07 * k;
      kx *= 1 + 0.2 * k + w; ky *= 1 + 0.2 * k - w;
    }
    c.save(); c.translate(x, y + 0.03 + r - drop); c.scale(kx, ky); c.rotate(rot); c.translate(0, -r);
    const cols = b.pierce ? ['#ffb0a0', '#c01c20', '#3a0508'] : isRemote ? ['#b8d4ff', '#2c4f8a', '#0a1428'] : ['#9aa0bc', '#2c2e44', '#08080e'];
    const g = c.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.05, 0, 0, r);
    g.addColorStop(0, cols[0]); g.addColorStop(0.42, cols[1]); g.addColorStop(1, cols[2]);
    c.fillStyle = g; circle(c, 0, 0, r); c.fill();
    c.strokeStyle = 'rgba(150,170,220,0.35)'; c.lineWidth = 0.03;
    c.beginPath(); c.arc(0, 0, r - 0.02, 0.2, 1.6); c.stroke();
    c.lineWidth = 0.03; c.strokeStyle = '#05050a'; circle(c, 0, 0, r); c.stroke();
    if (urgency > 0.6 && !isRemote) {
      c.fillStyle = `rgba(255,60,30,${(urgency - 0.6) * 1.2 * (0.5 + 0.5 * Math.sin(t * 30))})`;
      circle(c, 0, 0, r); c.fill();
    }
    if (b.pierce) {
      c.fillStyle = '#ffd040';
      for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + 0.3; circle(c, Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75, 0.025); c.fill(); }
    }
    const cg = c.createLinearGradient(-0.07, 0, 0.07, 0);
    cg.addColorStop(0, '#c9ced8'); cg.addColorStop(1, '#6b7080');
    c.fillStyle = cg; rr(c, -0.075, -r - 0.05, 0.15, 0.085, 0.02); c.fill(); c.stroke();
    if (isRemote) {
      c.strokeStyle = '#ccc'; c.lineWidth = 0.025;
      c.beginPath(); c.moveTo(0.03, -r - 0.04); c.lineTo(0.12, -r - 0.18); c.stroke();
      const on = Math.sin(t * 10) > 0;
      if (on) { const lg = c.createRadialGradient(0.12, -r - 0.19, 0, 0.12, -r - 0.19, 0.14); lg.addColorStop(0, 'rgba(255,60,60,0.6)'); lg.addColorStop(1, 'rgba(255,0,0,0)'); c.fillStyle = lg; circle(c, 0.12, -r - 0.19, 0.14); c.fill(); }
      c.fillStyle = on ? '#ff3030' : '#601010'; circle(c, 0.12, -r - 0.19, 0.04); c.fill();
    } else {
      c.strokeStyle = '#d9c39a'; c.lineWidth = 0.035;
      c.beginPath(); c.moveTo(0, -r - 0.04); c.quadraticCurveTo(0.06, -r - 0.17, 0.15, -r - 0.13); c.stroke();
      const fx = 0.15, fy = -r - 0.13;
      const sg = c.createRadialGradient(fx, fy, 0, fx, fy, 0.14);
      sg.addColorStop(0, 'rgba(255,240,150,0.9)'); sg.addColorStop(1, 'rgba(255,140,0,0)');
      c.fillStyle = sg; circle(c, fx, fy, 0.14); c.fill();
      c.strokeStyle = '#ffe36a'; c.lineWidth = 0.02;
      c.beginPath();
      for (let i = 0; i < 6; i++) { const a = t * 17 + i * 1.05; const l = 0.05 + 0.04 * Math.abs(Math.sin(t * 31 + i)); c.moveTo(fx, fy); c.lineTo(fx + Math.cos(a) * l, fy + Math.sin(a) * l); }
      c.stroke();
      c.fillStyle = '#fff'; circle(c, fx, fy, 0.025); c.fill();
    }
    c.fillStyle = 'rgba(255,255,255,0.6)'; ell(c, -r * 0.38, -r * 0.42, r * 0.22, r * 0.12, -0.6); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.35)'; circle(c, -r * 0.1, -r * 0.62, r * 0.05); c.fill();
    c.restore();
  }

  // ======================================================= ITEMS
  function drawItemIcon(c, type, t) {
    c.lineJoin = 'round'; c.lineCap = 'round';
    const outline = 'rgba(0,0,0,0.6)';
    switch (type) {
      case 'bomb': case 'line': {
        const pts = type === 'line' ? [[-0.15, 0.05, 0.09], [0, 0.05, 0.09], [0.15, 0.05, 0.09]] : [[0, 0.04, 0.16]];
        for (const [bx, by, r] of pts) {
          const g = c.createRadialGradient(bx - r * 0.3, by - r * 0.3, 0.01, bx, by, r);
          g.addColorStop(0, '#8a8a9a'); g.addColorStop(1, '#0d0d14');
          c.fillStyle = g; circle(c, bx, by, r); c.fill();
          c.strokeStyle = '#d9c39a'; c.lineWidth = 0.03; c.beginPath(); c.moveTo(bx, by - r); c.quadraticCurveTo(bx + r * 0.3, by - r * 1.7, bx + r * 0.9, by - r * 1.4); c.stroke();
          c.fillStyle = '#ffd040'; circle(c, bx + r * 0.9, by - r * 1.4, 0.025); c.fill();
          c.fillStyle = 'rgba(255,255,255,0.5)'; ell(c, bx - r * 0.35, by - r * 0.35, r * 0.25, r * 0.14, -0.6); c.fill();
        }
        break;
      }
      case 'fire': case 'gold': {
        const gold = type === 'gold';
        c.fillStyle = gold ? '#fff2a8' : '#ff5a1a'; c.strokeStyle = gold ? '#a86f00' : outline; c.lineWidth = 0.03;
        flamePath(c, 0, 0.02, 1); c.fill(); c.stroke();
        c.fillStyle = gold ? '#ffcc00' : '#ffd040'; flamePath(c, 0, 0.08, 0.6); c.fill();
        c.fillStyle = '#fffbe6'; flamePath(c, 0, 0.12, 0.3); c.fill();
        if (gold) { c.fillStyle = '#fff'; star(c, 0.17, -0.15, 0.05); c.fill(); star(c, -0.16, -0.05, 0.035); c.fill(); }
        break;
      }
      case 'speed':
        c.fillStyle = '#fff36a'; c.strokeStyle = outline; c.lineWidth = 0.03;
        c.beginPath(); c.moveTo(0.06, -0.24); c.lineTo(-0.14, 0.03); c.lineTo(-0.01, 0.03); c.lineTo(-0.08, 0.24); c.lineTo(0.15, -0.05); c.lineTo(0.02, -0.05); c.closePath(); c.fill(); c.stroke();
        break;
      case 'kick':
        c.fillStyle = '#c0392b'; c.strokeStyle = outline; c.lineWidth = 0.03;
        c.beginPath(); c.moveTo(-0.12, -0.22); c.lineTo(0.04, -0.22); c.lineTo(0.04, 0.02); c.lineTo(0.2, 0.06); c.quadraticCurveTo(0.25, 0.2, 0.15, 0.2); c.lineTo(-0.14, 0.2); c.closePath(); c.fill(); c.stroke();
        c.fillStyle = '#fff'; c.fillRect(-0.14, 0.13, 0.36, 0.05);
        c.fillStyle = '#ffd34a'; c.fillRect(-0.12, -0.22, 0.16, 0.06);
        break;
      case 'punch':
        c.fillStyle = '#e83a3a'; c.strokeStyle = outline; c.lineWidth = 0.03;
        rr(c, -0.17, -0.16, 0.3, 0.26, 0.1); c.fill(); c.stroke();
        ell(c, 0.12, 0.0, 0.07, 0.09); c.fill(); c.stroke();
        c.fillStyle = '#f5f5f5'; rr(c, -0.14, 0.1, 0.24, 0.1, 0.03); c.fill(); c.stroke();
        c.strokeStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.moveTo(-0.06, -0.15); c.lineTo(-0.06, -0.05); c.moveTo(0.03, -0.15); c.lineTo(0.03, -0.05); c.stroke();
        break;
      case 'remote':
        c.strokeStyle = '#333'; c.lineWidth = 0.03; c.beginPath(); c.moveTo(0.05, -0.08); c.lineTo(0.12, -0.24); c.stroke();
        c.fillStyle = '#ff3030'; circle(c, 0.12, -0.24, 0.035); c.fill();
        c.fillStyle = '#2b3240'; c.strokeStyle = outline; rr(c, -0.12, -0.1, 0.24, 0.32, 0.05); c.fill(); c.stroke();
        c.fillStyle = Math.sin(t * 8) > 0 ? '#ff4040' : '#a01010'; circle(c, 0, 0.02, 0.06); c.fill();
        c.fillStyle = '#7fd'; c.fillRect(-0.07, 0.12, 0.05, 0.04); c.fillRect(0.02, 0.12, 0.05, 0.04);
        break;
      case 'pierce': {
        c.fillStyle = '#ffd040';
        for (let i = 0; i < 8; i++) { const a = i * TAU / 8; c.beginPath(); c.moveTo(Math.cos(a - 0.2) * 0.13, Math.sin(a - 0.2) * 0.13 + 0.02); c.lineTo(Math.cos(a) * 0.24, Math.sin(a) * 0.24 + 0.02); c.lineTo(Math.cos(a + 0.2) * 0.13, Math.sin(a + 0.2) * 0.13 + 0.02); c.fill(); }
        const g = c.createRadialGradient(-0.05, -0.03, 0.01, 0, 0.02, 0.15);
        g.addColorStop(0, '#ff8a7a'); g.addColorStop(1, '#5a0508');
        c.fillStyle = g; circle(c, 0, 0.02, 0.15); c.fill();
        break;
      }
      case 'skull':
        c.fillStyle = '#f4f0e6'; c.strokeStyle = outline; c.lineWidth = 0.03;
        circle(c, 0, -0.04, 0.17); c.fill(); c.stroke();
        rr(c, -0.1, 0.06, 0.2, 0.14, 0.03); c.fill(); c.stroke();
        c.fillStyle = '#2a0d40'; ell(c, -0.065, -0.04, 0.05, 0.06); c.fill(); ell(c, 0.065, -0.04, 0.05, 0.06); c.fill();
        c.beginPath(); c.moveTo(0, 0.02); c.lineTo(-0.025, 0.07); c.lineTo(0.025, 0.07); c.fill();
        c.strokeStyle = '#2a0d40'; c.lineWidth = 0.02; c.beginPath(); c.moveTo(-0.035, 0.12); c.lineTo(-0.035, 0.19); c.moveTo(0.035, 0.12); c.lineTo(0.035, 0.19); c.stroke();
        break;
      case 'egg': {
        c.save(); c.translate(0, 0.06); c.scale(1.55, 1.55);
        c.strokeStyle = OUTLINE; c.lineWidth = 0.02;
        llamaHead(c, 0, 0, 1, '#f4ead2', true);
        c.restore();
        break;
      }
    }
  }
  function flamePath(c, x, y, s) {
    c.beginPath();
    c.moveTo(x, y - 0.24 * s);
    c.bezierCurveTo(x + 0.08 * s, y - 0.1 * s, x + 0.19 * s, y - 0.04 * s, x + 0.17 * s, y + 0.08 * s);
    c.bezierCurveTo(x + 0.15 * s, y + 0.2 * s, x - 0.15 * s, y + 0.2 * s, x - 0.17 * s, y + 0.08 * s);
    c.bezierCurveTo(x - 0.18 * s, y - 0.02 * s, x - 0.08 * s, y - 0.05 * s, x - 0.06 * s, y - 0.14 * s);
    c.bezierCurveTo(x - 0.02 * s, y - 0.1 * s, x, y - 0.15 * s, x, y - 0.24 * s);
    c.closePath();
  }

  function drawItem(c, x, y, pk, t) {
    if (pk.age < 0) return;
    const a = Math.min(1, pk.age * 5);
    const sc = a < 1 ? 0.3 + 0.7 * a + Math.sin(a * Math.PI) * 0.25 : 1;
    const bob = Math.sin(t * 4 + x * 1.3 + y) * 0.03;
    const info = ITEM_INFO[pk.type];
    c.save(); c.translate(x + 0.5, y + 0.45 + bob); c.scale(sc, sc);
    c.fillStyle = shadeHex(info.bg[1], 0.6); rr(c, -0.36, -0.3, 0.72, 0.72, 0.13); c.fill();
    const g = c.createLinearGradient(0, -0.36, 0, 0.36);
    g.addColorStop(0, info.bg[0]); g.addColorStop(1, info.bg[1]);
    c.fillStyle = g; rr(c, -0.36, -0.36, 0.72, 0.68, 0.13); c.fill();
    c.strokeStyle = pk.type === 'gold' ? '#fff6c0' : 'rgba(255,255,255,0.9)'; c.lineWidth = 0.04; c.stroke();
    c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 0.02; rr(c, -0.38, -0.38, 0.76, 0.8, 0.15); c.stroke();
    drawItemIcon(c, pk.type, t);
    const gl = c.createLinearGradient(0, -0.32, 0, -0.05);
    gl.addColorStop(0, 'rgba(255,255,255,0.45)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gl; rr(c, -0.31, -0.32, 0.62, 0.27, 0.1); c.fill();
    const tw = (t * 0.7 + x * 0.37 + y * 0.53) % 1;
    if (tw < 0.15) { c.fillStyle = `rgba(255,255,255,${1 - tw / 0.15})`; star(c, 0.25, -0.25, 0.08); c.fill(); }
    c.restore();
  }

  // ======================================================= LLAMA MOUNT
  const PLAYER_SCALE = 1.22;
  function llamaHead(c, hx, hy, s, color, front) {
    const woolL = shadeHex(color, 1.35);
    c.fillStyle = color;
    for (const ex of front ? [-0.055, 0.055] : [-0.03 * s, 0.035 * s]) { ell(c, hx + ex, hy - 0.13, 0.026, 0.07, ex * 3); c.fill(); c.stroke(); }
    const g = c.createRadialGradient(hx - 0.03, hy - 0.04, 0.01, hx, hy, 0.12);
    g.addColorStop(0, woolL); g.addColorStop(1, color);
    c.fillStyle = g; ell(c, hx, hy, 0.095, 0.1); c.fill(); c.stroke();
    c.fillStyle = woolL; circle(c, hx - (front ? 0 : 0.02 * s), hy - 0.09, 0.045); c.fill();
    const snx = front ? hx : hx + s * 0.07, sny = hy + (front ? 0.055 : 0.03);
    c.fillStyle = '#fff3e0'; ell(c, snx, sny, front ? 0.06 : 0.065, 0.045); c.fill(); c.stroke();
    c.fillStyle = OUTLINE;
    if (front) {
      circle(c, hx - 0.045, hy - 0.015, 0.018); c.fill(); circle(c, hx + 0.045, hy - 0.015, 0.018); c.fill();
      ell(c, snx - 0.02, sny - 0.012, 0.008, 0.012); c.fill(); ell(c, snx + 0.02, sny - 0.012, 0.008, 0.012); c.fill();
      c.fillStyle = '#fff'; circle(c, hx - 0.05, hy - 0.022, 0.006); c.fill(); circle(c, hx + 0.04, hy - 0.022, 0.006); c.fill();
    } else {
      circle(c, hx + s * 0.03, hy - 0.02, 0.018); c.fill(); ell(c, snx + s * 0.035, sny - 0.012, 0.008, 0.012); c.fill();
      c.fillStyle = '#fff'; circle(c, hx + s * 0.025, hy - 0.027, 0.006); c.fill();
    }
    const lw = c.lineWidth;
    c.lineWidth = 0.015; c.beginPath(); c.arc(snx + (front ? 0 : s * 0.02), sny + 0.008, 0.02, 0.3, Math.PI - 0.3); c.stroke();
    c.lineWidth = lw;
  }
  function woolBlob(c, cx, cy, rx, ry, color) {
    const bumps = [];
    for (let i = 0; i < 7; i++) { const a = Math.PI + i * Math.PI / 6; bumps.push([cx + Math.cos(a) * rx * 0.92, cy + Math.sin(a) * ry * 0.9, ry * 0.42]); }
    for (let i = 1; i < 6; i++) { const a = i * Math.PI / 6; bumps.push([cx + Math.cos(a) * rx * 0.9, cy + Math.sin(a) * ry * 0.85, ry * 0.36]); }
    const path = () => { c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, TAU); for (const [x, y, r] of bumps) { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); } };
    path(); c.lineWidth = 0.056; c.strokeStyle = OUTLINE; c.stroke();
    const g = c.createRadialGradient(cx - rx * 0.4, cy - ry * 0.6, 0.02, cx, cy, rx * 1.2);
    g.addColorStop(0, shadeHex(color, 1.45)); g.addColorStop(0.6, color); g.addColorStop(1, shadeHex(color, 0.72));
    c.fillStyle = g; path(); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 0.018;
    for (const [x, y, r] of bumps.slice(0, 7)) { c.beginPath(); c.arc(x, y, r * 0.5, Math.PI * 1.1, Math.PI * 1.8); c.stroke(); }
    c.strokeStyle = OUTLINE; c.lineWidth = 0.028;
  }
  function drawMount(c, color, facing, walkT, moving) {
    const step = moving ? walkT * 7 : 0;
    const hop = moving ? Math.abs(Math.sin(step)) * 0.04 : 0;
    const side = facing === 'left' ? -1 : facing === 'right' ? 1 : 0;
    const hs = side || 1;
    c.save(); c.translate(0, -hop);
    c.lineWidth = 0.028; c.strokeStyle = OUTLINE; c.lineJoin = 'round'; c.lineCap = 'round';
    const neck = (front) => {
      c.fillStyle = color;
      c.beginPath(); c.moveTo(hs * 0.13, 0.08); c.quadraticCurveTo(hs * 0.2, -0.15, hs * 0.24, -0.3); c.lineTo(hs * 0.38, -0.3); c.quadraticCurveTo(hs * 0.33, -0.12, hs * 0.31, 0.08); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = shadeHex(color, 1.3); ell(c, hs * 0.29, -0.12, 0.035, 0.09, hs * 0.2); c.fill();
      llamaHead(c, hs * 0.32, -0.38, hs, color, front);
    };
    if (facing === 'up') neck(false);
    const legs = side ? [-0.2, -0.1, 0.11, 0.21] : [-0.17, -0.06, 0.06, 0.17];
    legs.forEach((lx, i) => {
      const ph = step + (i % 2) * Math.PI;
      const swing = moving && side ? Math.sin(ph) * 0.05 : 0;
      const lift = moving && !side ? Math.max(0, Math.sin(ph)) * 0.05 : 0;
      c.fillStyle = shadeHex(color, (i === 0 || i === 3) && side ? 0.62 : 0.78);
      rr(c, lx - 0.032 + swing, 0.2, 0.064, 0.22 - lift + hop, 0.03); c.fill(); c.stroke();
      c.fillStyle = '#3a2a20'; rr(c, lx - 0.036 + swing, 0.39 - lift + hop, 0.072, 0.045, 0.015); c.fill();
    });
    if (side) { c.fillStyle = shadeHex(color, 1.2); circle(c, -side * 0.34, 0.05, 0.06); c.fill(); c.stroke(); }
    woolBlob(c, 0, 0.12, side ? 0.3 : 0.25, 0.15, color);
    if (facing === 'up') { c.fillStyle = shadeHex(color, 1.2); circle(c, 0, 0.2, 0.05); c.fill(); c.stroke(); }
    // colourful blanket
    c.save(); rr(c, -0.15, -0.05, 0.3, 0.16, 0.04); c.clip();
    ['#e8443a', '#ffd23a', '#2bb3a8', '#e8443a', '#7a4ad0'].forEach((col, i) => { c.fillStyle = col; c.fillRect(-0.15, -0.05 + i * 0.032, 0.3, 0.033); });
    c.restore();
    rr(c, -0.15, -0.05, 0.3, 0.16, 0.04); c.stroke();
    c.fillStyle = '#ffd23a'; for (const fx of [-0.12, -0.06, 0, 0.06, 0.12]) { circle(c, fx, 0.125, 0.013); c.fill(); }
    if (facing !== 'up') neck(facing === 'down');
    c.restore();
    return hop;
  }

  // ======================================================= CHARACTERS
  function headGrad(c, hy, r, light, main, dark) {
    const g = c.createRadialGradient(-r * 0.35, hy - r * 0.4, r * 0.05, 0, hy, r * 1.05);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.18, light); g.addColorStop(0.65, main); g.addColorStop(1, dark);
    return g;
  }
  function skinGrad(c, hy, r) { return headGrad(c, hy, r, SKIN[0], SKIN[1], SKIN[2]); }
  function rimLight(c, hy, r) {
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 0.025;
    c.beginPath(); c.arc(0, hy, r - 0.03, -0.2, 0.9); c.stroke();
  }
  function eyesBig(c, facing, hy, col, blink, wide) {
    const pts = facing === 'down' ? [-0.09, 0.09] : facing === 'left' ? [-0.15] : [0.15];
    for (const ex of pts) {
      if (blink) { c.strokeStyle = OUTLINE; c.lineWidth = 0.025; c.beginPath(); c.moveTo(ex - 0.05, hy + 0.01); c.lineTo(ex + 0.05, hy + 0.01); c.stroke(); continue; }
      c.fillStyle = '#fff'; ell(c, ex, hy, 0.055, 0.07); c.fill();
      c.strokeStyle = OUTLINE; c.lineWidth = 0.018; c.stroke();
      const px = facing === 'down' ? 0 : facing === 'left' ? -0.015 : 0.015;
      c.fillStyle = col || '#1b1f33'; ell(c, ex + px, hy + 0.01, wide ? 0.022 : 0.034, wide ? 0.03 : 0.05); c.fill();
      c.fillStyle = '#fff'; circle(c, ex + px - 0.012, hy - 0.012, 0.012); c.fill();
    }
  }

  const HEADS = {
    robo(c, st, f, hy, r, o) {
      c.fillStyle = st.light;
      c.beginPath(); c.moveTo(-0.05, hy - 0.24); c.quadraticCurveTo(0, hy - 0.43, 0.09, hy - 0.37); c.quadraticCurveTo(0.05, hy - 0.3, 0.06, hy - 0.22); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = headGrad(c, hy, r, st.light, st.main, st.dark); circle(c, 0, hy, r); c.fill(); c.stroke();
      rimLight(c, hy, r);
      if (f === 'down' || f === 'up') {
        c.fillStyle = st.dark;
        ell(c, -r, hy + 0.02, 0.045, 0.08); c.fill(); c.stroke();
        ell(c, r, hy + 0.02, 0.045, 0.08); c.fill(); c.stroke();
      } else {
        c.fillStyle = st.dark; ell(c, f === 'left' ? 0.13 : -0.13, hy + 0.03, 0.07, 0.09); c.fill(); c.stroke();
      }
      const eye = o.diseased ? '#b8ff5a' : o.mood === 'panic' ? '#ff6a5a' : '#7ff3ff';
      const eh = o.mood === 'panic' ? 0.06 : 0.05;
      if (f === 'down') {
        const vg = c.createLinearGradient(0, hy - 0.06, 0, hy + 0.09);
        vg.addColorStop(0, '#2a3050'); vg.addColorStop(1, '#0d1020');
        c.fillStyle = vg; rr(c, -0.2, hy - 0.06, 0.4, 0.15, 0.07); c.fill(); c.stroke();
        c.fillStyle = eye;
        if (o.scan >= 0) {
          const sxp = -0.14 + (Math.sin(o.scan * 4) * 0.5 + 0.5) * 0.28;
          c.fillStyle = 'rgba(255,74,60,0.35)'; ell(c, sxp, hy + 0.015, 0.07, 0.05); c.fill();
          c.fillStyle = '#ff4a3c'; ell(c, sxp, hy + 0.015, 0.035, 0.03); c.fill();
        } else if (o.blink || o.mood === 'happy' || o.mood === 'dance') {
          c.strokeStyle = eye; c.lineWidth = 0.025;
          c.beginPath(); c.arc(-0.08, hy + 0.03, 0.035, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
          c.beginPath(); c.arc(0.08, hy + 0.03, 0.035, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
          c.strokeStyle = OUTLINE;
        } else { ell(c, -0.08, hy + 0.015, 0.04, eh); c.fill(); ell(c, 0.08, hy + 0.015, 0.04, eh); c.fill(); }
        c.fillStyle = 'rgba(255,255,255,0.4)'; rr(c, -0.16, hy - 0.05, 0.13, 0.03, 0.015); c.fill();
      } else if (f !== 'up') {
        const s = f === 'left' ? -1 : 1;
        c.save(); c.scale(s, 1);
        c.fillStyle = '#141830'; rr(c, -0.02, hy - 0.06, 0.28, 0.15, 0.07); c.fill(); c.stroke();
        c.fillStyle = eye;
        if (o.blink) c.fillRect(0.1, hy + 0.01, 0.08, 0.02); else { ell(c, 0.15, hy + 0.015, 0.04, eh); c.fill(); }
        c.restore();
      } else {
        c.strokeStyle = st.dark; c.lineWidth = 0.05;
        c.beginPath(); c.moveTo(0, hy - r + 0.02); c.lineTo(0, hy + r - 0.06); c.stroke();
      }
    },
    kitty(c, st, f, hy, r, o) {
      const ear = (x, flip) => {
        c.fillStyle = st.main;
        c.beginPath(); c.moveTo(x - 0.11 * flip, hy - 0.14); c.lineTo(x + 0.02 * flip, hy - 0.42); c.lineTo(x + 0.12 * flip, hy - 0.12); c.closePath(); c.fill(); c.stroke();
        if (f !== 'up') { c.fillStyle = '#ffb3c8'; c.beginPath(); c.moveTo(x - 0.06 * flip, hy - 0.17); c.lineTo(x + 0.02 * flip, hy - 0.34); c.lineTo(x + 0.07 * flip, hy - 0.15); c.closePath(); c.fill(); }
      };
      if (f === 'left' || f === 'right') { const s = f === 'left' ? -1 : 1; ear(-0.02 * s, s); }
      else { ear(-0.15, 1); ear(0.15, -1); }
      c.fillStyle = headGrad(c, hy, r, st.light, st.main, st.dark); circle(c, 0, hy, r); c.fill(); c.stroke();
      rimLight(c, hy, r);
      if (f === 'up') {
        c.strokeStyle = st.dark; c.lineWidth = 0.035;
        for (const dx of [-0.08, 0, 0.08]) { c.beginPath(); c.moveTo(dx, hy - r + 0.04); c.lineTo(dx * 0.7, hy - 0.08); c.stroke(); }
        return;
      }
      const s = f === 'left' ? -1 : f === 'right' ? 1 : 0;
      c.fillStyle = 'rgba(255,255,255,0.75)'; ell(c, s * 0.1, hy + 0.1, s ? 0.12 : 0.17, 0.1); c.fill();
      eyesBig(c, f, hy - 0.01, o.diseased ? '#5a9a10' : '#1f6a3a', o.blink, o.mood === 'panic');
      c.fillStyle = '#ff7aa0'; c.beginPath(); c.moveTo(s * 0.2 - 0.025, hy + 0.06); c.lineTo(s * 0.2 + 0.025, hy + 0.06); c.lineTo(s * 0.2, hy + 0.09); c.closePath(); c.fill();
      c.strokeStyle = OUTLINE; c.lineWidth = 0.015;
      if (o.mood === 'panic') { c.fillStyle = '#5a1020'; ell(c, s * 0.2, hy + 0.14, 0.03, 0.035); c.fill(); }
      else { c.beginPath(); c.moveTo(s * 0.2 - 0.04, hy + 0.12); c.quadraticCurveTo(s * 0.2 - 0.02, hy + 0.14, s * 0.2, hy + 0.11); c.quadraticCurveTo(s * 0.2 + 0.02, hy + 0.14, s * 0.2 + 0.04, hy + 0.12); c.stroke(); }
      c.strokeStyle = 'rgba(30,20,40,0.6)';
      const wx = s ? [s] : [-1, 1];
      for (const w of wx) for (const dy of [0.07, 0.11]) { c.beginPath(); c.moveTo(s * 0.2 + w * 0.07, hy + dy); c.lineTo(s * 0.2 + w * 0.22, hy + dy + (dy - 0.09) * 1.5); c.stroke(); }
    },
    viking(c, st, f, hy, r, o) {
      c.fillStyle = skinGrad(c, hy, r); circle(c, 0, hy, r); c.fill(); c.stroke();
      if (!o.noHelmet) {
        const horn = (sxn) => {
          c.fillStyle = '#fff4dc';
          c.beginPath(); c.moveTo(sxn * 0.2, hy - 0.12); c.quadraticCurveTo(sxn * 0.42, hy - 0.16, sxn * 0.4, hy - 0.42);
          c.quadraticCurveTo(sxn * 0.3, hy - 0.24, sxn * 0.14, hy - 0.22); c.closePath(); c.fill(); c.stroke();
        };
        if (f === 'left') horn(-1); else if (f === 'right') horn(1); else { horn(-1); horn(1); }
        const hg = c.createLinearGradient(-r, hy - r, r, hy);
        hg.addColorStop(0, st.light); hg.addColorStop(0.5, st.main); hg.addColorStop(1, st.dark);
        c.fillStyle = hg;
        c.beginPath(); c.arc(0, hy, r + 0.01, Math.PI, 0); c.lineTo(r + 0.01, hy - 0.02); c.lineTo(-r - 0.01, hy - 0.02); c.closePath(); c.fill(); c.stroke();
        c.fillStyle = '#c9ced8'; rr(c, -r - 0.02, hy - 0.07, 2 * r + 0.04, 0.07, 0.03); c.fill(); c.stroke();
        c.fillStyle = '#8a909c';
        for (const dx of [-0.17, -0.06, 0.06, 0.17]) { circle(c, dx, hy - 0.035, 0.012); c.fill(); }
      } else {
        c.fillStyle = '#c0682a'; c.beginPath(); c.arc(0, hy - 0.02, r, Math.PI, 0); c.fill(); c.stroke();
      }
      if (f === 'up') { c.fillStyle = '#c0682a'; ell(c, 0, hy + 0.14, 0.2, 0.1); c.fill(); c.stroke(); return; }
      const s = f === 'left' ? -1 : f === 'right' ? 1 : 0;
      c.fillStyle = OUTLINE;
      const eyes = s ? [s * 0.14] : [-0.08, 0.08];
      for (const ex of eyes) {
        if (o.blink || o.mood === 'happy' || o.mood === 'dance') { c.fillRect(ex - 0.03, hy + 0.01, 0.06, 0.015); }
        else { ell(c, ex, hy + 0.02, o.mood === 'panic' ? 0.035 : 0.025, o.mood === 'panic' ? 0.045 : 0.035); c.fill(); }
      }
      const bg = c.createLinearGradient(0, hy + 0.04, 0, hy + 0.32);
      bg.addColorStop(0, '#e08a3a'); bg.addColorStop(1, '#a04e1a');
      c.fillStyle = bg;
      const bx = s * 0.08;
      c.beginPath();
      c.moveTo(bx - 0.22, hy + 0.04);
      c.quadraticCurveTo(bx - 0.22, hy + 0.3, bx, hy + 0.33);
      c.quadraticCurveTo(bx + 0.22, hy + 0.3, bx + 0.22, hy + 0.04);
      c.quadraticCurveTo(bx, hy + 0.12, bx - 0.22, hy + 0.04);
      c.fill(); c.stroke();
      c.fillStyle = '#e8a080'; circle(c, s * 0.2 || 0, hy + 0.07, 0.04); c.fill();
      c.strokeStyle = 'rgba(90,40,10,0.6)'; c.lineWidth = 0.015;
      c.beginPath(); c.moveTo(bx - 0.06, hy + 0.15); c.lineTo(bx - 0.04, hy + 0.27); c.moveTo(bx + 0.06, hy + 0.15); c.lineTo(bx + 0.04, hy + 0.27); c.stroke();
    },
    ninja(c, st, f, hy, r, o, t) {
      const tailSide = f === 'left' ? 1 : f === 'right' ? -1 : 1;
      c.strokeStyle = st.main; c.lineWidth = 0.06; c.lineCap = 'round';
      for (let k = 0; k < 2; k++) {
        const w = Math.sin(t * 10 + k) * 0.05;
        c.beginPath(); c.moveTo(tailSide * 0.2, hy - 0.08); c.quadraticCurveTo(tailSide * 0.36, hy - 0.04 + k * 0.06 + w, tailSide * 0.46, hy + 0.04 + k * 0.08 - w); c.stroke();
      }
      c.fillStyle = headGrad(c, hy, r, shadeHex(st.dark, 1.3), shadeHex(st.dark, 0.85), shadeHex(st.dark, 0.5));
      c.lineWidth = 0.03; c.strokeStyle = OUTLINE; circle(c, 0, hy, r); c.fill(); c.stroke();
      rimLight(c, hy, r);
      const bg = c.createLinearGradient(0, hy - 0.16, 0, hy - 0.08);
      bg.addColorStop(0, st.light); bg.addColorStop(1, st.main);
      c.save(); circle(c, 0, hy, r); c.clip();
      c.fillStyle = bg; c.fillRect(-r, hy - 0.17, 2 * r, 0.08);
      c.restore();
      if (f === 'up') { c.fillStyle = st.main; circle(c, 0, hy - 0.13, 0.05); c.fill(); c.stroke(); return; }
      const s = f === 'left' ? -1 : f === 'right' ? 1 : 0;
      c.fillStyle = SKIN[0];
      rr(c, s * 0.08 - (s ? 0.13 : 0.19), hy - 0.06, s ? 0.26 : 0.38, 0.1, 0.04); c.fill(); c.stroke();
      const eyes = s ? [s * 0.14] : [-0.08, 0.08];
      for (const ex of eyes) {
        if (o.blink || o.mood === 'happy' || o.mood === 'dance') { c.fillStyle = OUTLINE; c.fillRect(ex - 0.035, hy - 0.01, 0.07, 0.015); continue; }
        c.fillStyle = '#fff'; ell(c, ex, hy - 0.01, 0.04, o.mood === 'panic' ? 0.04 : 0.03); c.fill();
        c.fillStyle = o.diseased ? '#5a9a10' : OUTLINE; circle(c, ex + s * 0.01, hy - 0.008, o.mood === 'panic' ? 0.012 : 0.02); c.fill();
      }
      c.strokeStyle = OUTLINE; c.lineWidth = 0.02;
      for (const ex of eyes) { c.beginPath(); c.moveTo(ex - 0.045, hy - 0.06); c.lineTo(ex + 0.045, hy - 0.045 + (ex < 0 ? 0.01 : -0.01)); c.stroke(); }
    },
    punk(c, st, f, hy, r, o) {
      c.fillStyle = skinGrad(c, hy, r); circle(c, 0, hy, r); c.fill(); c.stroke();
      const mg = c.createLinearGradient(0, hy - 0.5, 0, hy - 0.2);
      mg.addColorStop(0, st.light); mg.addColorStop(1, st.dark);
      c.fillStyle = mg;
      if (f === 'left' || f === 'right') {
        const s = f === 'left' ? -1 : 1;
        c.beginPath(); c.moveTo(s * 0.15, hy - 0.22);
        for (const [x, y] of [[0.12, -0.45], [0.04, -0.3], [-0.02, -0.5], [-0.08, -0.31], [-0.16, -0.46], [-0.2, -0.24], [-0.27, -0.36], [-0.25, -0.1]]) c.lineTo(s * x, hy + y);
        c.closePath(); c.fill(); c.stroke();
      } else {
        c.beginPath(); c.moveTo(-0.06, hy - 0.23); c.lineTo(0, hy - 0.56); c.lineTo(0.06, hy - 0.23); c.closePath(); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(-0.05, hy - 0.24); c.lineTo(-0.03, hy - 0.46); c.lineTo(0.02, hy - 0.26); c.closePath(); c.fill(); c.stroke();
      }
      if (f === 'up') { c.fillStyle = st.dark; c.fillRect(-0.05, hy - 0.25, 0.1, 0.4); return; }
      const s = f === 'left' ? -1 : f === 'right' ? 1 : 0;
      if (!o.noShades) {
        c.fillStyle = '#121218';
        if (s) { rr(c, s * 0.06 - 0.06, hy - 0.05, 0.18, 0.09, 0.04); c.fill(); c.fillRect(s > 0 ? -0.2 : 0.02, hy - 0.03, 0.18, 0.025); }
        else { rr(c, -0.2, hy - 0.05, 0.17, 0.09, 0.04); c.fill(); rr(c, 0.03, hy - 0.05, 0.17, 0.09, 0.04); c.fill(); c.fillRect(-0.04, hy - 0.03, 0.08, 0.025); }
        c.fillStyle = 'rgba(255,255,255,0.6)';
        if (s) c.fillRect(s * 0.06 - 0.03, hy - 0.035, 0.05, 0.015); else { c.fillRect(-0.17, hy - 0.035, 0.05, 0.015); c.fillRect(0.06, hy - 0.035, 0.05, 0.015); }
      } else {
        eyesBig(c, f, hy - 0.01, '#1b1f33', false, true);
      }
      c.strokeStyle = OUTLINE; c.lineWidth = 0.02;
      if (o.mood === 'panic') { c.fillStyle = '#5a1020'; ell(c, s * 0.12, hy + 0.13, 0.04, 0.04); c.fill(); }
      else if (o.mood === 'happy' || o.mood === 'dance') { c.beginPath(); c.arc(s * 0.12, hy + 0.08, 0.06, 0.3, Math.PI - 0.3); c.stroke(); }
      else { c.beginPath(); c.moveTo(s * 0.12 - 0.06, hy + 0.12); c.quadraticCurveTo(s * 0.12, hy + 0.15, s * 0.12 + 0.07, hy + 0.1); c.stroke(); }
      if (!s || s < 0) { c.fillStyle = '#ffd34a'; circle(c, s ? 0.2 : r - 0.01, hy + 0.08, 0.025); c.fill(); }
    },
    alien(c, st, f, hy, r, o) {
      c.fillStyle = st.dark;
      const hornX = f === 'left' || f === 'right' ? [f === 'left' ? 0.05 : -0.05] : [-0.12, 0.12];
      for (const hx of hornX) { c.beginPath(); c.moveTo(hx - 0.045, hy - r + 0.04); c.lineTo(hx + hx * 0.4, hy - r - 0.12); c.lineTo(hx + 0.045, hy - r + 0.04); c.closePath(); c.fill(); c.stroke(); }
      const g = c.createRadialGradient(-0.09, hy - 0.14, 0.02, 0, hy, r * 1.1);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.2, st.light); g.addColorStop(0.7, st.main); g.addColorStop(1, st.dark);
      c.fillStyle = g; ell(c, 0, hy - 0.01, r * 1.02, r * 1.08); c.fill(); c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.25)';
      circle(c, 0.16, hy - 0.16, 0.035); c.fill(); circle(c, 0.21, hy - 0.06, 0.02); c.fill();
      if (f === 'up') return;
      const s = f === 'left' ? -1 : f === 'right' ? 1 : 0;
      const ex = s * 0.11, ey = hy - 0.02;
      if (o.blink || o.mood === 'happy' || o.mood === 'dance') { c.strokeStyle = OUTLINE; c.lineWidth = 0.03; c.beginPath(); c.arc(ex, ey + 0.04, 0.07, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); }
      else {
        const big = o.mood === 'panic' ? 1.15 : 1;
        c.fillStyle = '#fff'; ell(c, ex, ey, (s ? 0.08 : 0.11) * big, 0.1 * big); c.fill(); c.strokeStyle = OUTLINE; c.lineWidth = 0.022; c.stroke();
        const pr = o.mood === 'panic' ? 0.03 : 0.055;
        const ig = c.createRadialGradient(ex + s * 0.02, ey, 0, ex + s * 0.02, ey, pr * 1.1);
        ig.addColorStop(0, '#111'); ig.addColorStop(0.5, o.diseased ? '#6ab010' : '#7a2ad0'); ig.addColorStop(1, o.diseased ? '#2a5a00' : '#2a0a5a');
        c.fillStyle = ig; circle(c, ex + s * 0.025, ey + 0.01, pr); c.fill();
        c.fillStyle = '#fff'; circle(c, ex + s * 0.025 - 0.02, ey - 0.015, 0.016); c.fill();
      }
      c.strokeStyle = OUTLINE; c.lineWidth = 0.02;
      c.beginPath(); c.arc(s * 0.12, hy + 0.13, 0.04, 0.2, Math.PI - 0.2); c.stroke();
    },
  };

  function drawGuitar(c, k) {
    c.save(); c.translate(0.0, 0.18); c.rotate(-0.55);
    c.lineWidth = 0.022; c.strokeStyle = OUTLINE;
    c.fillStyle = '#6a4220'; c.fillRect(-0.44, -0.022, 0.34, 0.044); c.strokeRect(-0.44, -0.022, 0.34, 0.044);
    c.fillStyle = '#26262e'; rr(c, -0.53, -0.04, 0.1, 0.08, 0.015); c.fill(); c.stroke();
    c.fillStyle = '#d8262a';
    c.beginPath(); c.arc(-0.03, 0, 0.1, 0, TAU); c.moveTo(0.22, 0); c.arc(0.09, 0, 0.13, 0, TAU); c.fill();
    c.beginPath(); c.arc(-0.03, 0, 0.1, 0, TAU); c.stroke(); c.beginPath(); c.arc(0.09, 0, 0.13, 0, TAU); c.stroke();
    c.fillStyle = '#d8262a'; c.fillRect(-0.04, -0.09, 0.12, 0.18);
    c.fillStyle = '#111'; circle(c, 0.04, 0, 0.035); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 0.006;
    for (const dy of [-0.012, 0, 0.012]) { c.beginPath(); c.moveTo(-0.5, dy); c.lineTo(0.18, dy); c.stroke(); }
    c.restore();
  }
  function drawMug(c, x, y, rot) {
    c.save(); c.translate(x, y); c.rotate(rot);
    c.lineWidth = 0.022; c.strokeStyle = OUTLINE;
    c.beginPath(); c.arc(0.06, 0, 0.035, -1.3, 1.3); c.stroke();
    c.fillStyle = '#8a5a30'; rr(c, -0.05, -0.07, 0.1, 0.14, 0.02); c.fill(); c.stroke();
    c.fillStyle = '#c9ced8'; c.fillRect(-0.05, -0.045, 0.1, 0.018); c.fillRect(-0.05, 0.035, 0.1, 0.018);
    c.fillStyle = '#fffbe8';
    for (const [a, b, r] of [[-0.03, -0.075, 0.03], [0.01, -0.085, 0.035], [0.04, -0.072, 0.025]]) { circle(c, a, b, r); c.fill(); }
    c.restore();
  }
  function drawGlove(c, gx, gy) {
    const gg = c.createRadialGradient(gx - 0.025, gy - 0.025, 0.005, gx, gy, 0.08);
    gg.addColorStop(0, '#ffffff'); gg.addColorStop(1, '#c8c8d8');
    c.fillStyle = gg; circle(c, gx, gy, 0.072); c.fill(); c.stroke();
  }

  function drawBomberCore(c, x, y, st, o) {
    let facing = o.facing || 'down';
    const moving = !!o.moving;
    const t = o.t || 0;
    const walk = o.walkT || 0;
    const ch = HEADS[o.char] ? o.char : 'robo';
    const idle = typeof o.idle === 'number' ? o.idle : -1; // seconds into the idle routine
    c.save();
    c.translate(x, y);
    const sc = (o.scale || 1) * 1.06 * (o.big ? PLAYER_SCALE : 1);
    c.scale(sc, sc);
    if (o.rot) c.rotate(o.rot);
    if (o.alpha !== undefined) c.globalAlpha *= o.alpha;
    if (o.squash) { c.translate(0, 0.42); c.scale(1 + o.squash, 1 - o.squash); c.translate(0, -0.42); }
    if (o.mood === 'panic') c.translate(Math.sin(t * 70) * 0.018, 0);
    c.lineJoin = 'round'; c.lineCap = 'round';
    if (o.mount) { const lift = drawMount(c, o.mount.color, facing, walk, moving); c.translate(0, -0.25 - lift); c.scale(0.9, 0.9); }
    if (idle >= 0 && (ch === 'ninja' || ch === 'alien')) c.translate(0, -(0.1 + Math.sin(idle * 2.2) * 0.04));
    let sw = moving ? Math.sin(walk * 7) : 0;
    let bob = moving ? Math.abs(sw) * 0.05 : Math.sin(t * 3) * 0.012;
    if (o.mood === 'dance') { sw = Math.sin(t * 8); bob = Math.abs(sw) * 0.07; }
    const sitting = o.sitting || (idle >= 0 && ch === 'ninja');
    let tilt = 0, beat = 0;
    if (idle >= 0 && ch === 'robo') { beat = Math.floor(idle * 3) % 4; tilt = [0.07, -0.07, 0.07, -0.07][beat]; bob = (beat % 2) * 0.03; }
    if (idle >= 0 && ch === 'punk') bob = Math.abs(Math.sin(idle * 8)) * 0.045;
    c.lineWidth = 0.032; c.strokeStyle = OUTLINE;
    if (ch === 'kitty' && (facing !== 'down' || idle >= 0)) {
      c.strokeStyle = st.dark; c.lineWidth = 0.06;
      const tx = facing === 'left' ? 0.18 : facing === 'right' ? -0.18 : 0.2;
      const wag = Math.sin(t * (idle >= 0 ? 3 : 5)) * (idle >= 0 ? 0.12 : 0.05);
      c.beginPath(); c.moveTo(tx * 0.8, 0.27); c.quadraticCurveTo(tx * 2.2 + wag, 0.15, tx * 1.8 + wag, -0.05); c.stroke();
      c.lineWidth = 0.032; c.strokeStyle = OUTLINE;
    }
    if (!o.mount) {
      const feet = sitting
        ? [[-0.17, 0.38, 0], [0.17, 0.38, 0]]
        : idle >= 0 && ch === 'robo'
          ? [[-0.12, 0.37, beat === 0 ? 0.7 : 0], [0.12, 0.37, beat === 1 ? 0.7 : 0]]
          : [[-0.12, 0.37, Math.max(0, sw)], [0.12, 0.37, o.footTap ? Math.max(0, Math.sin(t * 14)) * 0.8 : Math.max(0, -sw)]];
      for (const [fx, fy, lift] of feet) {
        const fg = c.createLinearGradient(0, 0.3, 0, 0.44);
        fg.addColorStop(0, '#4a4a62'); fg.addColorStop(1, '#1e1e2c');
        c.fillStyle = fg; ell(c, fx, fy - lift * 0.06, 0.1, 0.065); c.fill(); c.stroke();
      }
    }
    c.translate(0, -bob + (sitting ? 0.08 : 0));
    if (tilt) c.rotate(tilt);
    const bodyMain = ch === 'ninja' ? shadeHex(st.dark, 0.8) : st.main;
    let g = c.createRadialGradient(-0.08, 0.08, 0.02, 0, 0.17, 0.24);
    g.addColorStop(0, shadeHex(bodyMain, 1.45)); g.addColorStop(0.55, bodyMain); g.addColorStop(1, shadeHex(bodyMain, 0.55));
    c.fillStyle = g; ell(c, 0, 0.17, 0.2, 0.17); c.fill(); c.stroke();
    c.fillStyle = '#26263a'; c.fillRect(-0.19, 0.19, 0.38, 0.05);
    c.fillStyle = '#ffd34a'; rr(c, -0.04, 0.18, 0.08, 0.07, 0.015); c.fill();
    if (idle >= 0 && ch === 'punk') { drawGuitar(c, idle); c.lineWidth = 0.032; c.strokeStyle = OUTLINE; }
    const wave = Math.sin(t * 12) * 0.04;
    let gloves;
    const late = []; // gloves drawn in front of the head
    if (idle >= 0 && ch === 'robo') gloves = [[[-0.3, -0.1], [0.32, 0.12]], [[-0.32, 0.12], [0.3, -0.1]], [[-0.3, -0.1], [0.3, -0.1]], [[-0.18, 0.04], [0.18, 0.04]]][beat];
    else if (idle >= 0 && ch === 'punk') gloves = [[-0.3, -0.02], [0.06, 0.2 + Math.sin(idle * 22) * 0.05]];
    else if (idle >= 0 && ch === 'ninja') gloves = [[-0.045, 0.1], [0.045, 0.1]];
    else if (idle >= 0 && ch === 'alien') gloves = [[-0.3, -0.12 + Math.sin(idle * 3) * 0.05], [0.3, -0.12 - Math.sin(idle * 3) * 0.05]];
    else if (idle >= 0 && ch === 'kitty') { gloves = [[0.25, 0.13]]; late.push([-0.09 + Math.cos(idle * 9) * 0.035, -0.06 + Math.sin(idle * 9) * 0.03]); }
    else if (idle >= 0 && ch === 'viking') {
      const p = (idle % 3) / 3;
      if (p < 0.45) { gloves = [[-0.25, 0.13]]; late.push([0.1, 0.0]); }
      else gloves = [[-0.25, 0.13], [0.27, 0.12]];
    }
    else gloves = o.armsUp ? [[-0.29, -0.12 + wave], [0.29, -0.12 - wave]]
      : sitting ? [[-0.2, 0.27], [0.2, 0.27]]
      : [[-0.25, 0.13 + sw * 0.05], [0.25, 0.13 - sw * 0.05]];
    if (idle >= 0 && ch === 'viking' && !late.length) drawMug(c, 0.27, 0.06, 0);
    for (const [gx, gy] of gloves) drawGlove(c, gx, gy);
    c.fillStyle = 'rgba(0,0,0,0.22)'; ell(c, 0, 0.05, 0.17, 0.05); c.fill();
    const hy = -0.15 + (sitting && o.mood === 'sad' ? 0.04 : 0), r = 0.275;
    c.lineWidth = 0.032; c.strokeStyle = OUTLINE;
    const closed = idle >= 0 && (ch === 'ninja' || ch === 'kitty');
    HEADS[ch](c, st, facing, hy, r, {
      blink: closed || Math.sin(t * 1.7 + st.main.length) > 0.97, diseased: !!o.diseased, mood: o.mood,
      noHelmet: o.noHelmet, noShades: o.noShades, scan: idle >= 0 && ch === 'robo' ? idle : -1,
    }, t);
    c.fillStyle = 'rgba(255,255,255,0.5)'; ell(c, -0.1, hy - 0.16, 0.06, 0.035, -0.5); c.fill();
    c.lineWidth = 0.032; c.strokeStyle = OUTLINE;
    // idle routine props in front of the head
    if (idle >= 0) {
      if (ch === 'viking' && late.length) drawMug(c, 0.06, -0.04, -1.1);
      for (const [gx, gy] of late) drawGlove(c, gx, gy);
      if (ch === 'viking') {
        const p = (idle % 3) / 3;
        if (p > 0.5 && p < 0.8) { const k = (p - 0.5) / 0.3; c.globalAlpha *= 1 - k; c.strokeStyle = '#ffffff'; c.lineWidth = 0.02; circle(c, 0.12 + k * 0.05, hy - 0.05 - k * 0.35, 0.03 + k * 0.05); c.stroke(); c.globalAlpha /= Math.max(0.01, 1 - k); }
      }
      if (ch === 'ninja') {
        c.strokeStyle = rgba(st.light, 0.25 + 0.2 * Math.sin(idle * 3)); c.lineWidth = 0.025;
        ell(c, 0, 0.0, 0.42, 0.52); c.stroke();
        c.strokeStyle = rgba(st.light, 0.15 + 0.15 * Math.sin(idle * 3 + 1)); ell(c, 0, 0.0, 0.5, 0.6); c.stroke();
      }
      if (ch === 'punk') {
        c.fillStyle = '#ffffff'; c.strokeStyle = '#ffffff'; c.lineWidth = 0.018;
        for (let i = 0; i < 2; i++) {
          const k = (idle * 0.8 + i * 0.5) % 1, nx = 0.28 + k * 0.12 + i * 0.06, ny = hy - 0.15 - k * 0.45;
          c.globalAlpha = 1 - k;
          ell(c, nx, ny, 0.032, 0.024, -0.4); c.fill();
          c.beginPath(); c.moveTo(nx + 0.028, ny); c.lineTo(nx + 0.028, ny - 0.11); c.quadraticCurveTo(nx + 0.07, ny - 0.09, nx + 0.06, ny - 0.05); c.stroke();
        }
        c.globalAlpha = 1;
      }
      if (ch === 'alien') {
        ['#7dff9a', '#c58cff', '#7fe8ff'].forEach((col, i) => {
          const a = idle * 3 + i * TAU / 3, bx = Math.cos(a) * 0.24, by = hy - 0.5 + Math.sin(a) * 0.09;
          const og = c.createRadialGradient(bx, by, 0, bx, by, 0.1);
          og.addColorStop(0, '#ffffff'); og.addColorStop(0.35, col); og.addColorStop(1, 'rgba(0,0,0,0)');
          c.fillStyle = og; circle(c, bx, by, 0.1); c.fill();
        });
      }
    }
    if (o.mood === 'panic') {
      c.fillStyle = '#8fd8ff'; c.strokeStyle = 'rgba(20,60,120,0.6)'; c.lineWidth = 0.015;
      for (const [dx, ph] of [[0.29, 0], [-0.3, 0.5]]) { const k = (t * 2.2 + ph) % 1; drop(c, dx, hy - 0.12 + k * 0.2, 0.035); c.fill(); c.stroke(); }
    } else if (o.mood === 'sad') {
      c.fillStyle = '#8fd8ff';
      const k = (t * 0.9) % 1;
      if (facing === 'down') { drop(c, -0.1, hy + 0.06 + k * 0.18, 0.025); c.fill(); drop(c, 0.1, hy + 0.06 + ((k + 0.5) % 1) * 0.18, 0.025); c.fill(); }
    } else if (o.mood === 'happy' || o.mood === 'dance') {
      c.fillStyle = '#fff6a0';
      for (let i = 0; i < 3; i++) { const a = t * 4 + i * TAU / 3; star(c, Math.cos(a) * 0.38, hy - 0.05 + Math.sin(a) * 0.15, 0.045); c.fill(); }
    }
    c.restore();
  }

  // Tinted / flashing characters are composed off-screen so the tint never touches the floor.
  function drawBomber(c, x, y, st, o) {
    if (!o.flashWhite && !o.tint) { drawBomberCore(c, x, y, st, o); return; }
    const s = ts * dpr, size = Math.ceil(2.4 * s);
    if (!scratch) scratch = document.createElement('canvas');
    if (scratch.width !== size) { scratch.width = size; scratch.height = size; }
    const sc = scratch.getContext('2d');
    sc.setTransform(1, 0, 0, 1, 0, 0); sc.clearRect(0, 0, size, size);
    sc.globalAlpha = 1;
    sc.setTransform(s, 0, 0, s, 1.2 * s, 1.5 * s);
    drawBomberCore(sc, 0, 0, st, o);
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.globalCompositeOperation = 'source-atop';
    sc.fillStyle = o.flashWhite ? 'rgba(255,255,255,0.85)' : o.tint;
    sc.fillRect(0, 0, size, size);
    sc.globalCompositeOperation = 'source-over';
    c.drawImage(scratch, x - 1.2, y - 1.5, 2.4, 2.4);
  }

  function ps(p) {
    return pstate[p.id] || (pstate[p.id] = { lastFacing: p.facing, idleT: 0, landT: 9, cheerT: 9, tint: null, introDone: false, stepT: 0, dustT: 0, panic: false, stinkT: 0 });
  }

  function drawPlayer(c, p, t, game) {
    const s = ps(p);
    if (!p.alive) { drawDeath(c, p, t); return; }
    let dropY = 0;
    if (game.phase === 'countdown') {
      const el = RULES.countdown - game.phaseT - p.id * 0.3;
      if (el < 0) return;
      const k = Math.min(1, el / 0.45);
      dropY = -(1 - k) * (1 - k) * 7;
      if (k >= 1 && !s.introDone) {
        s.introDone = true; s.landT = 0;
        for (let i = 0; i < 6; i++) addParticle({ type: 'smoke', x: p.x + (Math.random() - 0.5) * 0.6, y: p.y + 0.38, vx: (Math.random() - 0.5) * 2.5, vy: -0.4, life: 0.5, size: 0.13, drag: 3 });
        popups.push({ text: p.name, x: p.x, y: p.y - 0.95, age: 0, life: 1.3, color: p.style.light });
      }
    }
    if (p.invuln > 0 && Math.floor(t * 14) % 2 === 0) return;
    const squash = s.landT < 0.5 ? 0.28 * Math.exp(-s.landT * 9) * Math.cos(s.landT * 24) : 0;
    let mood = null, facing = p.facing, armsUp = false, footTap = false, idle = null;
    const aliveCount = game.players.filter(q => q.alive).length;
    if ((game.phase === 'over' || game.ending) && aliveCount === 1) {
      mood = 'dance'; armsUp = Math.floor(t * 4) % 2 === 0;
      facing = ['down', 'left', 'down', 'right'][Math.floor(t * 4) % 4];
      dropY -= Math.abs(Math.sin(t * 8)) * 0.15;
    } else if (s.panic) mood = 'panic';
    else if (s.cheerT < 0.7) { mood = 'happy'; armsUp = true; }
    else if (!p.moving && game.phase === 'play' && s.idleT > 2.5) {
      if (s.idleT > 4.5 && !p.mount) { idle = s.idleT - 4.5; facing = 'down'; }
      else {
        const ph = (s.idleT - 2.5) % 2;
        if (ph < 0.7) facing = 'left'; else if (ph < 1.4) facing = 'right'; else footTap = true;
      }
    }
    const baseY = p.y - (p.h || 0) + dropY;
    if (p.disease && p.disease.type === 'hyper' && p.moving) {
      const d = DIRS[p.facing];
      for (let i = 2; i >= 1; i--) drawBomberCore(c, p.x - d.x * 0.18 * i, baseY - d.y * 0.18 * i, p.style, { char: p.char, facing, moving: true, walkT: p.walkT - i * 0.05, t, mount: p.mount, alpha: 0.18 * (3 - i), big: true });
    }
    let tint = null;
    if (s.tint) tint = rgba(s.tint.color, 0.55 * Math.max(0, s.tint.t / 0.35));
    drawBomber(c, p.x, baseY, p.style, {
      char: p.char, facing, moving: p.moving || mood === 'dance', walkT: p.walkT, t, mount: p.mount, diseased: !!p.disease,
      squash, mood, armsUp, footTap, tint, idle, big: true,
    });
    if (p.mount && p.mount.cd <= 0 && (p.mount.type === 'jump' || p.mount.type === 'dash')) {
      c.fillStyle = p.mount.color; c.strokeStyle = OUTLINE; c.lineWidth = 0.02;
      circle(c, p.x - 0.42, baseY + 0.3, 0.07); c.fill(); c.stroke();
    }
    if (p.disease) drawDisease(c, p, baseY - 0.18 - (p.mount ? 0.25 : 0), t);
    if (p.stun > 0) {
      c.save(); c.fillStyle = '#ffe36a';
      for (let i = 0; i < 3; i++) { const a = t * 6 + i * TAU / 3; star(c, p.x + Math.cos(a) * 0.3, baseY - 0.8 + Math.sin(a) * 0.08, 0.07); c.fill(); }
      c.restore();
    }
  }

  function drawDisease(c, p, y, t) {
    const x = p.x;
    c.save();
    // small skull marker
    c.save(); c.translate(x + 0.3, y - 0.62); c.scale(0.35, 0.35); c.globalAlpha = 0.85; drawItemIcon(c, 'skull', t); c.restore();
    c.lineCap = 'round';
    switch (p.disease.type) {
      case 'diarrhea':
        c.strokeStyle = 'rgba(130,200,60,0.75)'; c.lineWidth = 0.035;
        for (let i = 0; i < 3; i++) {
          const k = (t * 0.7 + i / 3) % 1, bx = x - 0.2 + i * 0.2;
          c.globalAlpha = 1 - k;
          c.beginPath();
          for (let j = 0; j <= 6; j++) { const yy = y + 0.1 - k * 0.6 - j * 0.05; const xx = bx + Math.sin(j * 1.4 + t * 6 + i) * 0.04; j ? c.lineTo(xx, yy) : c.moveTo(xx, yy); }
          c.stroke();
        }
        break;
      case 'reverse':
        c.fillStyle = '#d08cff';
        for (let i = 0; i < 4; i++) { const a = -t * 5 + i * TAU / 4; star(c, x + Math.cos(a) * 0.3, y - 0.5 + Math.sin(a) * 0.1, 0.05); c.fill(); }
        break;
      case 'hyper':
        c.strokeStyle = '#fff36a'; c.lineWidth = 0.03;
        for (let i = 0; i < 2; i++) { const a = t * 13 + i * 3; const bx = x + Math.cos(a) * 0.3, by = y - 0.2 + Math.sin(a * 1.3) * 0.25; c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + 0.05, by + 0.06); c.lineTo(bx - 0.01, by + 0.08); c.lineTo(bx + 0.05, by + 0.15); c.stroke(); }
        break;
      case 'slow': {
        c.strokeStyle = 'rgba(160,200,255,0.9)'; c.lineWidth = 0.03;
        for (let i = 0; i < 2; i++) {
          const k = (t * 0.5 + i * 0.5) % 1, zx2 = x + 0.25 + k * 0.15, zy2 = y - 0.55 - k * 0.35, zs = 0.06 + k * 0.04;
          c.globalAlpha = 1 - k;
          c.beginPath(); c.moveTo(zx2 - zs, zy2 - zs); c.lineTo(zx2 + zs, zy2 - zs); c.lineTo(zx2 - zs, zy2 + zs); c.lineTo(zx2 + zs, zy2 + zs); c.stroke();
        }
        break;
      }
      case 'constipation':
        c.save(); c.translate(x, y - 0.82); c.scale(0.45, 0.45); drawItemIcon(c, 'bomb', t); c.restore();
        c.strokeStyle = '#ff3a3a'; c.lineWidth = 0.035;
        circle(c, x, y - 0.82, 0.11); c.stroke();
        c.beginPath(); c.moveTo(x - 0.08, y - 0.9); c.lineTo(x + 0.08, y - 0.74); c.stroke();
        break;
      case 'shortfuse':
        c.strokeStyle = '#ffe36a'; c.lineWidth = 0.02;
        c.beginPath();
        for (let i = 0; i < 7; i++) { const a = t * 20 + i; const l = 0.05 + 0.05 * Math.abs(Math.sin(t * 30 + i)); c.moveTo(x, y - 0.8); c.lineTo(x + Math.cos(a) * l, y - 0.8 + Math.sin(a) * l); }
        c.stroke();
        break;
      case 'tinyflame': {
        const s = 0.25 + 0.05 * Math.sin(t * 10);
        c.save(); c.translate(x, y - 0.8); c.scale(s, s); drawItemIcon(c, 'fire', t); c.restore();
        c.fillStyle = '#7fd0ff';
        c.beginPath(); c.moveTo(x + 0.1, y - 0.85); c.lineTo(x + 0.16, y - 0.85); c.lineTo(x + 0.13, y - 0.78); c.closePath(); c.fill();
        break;
      }
    }
    c.restore();
  }

  function drawDeath(c, p, t) {
    const d = p.deadT;
    if (d > 1.6) return;
    switch (p.char) {
      case 'robo':  // falls apart (parts are particles)
        if (d < 0.15) drawBomber(c, p.x, p.y, p.style, { char: p.char, t, flashWhite: true, big: true });
        return;
      case 'ninja': // poof (smoke + log are particles)
        if (d < 0.08) drawBomberCore(c, p.x, p.y, p.style, { char: p.char, t, big: true });
        return;
      case 'alien': { // beamed up
        const a = Math.max(0, 1 - d / 1.6);
        const g = c.createLinearGradient(p.x - 0.45, 0, p.x + 0.45, 0);
        g.addColorStop(0, 'rgba(160,255,200,0)'); g.addColorStop(0.5, `rgba(200,255,220,${0.55 * a})`); g.addColorStop(1, 'rgba(160,255,200,0)');
        c.fillStyle = g; c.fillRect(p.x - 0.45, p.y - 8, 0.9, 8.45);
        drawBomberCore(c, p.x, p.y - d * d * 2.5, p.style, { char: p.char, t, facing: 'down', scale: Math.max(0.05, 1 - d * 0.55), alpha: a, mood: 'panic', big: true });
        return;
      }
      default: {
        const o = { char: p.char, facing: 'down', t, noHelmet: p.char === 'viking', noShades: p.char === 'punk', mood: 'panic', big: true };
        if (d < 0.5) drawBomber(c, p.x, p.y, p.style, Object.assign(o, { flashWhite: Math.floor(d * 16) % 2 === 0, scale: 1 + d * 0.15 }));
        else { const k = Math.min(1, (d - 0.5) / 0.9); drawBomberCore(c, p.x, p.y - k * 0.3, p.style, Object.assign(o, { scale: Math.max(0.05, 1 - k * 0.9), rot: k * 9, alpha: 1 - k })); }
      }
    }
  }

  function drawGhost(c, game, p, t) {
    const pos = game.ghostPos(p);
    const tile = game.ghostTile(p);
    const dir = ringInward(tile);
    const bob = Math.sin(t * 4 + p.id) * 0.05;
    const ready = p.ghost.cd <= 0 && p.bombsOut < 1 && dir;
    c.save();
    if (dir) {
      const d = DIRS[dir];
      c.globalAlpha = ready ? 0.9 : 0.35;
      c.fillStyle = p.style.main; c.strokeStyle = OUTLINE; c.lineWidth = 0.025;
      c.save(); c.translate(pos.x + d.x * 0.62, pos.y + d.y * 0.62 - 0.1); c.rotate(DIR_ANGLE[dir]);
      c.beginPath(); c.moveTo(0.14, 0); c.lineTo(-0.08, -0.12); c.lineTo(-0.08, 0.12); c.closePath(); c.fill(); c.stroke();
      c.restore();
      if (ready) {
        const lx = tile.x + d.x * RULES.ghostThrow + 0.5, ly = tile.y + d.y * RULES.ghostThrow + 0.5;
        c.globalAlpha = 0.35 + 0.2 * Math.sin(t * 8);
        c.strokeStyle = p.style.main; c.lineWidth = 0.05;
        c.setLineDash([0.1, 0.08]); circle(c, lx, ly, 0.3); c.stroke(); c.setLineDash([]);
      }
    }
    c.globalAlpha = 0.95;
    for (const [dx, dy, r] of [[-0.22, 0.28, 0.14], [0.22, 0.28, 0.14], [0, 0.3, 0.18], [-0.1, 0.2, 0.13], [0.12, 0.2, 0.13]]) {
      const g = c.createRadialGradient(pos.x + dx - 0.04, pos.y + dy + bob - 0.05, 0.01, pos.x + dx, pos.y + dy + bob, r);
      g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#c9c4e8');
      c.fillStyle = g; circle(c, pos.x + dx, pos.y + dy + bob, r); c.fill();
    }
    c.restore();
    drawBomberCore(c, pos.x, pos.y - 0.18 + bob, p.style, { char: p.char, facing: p.facing || 'down', t, alpha: 0.85, scale: 0.82, big: true });
  }

  // ======================================================= PARTICLES
  function addParticle(p) { particles.push(Object.assign({ vx: 0, vy: 0, g: 0, life: 1, age: 0, size: 0.1, rot: 0, vr: 0, drag: 0 }, p)); }
  function dust(x, y, n, spread) {
    for (let i = 0; i < n; i++) addParticle({ type: 'smoke', x: x + (Math.random() - 0.5) * (spread || 0.4), y, vx: (Math.random() - 0.5) * 1.8, vy: -0.3 - Math.random() * 0.3, life: 0.45, size: 0.1 + Math.random() * 0.05, drag: 3 });
  }

  function onEvent(e, game) {
    const th = game.arena ? game.arena.theme : null;
    switch (e.type) {
      case 'explode':
        for (let i = 0; i < 8; i++) {
          const a = Math.random() * TAU;
          addParticle({ type: 'smoke', x: e.x, y: e.y, vx: Math.cos(a) * 0.8, vy: Math.sin(a) * 0.8 - 0.4, life: 0.9 + Math.random() * 0.5, size: 0.25 + Math.random() * 0.2, drag: 2 });
        }
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * TAU, sp = 3 + Math.random() * 4;
          addParticle({ type: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.35 + Math.random() * 0.3, size: 0.05, drag: 3 });
        }
        addParticle({ type: 'ring', x: e.x, y: e.y, life: 0.35, size: 0.4 + Math.min(e.range, 6) * 0.12 });
        if (e.tiles) for (const [x, y] of e.tiles) {
          const k = y * COLS + x, sc = scorches.get(k);
          if (sc) { sc.age = 0; sc.str = Math.min(1.6, sc.str + 0.3); }
          else scorches.set(k, { x, y, age: 0, str: x === e.x - 0.5 && y === e.y - 0.5 ? 1.3 : 1 });
        }
        break;
      case 'softBreak':
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6, sp = 2 + Math.random() * 3;
          addParticle({ type: 'chunk', x: e.x + (Math.random() - 0.5) * 0.5, y: e.y - 0.1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 14, life: 0.6 + Math.random() * 0.3, size: 0.07 + Math.random() * 0.08, color: th ? th.debris[i % 3] : '#c84', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 20 });
        }
        emitters.push({ x: e.x, y: e.y - 0.1, t: 0, life: 1.2, acc: 0 });
        break;
      case 'pickup': {
        const info = ITEM_INFO[e.item];
        for (let i = 0; i < 10; i++) {
          const a = i * TAU / 10;
          addParticle({ type: 'star', x: e.x, y: e.y, vx: Math.cos(a) * 2.5, vy: Math.sin(a) * 2.5, life: 0.5, size: 0.08, drag: 4, color: info.bg[0] });
        }
        addParticle({ type: 'ring', x: e.x, y: e.y - 0.1, life: 0.4, size: 0.7, color: info.bg[0] });
        const p = game.players[e.player];
        if (p && e.item !== 'skull') { const s = ps(p); s.cheerT = 0; s.tint = { color: info.bg[0], t: 0.35 }; }
        if (e.mount) {
          const m = MOUNTS.find(x => x.type === e.mount);
          popups.push({ text: m.label + '!', x: e.x, y: e.y - 0.5, age: 0, life: 1.6, color: m.color });
        } else if (e.item !== 'skull') popups.push({ text: info.label + '!', x: e.x, y: e.y - 0.5, age: 0, life: 1.1, color: info.bg[0] });
        break;
      }
      case 'jump': dust(e.x, e.y + 0.35, 6, 0.5); break;
      case 'land':
        if (e.player !== undefined) { const p = game.players[e.player]; if (p) ps(p).landT = 0; dust(e.x, e.y + 0.38, 7, 0.6); }
        break;
      case 'dash': {
        const d = DIRS[e.dir];
        for (let i = 0; i < 8; i++) addParticle({ type: 'smoke', x: e.x - d.x * 0.3, y: e.y + 0.3, vx: -d.x * (2 + Math.random() * 2) + (Math.random() - 0.5), vy: -d.y * (2 + Math.random() * 2) - 0.3, life: 0.5, size: 0.13, drag: 3 });
        break;
      }
      case 'ghost': {
        const p = game.players[e.player];
        const pos = game.ghostPos(p);
        popups.push({ text: 'Revenge!', x: pos.x, y: pos.y - 0.6, age: 0, life: 1.4, color: p.style.light });
        break;
      }
      case 'skull':
        popups.push({ text: DISEASES[e.disease], x: e.x, y: e.y - 0.6, age: 0, life: 1.5, color: '#c58cff' });
        for (let i = 0; i < 8; i++) addParticle({ type: 'smoke', x: e.x, y: e.y - 0.2, vx: (Math.random() - 0.5) * 1.5, vy: -Math.random() * 1.5, life: 0.7, size: 0.18, drag: 2, color: 'rgba(150,60,200,' });
        break;
      case 'cured':
        popups.push({ text: 'Cured!', x: e.x, y: e.y - 0.6, age: 0, life: 1, color: '#9effa0' });
        break;
      case 'die': onDeath(e, game); break;
      case 'mountLost':
        popups.push({ text: 'Llama ran off!', x: e.x, y: e.y - 0.6, age: 0, life: 1.2, color: e.color });
        addParticle({ type: 'mount', x: e.x, y: e.y, vx: (Math.random() < 0.5 ? -1 : 1) * 4, vy: -5, g: 14, life: 1.2, size: 1, color: e.color });
        break;
      case 'thud':
        for (let i = 0; i < 5; i++) addParticle({ type: 'smoke', x: e.x + (Math.random() - 0.5) * 0.8, y: e.y + 0.35, vx: (Math.random() - 0.5) * 2, vy: -0.3, life: 0.6, size: 0.18, drag: 3 });
        break;
      case 'ghostGone':
        for (let i = 0; i < 10; i++) addParticle({ type: 'smoke', x: e.x, y: e.y, vx: (Math.random() - 0.5) * 2, vy: -0.6 - Math.random(), life: 0.8, size: 0.18, drag: 2 });
        popups.push({ text: 'Bye!', x: e.x, y: e.y - 0.6, age: 0, life: 1.2, color: game.players[e.player].style.light });
        break;
      case 'itemBurn':
        for (let i = 0; i < 6; i++) addParticle({ type: 'smoke', x: e.x, y: e.y, vx: (Math.random() - 0.5) * 1.5, vy: -1 - Math.random(), life: 0.7, size: 0.15, drag: 2 });
        break;
      case 'warp':
        for (let i = 0; i < 12; i++) {
          const a = i * TAU / 12;
          addParticle({ type: 'star', x: e.x + Math.cos(a) * 0.4, y: e.y + Math.sin(a) * 0.4, vx: -Math.cos(a) * 1.5, vy: -Math.sin(a) * 1.5, life: 0.4, size: 0.06, color: '#bff' });
        }
        break;
      case 'bonk':
        popups.push({ text: 'Bonk!', x: e.x, y: e.y - 0.6, age: 0, life: 0.9, color: '#ffe36a' });
        break;
      case 'hurry':
        banner = { text: 'HURRY UP!', sub: 'Sudden death', age: 0, life: 2.6, color: '#ff4a3c' };
        break;
      case 'roundStart':
        particles = []; popups = []; banner = null; emitters = []; footprints = []; scorches = new Map();
        pstate = {};
        break;
    }
  }

  // Character-specific death effects
  function onDeath(e, game) {
    const p = game.players[e.player], st = p.style;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * TAU, sp = 1.5 + Math.random() * 3;
      addParticle({ type: 'star', x: e.x, y: e.y - 0.1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.8, size: 0.08, drag: 2.5, color: i % 2 ? st.main : st.light });
    }
    const part = (kind, o) => addParticle(Object.assign({ type: 'part', kind, x: e.x, y: e.y - 0.2, g: 12, life: 1.5, vr: (Math.random() - 0.5) * 14, style: st, char: p.char }, o));
    switch (p.char) {
      case 'robo':
        part('head', { y: e.y - 0.3, vx: (Math.random() - 0.5) * 2, vy: -6 });
        part('body', { y: e.y + 0.1, vx: (Math.random() - 0.5) * 3, vy: -3 });
        part('glove', { vx: -3, vy: -4 }); part('glove', { vx: 3, vy: -4.5 });
        for (let i = 0; i < 6; i++) part('bolt', { vx: (Math.random() - 0.5) * 6, vy: -3 - Math.random() * 4 });
        popups.push({ text: 'Malfunction!', x: e.x, y: e.y - 0.8, age: 0, life: 1.3, color: st.light });
        break;
      case 'kitty':
        addParticle({ type: 'part', kind: 'ghostcat', x: e.x, y: e.y - 0.3, vy: -0.7, life: 2, style: st });
        popups.push({ text: '8 lives left!', x: e.x, y: e.y - 0.8, age: 0, life: 1.5, color: st.light });
        break;
      case 'viking':
        part('helmet', { y: e.y - 0.4, vx: (Math.random() < 0.5 ? -1 : 1) * 2.5, vy: -6 });
        popups.push({ text: 'To Valhalla!', x: e.x, y: e.y - 0.8, age: 0, life: 1.4, color: st.light });
        break;
      case 'ninja':
        for (let i = 0; i < 12; i++) { const a = Math.random() * TAU; addParticle({ type: 'smoke', x: e.x, y: e.y, vx: Math.cos(a) * 1.6, vy: Math.sin(a) * 1.2 - 0.3, life: 0.8, size: 0.2, drag: 3 }); }
        addParticle({ type: 'part', kind: 'log', x: e.x, y: e.y, life: 1.5, vr: 0 });
        popups.push({ text: '...a log?!', x: e.x, y: e.y - 0.8, age: 0, life: 1.4, color: st.light });
        break;
      case 'punk':
        part('shades', { y: e.y - 0.3, vx: (Math.random() < 0.5 ? -1 : 1) * 3, vy: -5 });
        popups.push({ text: 'Rock on...', x: e.x, y: e.y - 0.8, age: 0, life: 1.4, color: st.light });
        break;
      case 'alien':
        popups.push({ text: 'Beam me up!', x: e.x, y: e.y - 0.8, age: 0, life: 1.4, color: st.light });
        break;
    }
  }

  function drawPart(c, p, k) {
    c.save();
    c.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
    c.translate(p.x, p.y); c.rotate(p.rot);
    c.lineWidth = 0.03; c.strokeStyle = OUTLINE;
    const st = p.style;
    switch (p.kind) {
      case 'head': c.fillStyle = headGrad(c, 0, 0.27, st.light, st.main, st.dark); circle(c, 0, 0, 0.27); c.fill(); c.stroke(); c.fillStyle = '#141830'; rr(c, -0.2, -0.06, 0.4, 0.15, 0.07); c.fill(); c.fillStyle = '#ff6a5a'; c.fillRect(-0.12, 0.0, 0.08, 0.02); c.fillRect(0.04, 0.0, 0.08, 0.02); break;
      case 'body': c.fillStyle = st.main; ell(c, 0, 0, 0.2, 0.17); c.fill(); c.stroke(); break;
      case 'glove': c.fillStyle = '#f0f0f8'; circle(c, 0, 0, 0.072); c.fill(); c.stroke(); break;
      case 'bolt':
        c.fillStyle = '#b8bec8'; c.beginPath();
        for (let i = 0; i < 6; i++) { const a = i * TAU / 6; c.lineTo(Math.cos(a) * 0.05, Math.sin(a) * 0.05); }
        c.closePath(); c.fill(); c.stroke(); c.fillStyle = '#555'; circle(c, 0, 0, 0.018); c.fill();
        break;
      case 'helmet': {
        c.fillStyle = '#fff4dc';
        for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * 0.2, -0.0); c.quadraticCurveTo(s * 0.42, -0.04, s * 0.4, -0.3); c.quadraticCurveTo(s * 0.3, -0.12, s * 0.14, -0.1); c.closePath(); c.fill(); c.stroke(); }
        c.fillStyle = st.main; c.beginPath(); c.arc(0, 0.12, 0.28, Math.PI, 0); c.closePath(); c.fill(); c.stroke();
        c.fillStyle = '#c9ced8'; rr(c, -0.3, 0.06, 0.6, 0.07, 0.03); c.fill(); c.stroke();
        break;
      }
      case 'shades':
        c.fillStyle = '#121218'; rr(c, -0.2, -0.04, 0.17, 0.09, 0.04); c.fill(); rr(c, 0.03, -0.04, 0.17, 0.09, 0.04); c.fill(); c.fillRect(-0.04, -0.02, 0.08, 0.025);
        break;
      case 'ghostcat': {
        c.rotate(-p.rot);
        c.globalAlpha *= 0.75;
        c.translate(Math.sin(p.age * 4) * 0.1, 0);
        c.fillStyle = '#ffffff'; c.strokeStyle = 'rgba(80,80,140,0.6)';
        c.beginPath(); c.moveTo(-0.15, -0.1); c.lineTo(-0.12, -0.32); c.lineTo(-0.02, -0.18); c.lineTo(0.02, -0.18); c.lineTo(0.12, -0.32); c.lineTo(0.15, -0.1);
        c.quadraticCurveTo(0.2, 0.15, 0.1, 0.25); c.lineTo(0.05, 0.18); c.lineTo(0, 0.26); c.lineTo(-0.05, 0.18); c.lineTo(-0.1, 0.25); c.quadraticCurveTo(-0.2, 0.15, -0.15, -0.1);
        c.fill(); c.stroke();
        c.fillStyle = OUTLINE; ell(c, -0.06, -0.05, 0.02, 0.03); c.fill(); ell(c, 0.06, -0.05, 0.02, 0.03); c.fill();
        c.strokeStyle = '#ffd34a'; c.lineWidth = 0.025; ell(c, 0, -0.38, 0.12, 0.035); c.stroke();
        break;
      }
      case 'log': {
        c.rotate(-p.rot);
        const g = c.createLinearGradient(0, -0.12, 0, 0.12);
        g.addColorStop(0, '#b07a44'); g.addColorStop(1, '#6a4420');
        c.fillStyle = g; rr(c, -0.3, -0.1, 0.55, 0.22, 0.08); c.fill(); c.stroke();
        c.fillStyle = '#e0b880'; ell(c, 0.25, 0.01, 0.06, 0.11); c.fill(); c.stroke();
        c.strokeStyle = '#a07040'; c.lineWidth = 0.015; ell(c, 0.25, 0.01, 0.03, 0.06); c.stroke();
        break;
      }
    }
    c.restore();
  }

  function drawParticles(c) {
    for (const p of particles) {
      const k = p.age / p.life;
      if (p.type === 'part') { drawPart(c, p, k); continue; }
      c.save();
      switch (p.type) {
        case 'smoke': {
          c.globalAlpha = (1 - k) * (p.dark ? 0.6 : 0.55);
          const r = p.size * (1 + k * (p.dark ? 1.8 : 1));
          if (p.color) c.fillStyle = p.color + (0.6 * (1 - k)).toFixed(2) + ')';
          else {
            const g = c.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, r * 0.1, p.x, p.y, r);
            if (p.dark) { g.addColorStop(0, '#6a6260'); g.addColorStop(1, 'rgba(40,36,36,0.1)'); }
            else { g.addColorStop(0, '#f4eee8'); g.addColorStop(1, 'rgba(150,140,140,0.2)'); }
            c.fillStyle = g;
          }
          circle(c, p.x, p.y, r); c.fill();
          break;
        }
        case 'spark':
          c.strokeStyle = k < 0.5 ? '#fff6c0' : '#ffb030'; c.lineWidth = p.size; c.lineCap = 'round';
          c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); c.stroke();
          break;
        case 'speed':
          c.globalAlpha = (1 - k) * 0.7;
          c.strokeStyle = '#ffffff'; c.lineWidth = 0.03; c.lineCap = 'round';
          c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + p.dx * 0.4, p.y + p.dy * 0.4); c.stroke();
          break;
        case 'ring':
          c.globalAlpha = (1 - k) * 0.7;
          c.strokeStyle = p.color || '#fff3c0'; c.lineWidth = 0.08 * (1 - k);
          circle(c, p.x, p.y, p.size * (0.3 + k * 1.2)); c.stroke();
          break;
        case 'chunk':
          c.globalAlpha = 1 - k * k;
          c.translate(p.x, p.y); c.rotate(p.rot);
          c.fillStyle = p.color; c.fillRect(-p.size, -p.size * 0.7, p.size * 2, p.size * 1.4);
          c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(-p.size, p.size * 0.2, p.size * 2, p.size * 0.5);
          break;
        case 'leaf':
          c.globalAlpha = 1 - k;
          c.translate(p.x, p.y); c.rotate(p.rot);
          c.strokeStyle = p.color; c.lineWidth = 0.025; c.lineCap = 'round';
          c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -0.08); c.stroke();
          break;
        case 'star':
          c.globalAlpha = 1 - k;
          c.fillStyle = p.color || '#fff';
          star(c, p.x, p.y, p.size * (1 - k * 0.5)); c.fill();
          break;
        case 'mount':
          c.globalAlpha = 1 - k;
          c.translate(p.x, p.y); c.rotate(p.age * 6);
          drawMount(c, p.color, 'down', 0, false);
          break;
      }
      c.restore();
    }
  }

  // ======================================================= PER-FRAME VISUAL STATE
  function update(dt, game) {
    clock += dt;
    if (game !== stateGame) { stateGame = game; pstate = {}; scorches = new Map(); emitters = []; footprints = []; particles = []; popups = []; banner = null; }
    if (game && game.arena) updateGameFx(dt, game);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) { particles.splice(i, 1); continue; }
      p.vy += p.g * dt;
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vy *= dr;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    }
    for (let i = popups.length - 1; i >= 0; i--) { popups[i].age += dt; if (popups[i].age > popups[i].life) popups.splice(i, 1); }
    if (banner) { banner.age += dt; if (banner.age > banner.life) banner = null; }
    updateBackground(dt, game);
    // confetti for the podium
    if (podiumOn) {
      for (let i = 0; i < 3; i++) if (Math.random() < 0.6) confetti.push({ x: Math.random() * W, y: -10, vx: (Math.random() - 0.5) * 60, vy: 60 + Math.random() * 80, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10, w: 6 + Math.random() * 6, h: 3 + Math.random() * 4, color: ['#ff4a3c', '#ffd23a', '#3c8cf0', '#56c838', '#ff7fb4', '#ffffff'][(Math.random() * 6) | 0] });
    }
    for (let i = confetti.length - 1; i >= 0; i--) {
      const q = confetti[i];
      q.x += (q.vx + Math.sin(clock * 3 + i) * 30) * dt; q.y += q.vy * dt; q.rot += q.vr * dt;
      if (q.y > H + 20) confetti.splice(i, 1);
    }
    if (!podiumOn && confetti.length > 400) confetti.length = 0;
  }

  function updateGameFx(dt, game) {
    const th = game.arena.theme;
    for (const p of game.players) {
      const s = ps(p);
      s.landT += dt; s.cheerT += dt;
      if (s.tint) { s.tint.t -= dt; if (s.tint.t <= 0) s.tint = null; }
      if (!p.alive) continue;
      if (p.moving) s.idleT = 0; else s.idleT += dt;
      if (p.facing !== s.lastFacing) {
        if (p.moving && !p.jump) dust(p.x, p.y + 0.38, 3, 0.3);
        s.lastFacing = p.facing;
      }
      // footsteps
      if (p.moving && !p.jump && game.phase === 'play') {
        s.stepT += dt;
        if (s.stepT > 0.2) {
          s.stepT = 0;
          if (th.style === 'glacier') footprints.push({ x: p.x, y: p.y + 0.36, age: 0, facing: p.facing, side: (footprints.length % 2) ? 1 : -1 });
          else if (th.style === 'garden') for (let i = 0; i < 2; i++) addParticle({ type: 'leaf', x: p.x + (Math.random() - 0.5) * 0.3, y: p.y + 0.38, vx: (Math.random() - 0.5) * 1.5, vy: -1.5 - Math.random(), g: 8, life: 0.45, rot: (Math.random() - 0.5) * 1.2, vr: (Math.random() - 0.5) * 8, color: Math.random() < 0.5 ? '#3f9a2c' : '#8ad86c' });
          else if (th.style === 'factory' && Math.random() < 0.35) dust(p.x, p.y + 0.38, 1, 0.2);
        }
      }
      // Dash Hopper trail
      if (p.dash) {
        s.dustT += dt;
        if (s.dustT > 0.03) {
          s.dustT = 0;
          const d = DIRS[p.dash.dir];
          addParticle({ type: 'smoke', x: p.x - d.x * 0.3, y: p.y + 0.3, vx: -d.x * 1.5 + (Math.random() - 0.5), vy: -0.5, life: 0.45, size: 0.14, drag: 3 });
          addParticle({ type: 'speed', x: p.x - d.x * 0.4 + (Math.random() - 0.5) * (d.y ? 0.5 : 0.1), y: p.y - 0.2 + (Math.random() - 0.5) * (d.x ? 0.6 : 0.1), dx: -d.x, dy: -d.y, life: 0.25 });
        }
      }
      // panic: an armed bomb about to blow in line with us
      s.panic = false;
      if (game.phase === 'play') {
        const px = Math.floor(p.x), py = Math.floor(p.y);
        for (const b of game.bombs) {
          if (b.state === 'fly' || (b.remote && !b.triggered) || b.fuse > 0.9) continue;
          const dx = Math.abs(b.tx - px), dy = Math.abs(b.ty - py);
          if ((dx === 0 && dy <= b.range) || (dy === 0 && dx <= b.range)) { if (dx + dy <= 3) { s.panic = true; break; } }
        }
      }
    }
    for (const [k, sc] of scorches) { sc.age += dt; if (sc.age > 20 || game.grid[sc.y][sc.x] === HARD) scorches.delete(k); }
    for (let i = footprints.length - 1; i >= 0; i--) { footprints[i].age += dt; if (footprints[i].age > 8) footprints.splice(i, 1); }
    if (footprints.length > 300) footprints.splice(0, footprints.length - 300);
    for (let i = emitters.length - 1; i >= 0; i--) {
      const em = emitters[i];
      em.t += dt; em.acc += dt;
      while (em.acc > 0.07) {
        em.acc -= 0.07;
        addParticle({ type: 'smoke', dark: true, x: em.x + (Math.random() - 0.5) * 0.3, y: em.y, vx: (Math.random() - 0.5) * 0.3, vy: -1.1 - Math.random() * 0.4, life: 1.1, size: 0.12, drag: 0.6 });
      }
      if (em.t > em.life) emitters.splice(i, 1);
    }
    // duel zoom
    let tz = 1, tx = COLS / 2, ty = ROWS / 2;
    if (options.duelZoom && game.phase === 'play' && (game.sudden || game.timeLeft < 30)) {
      const alive = game.players.filter(p => p.alive);
      if (alive.length === 2) {
        tz = 1.15;
        tx = (alive[0].x + alive[1].x) / 2; ty = (alive[0].y + alive[1].y) / 2;
      }
    }
    const k = 1 - Math.exp(-dt * 2.5);
    zoom += (tz - zoom) * k; zx += (tx - zx) * k; zy += (ty - zy) * k;
  }

  // ======================================================= LIVING BACKGROUNDS (pixel space)
  function prepBackground(style) {
    const key = style + ':' + W + 'x' + H;
    if (bg.key === key) return;
    bg.key = key;
    bg.stars = []; bg.tufts = []; bg.flakes = []; bg.steam = [];
    for (let i = 0; i < 180; i++) bg.stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.4 + 0.3, ph: Math.random() * 6 });
    for (let i = 0; i < 160; i++) bg.tufts.push({ x: Math.random() * W, y: Math.random() * H, k: Math.random() });
    for (let i = 0; i < 140; i++) bg.flakes.push({ x: Math.random() * W, y: Math.random() * H, r: 1 + Math.random() * 2.5, vy: 20 + Math.random() * 40, ph: Math.random() * 6 });
  }
  function updateBackground(dt, game) {
    if (!game || !game.arena) return;
    const style = game.arena.theme.style;
    prepBackground(style);
    if (style === 'glacier') for (const f of bg.flakes) { f.y += f.vy * dt; f.x += Math.sin(clock + f.ph) * 12 * dt; if (f.y > H + 5) { f.y = -5; f.x = Math.random() * W; } }
    if (style === 'factory') {
      const m = ox;
      if (m > ts * 0.8) {
        for (const vx of [m * 0.3, W - m * 0.3]) if (Math.random() < dt * 6) bg.steam.push({ x: vx + (Math.random() - 0.5) * 6, y: oy + ROWS * ts * 0.35, r: 6, age: 0, life: 2 + Math.random(), vx: (Math.random() - 0.5) * 10 });
      }
      for (let i = bg.steam.length - 1; i >= 0; i--) { const s = bg.steam[i]; s.age += dt; s.y -= 30 * dt; s.x += s.vx * dt; s.r += 12 * dt; if (s.age > s.life) bg.steam.splice(i, 1); }
    }
    if (style === 'space') {
      bg.shootT -= dt;
      if (bg.shootT <= 0) { bg.shootT = 3 + Math.random() * 5; bg.shoot = { x: Math.random() * W, y: Math.random() * H * 0.4, vx: 500 + Math.random() * 300, vy: 200 + Math.random() * 100, age: 0 }; }
      if (bg.shoot) { bg.shoot.age += dt; bg.shoot.x += bg.shoot.vx * dt; bg.shoot.y += bg.shoot.vy * dt; if (bg.shoot.age > 1.2) bg.shoot = null; }
    }
  }

  function drawTree(c, x, y, R, t, i) {
    c.save(); c.translate(x, y);
    c.fillStyle = 'rgba(0,0,0,0.25)'; ell(c, R * 0.15, 0, R * 0.8, R * 0.25); c.fill();
    c.rotate(Math.sin(t * 1.2 + i) * 0.035);
    const tg = c.createLinearGradient(-R * 0.12, 0, R * 0.12, 0);
    tg.addColorStop(0, '#8a5a30'); tg.addColorStop(1, '#4a2a10');
    c.fillStyle = tg; c.fillRect(-R * 0.12, -R * 0.9, R * 0.24, R * 0.9);
    for (const [dx, dy, r] of [[-0.45, -1.1, 0.55], [0.45, -1.1, 0.55], [0, -1.55, 0.65], [0, -1.0, 0.6]]) {
      const g = c.createRadialGradient(dx * R - r * R * 0.3, dy * R - r * R * 0.35, r * R * 0.1, dx * R, dy * R, r * R);
      g.addColorStop(0, '#8fe06a'); g.addColorStop(0.6, '#3f9a2c'); g.addColorStop(1, '#22601a');
      c.fillStyle = g; circle(c, dx * R, dy * R, r * R); c.fill();
    }
    c.restore();
  }

  function drawBackground(game, t) {
    const style = game.arena.theme.style;
    prepBackground(style);
    const c = ctx;
    const aL = ox, aR = ox + COLS * ts, aT = oy - HUD_H * ts, aB = oy + ROWS * ts;
    const mL = aL, mR = W - aR;
    switch (style) {
      case 'garden': {
        let g = c.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#4e8f3a'); g.addColorStop(1, '#2a5420');
        c.fillStyle = g; c.fillRect(0, 0, W, H);
        c.lineWidth = 2; c.lineCap = 'round';
        for (const tf of bg.tufts) {
          if (tf.x > aL - 10 && tf.x < aR + 10 && tf.y > aT && tf.y < aB + 10) continue;
          c.strokeStyle = tf.k > 0.5 ? 'rgba(140,220,100,0.5)' : 'rgba(20,70,15,0.5)';
          c.beginPath(); c.moveTo(tf.x, tf.y); c.lineTo(tf.x - 3, tf.y - 7); c.moveTo(tf.x + 3, tf.y); c.lineTo(tf.x + 5, tf.y - 6); c.stroke();
          if (tf.k > 0.92) { c.fillStyle = tf.k > 0.96 ? '#fff7b0' : '#ffb8d6'; circle(c, tf.x, tf.y - 9, 3); c.fill(); }
        }
        const R = Math.min(ts * 1.05, Math.max(mL, mR) * 0.38);
        if (mL > ts * 1.1 || mR > ts * 1.1) {
          let i = 0;
          for (let y = aT + ts * 1.8; y < H + ts; y += ts * 2.6, i++) {
            if (mL > ts * 1.1) drawTree(c, mL * 0.5 + (hash(i, 1) - 0.5) * mL * 0.25, y, Math.min(R, mL * 0.38), t, i);
            if (mR > ts * 1.1) drawTree(c, aR + mR * 0.5 + (hash(i, 2) - 0.5) * mR * 0.25, y + ts * 1.2, Math.min(R, mR * 0.38), t, i + 7);
          }
        }
        break;
      }
      case 'factory': {
        let g = c.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#2a2f38'); g.addColorStop(1, '#14171c');
        c.fillStyle = g; c.fillRect(0, 0, W, H);
        c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 2;
        for (let y = 0; y < H; y += ts * 0.8) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
        for (const [px, pw] of [[mL * 0.3, ts * 0.3], [mL * 0.7, ts * 0.2], [W - mR * 0.3, ts * 0.3], [W - mR * 0.7, ts * 0.2]]) {
          if (px < 0 || px > W || (px > aL && px < aR)) continue;
          const pg = c.createLinearGradient(px - pw / 2, 0, px + pw / 2, 0);
          pg.addColorStop(0, '#3a414c'); pg.addColorStop(0.4, '#9aa4b2'); pg.addColorStop(1, '#2a2f38');
          c.fillStyle = pg; c.fillRect(px - pw / 2, 0, pw, H);
          for (let y = ts * 0.6; y < H; y += ts * 1.6) {
            c.fillStyle = '#5d6673'; c.fillRect(px - pw * 0.7, y, pw * 1.4, ts * 0.12);
            const on = Math.sin(t * 3 + y * 0.05 + px) > 0.6;
            c.fillStyle = on ? '#ff4a3c' : '#3a1010'; circle(c, px + pw * 0.9, y + ts * 0.3, 3); c.fill();
            if (on) { c.fillStyle = 'rgba(255,74,60,0.25)'; circle(c, px + pw * 0.9, y + ts * 0.3, 8); c.fill(); }
          }
        }
        for (const s of bg.steam) {
          const a = Math.max(0, 1 - s.age / s.life) * 0.35;
          c.fillStyle = `rgba(220,225,235,${a})`; circle(c, s.x, s.y, s.r); c.fill();
        }
        break;
      }
      case 'space': {
        let g = c.createRadialGradient(W * 0.3, H * 0.3, 10, W / 2, H / 2, Math.max(W, H));
        g.addColorStop(0, '#1a1650'); g.addColorStop(1, '#03030c');
        c.fillStyle = g; c.fillRect(0, 0, W, H);
        for (const s of bg.stars) {
          c.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.5 + s.ph));
          c.fillStyle = '#fff'; circle(c, s.x, s.y, s.r); c.fill();
        }
        c.globalAlpha = 1;
        if (mL > ts * 1.3) {
          const pr = Math.min(mL * 0.32, ts * 1.6), px = mL * 0.5, py = H * 0.72;
          const pgr = c.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.1, px, py, pr);
          pgr.addColorStop(0, '#ffcf8a'); pgr.addColorStop(0.5, '#e0703a'); pgr.addColorStop(1, '#5a1a30');
          c.fillStyle = pgr; circle(c, px, py, pr); c.fill();
          c.strokeStyle = 'rgba(255,220,180,0.6)'; c.lineWidth = Math.max(2, pr * 0.08);
          ell(c, px, py, pr * 1.7, pr * 0.35, -0.3); c.stroke();
        }
        if (mR > ts * 1.3) {
          const mr = Math.min(mR * 0.2, ts * 0.8), mx = W - mR * 0.5, my = H * 0.25;
          const mg = c.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, 1, mx, my, mr);
          mg.addColorStop(0, '#e8f0ff'); mg.addColorStop(1, '#5a6a9a');
          c.fillStyle = mg; circle(c, mx, my, mr); c.fill();
          c.fillStyle = 'rgba(60,70,110,0.5)'; circle(c, mx + mr * 0.3, my + mr * 0.2, mr * 0.2); c.fill(); circle(c, mx - mr * 0.35, my - mr * 0.1, mr * 0.12); c.fill();
        }
        if (bg.shoot) {
          const s = bg.shoot, a = Math.max(0, 1 - s.age / 1.2);
          const sg = c.createLinearGradient(s.x, s.y, s.x - s.vx * 0.15, s.y - s.vy * 0.15);
          sg.addColorStop(0, `rgba(255,255,255,${a})`); sg.addColorStop(1, 'rgba(255,255,255,0)');
          c.strokeStyle = sg; c.lineWidth = 2; c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x - s.vx * 0.15, s.y - s.vy * 0.15); c.stroke();
        }
        break;
      }
      case 'glacier': {
        let g = c.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#3a6f9e'); g.addColorStop(1, '#16304a');
        c.fillStyle = g; c.fillRect(0, 0, W, H);
        const base = H;
        for (const [layer, col, hgt] of [[0, '#5a8ab8', 0.55], [1, '#3f6c96', 0.38]]) {
          c.fillStyle = col; c.beginPath(); c.moveTo(0, base);
          for (let x = 0; x <= W + 80; x += 80) { const h = H * hgt * (0.6 + 0.4 * hash(x, layer, 9)); c.lineTo(x, base - h); c.lineTo(x + 40, base - h * 0.75); }
          c.lineTo(W, base); c.closePath(); c.fill();
          c.fillStyle = 'rgba(255,255,255,0.7)';
          for (let x = 0; x <= W + 80; x += 80) { const h = H * hgt * (0.6 + 0.4 * hash(x, layer, 9)); c.beginPath(); c.moveTo(x - 14, base - h + 18); c.lineTo(x, base - h); c.lineTo(x + 12, base - h + 15); c.closePath(); c.fill(); }
        }
        break;
      }
    }
  }

  function drawForegroundFx(game, t) {
    const style = game.arena.theme.style;
    const c = ctx;
    if (style === 'glacier') {
      c.fillStyle = 'rgba(255,255,255,0.75)';
      for (const f of bg.flakes) { circle(c, f.x, f.y, f.r); c.fill(); }
    } else if (style === 'garden') {
      for (let i = 0; i < 4; i++) {
        const x = W / 2 + Math.sin(t * 0.13 * (i + 1) + i * 2) * W * 0.45;
        const y = H / 2 + Math.cos(t * 0.17 * (i + 1) + i) * H * 0.4;
        const flap = Math.abs(Math.sin(t * 18 + i * 2));
        const col = ['#ffd23a', '#ff8fb1', '#7fd1ff', '#ffffff'][i];
        c.save(); c.translate(x, y); c.rotate(Math.sin(t * 2 + i) * 0.4);
        c.fillStyle = col; c.strokeStyle = 'rgba(40,30,20,0.6)'; c.lineWidth = 1;
        const s = ts * 0.12;
        ell(c, -s * 0.6 * flap, -s * 0.2, s * 0.7 * flap + 0.5, s * 0.55, 0); c.fill(); c.stroke();
        ell(c, s * 0.6 * flap, -s * 0.2, s * 0.7 * flap + 0.5, s * 0.55, 0); c.fill(); c.stroke();
        c.fillStyle = '#3a2a1a'; ell(c, 0, 0, s * 0.12, s * 0.5); c.fill();
        c.restore();
      }
    }
  }

  // ======================================================= MAIN DRAW
  function worldTransform() {
    const s = ts * zoom;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (ox + ts * zx * (1 - zoom)), dpr * (oy + ts * zy * (1 - zoom)));
  }
  function pixelTransform() { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }

  function draw(game, ui) {
    const t = clock;
    podiumOn = !!(ui && ui.podium);
    pixelTransform();
    if (!game || !game.arena) {
      ctx.fillStyle = '#0d0818'; ctx.fillRect(0, 0, W, H);
      return;
    }
    drawBackground(game, t);

    const th = game.arena.theme;
    const zoomed = zoom > 1.002;
    if (zoomed) { ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, COLS * ts, (ROWS + LIFT_HARD) * ts); ctx.clip(); }
    worldTransform();
    const c = ctx;
    c.save(); c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = ts * dpr * 0.5; c.shadowOffsetY = ts * dpr * 0.15;
    c.fillStyle = '#000'; rr(c, 0, 0, COLS, ROWS, 0.2); c.fill(); c.restore();
    c.drawImage(getFloor(game), 0, 0, COLS, ROWS);

    // scorch marks
    for (const sc of scorches.values()) {
      const a = Math.max(0, 1 - sc.age / 20) * 0.42 * sc.str;
      if (a <= 0.01) continue;
      for (let k = 0; k < 2; k++) {
        const cx = sc.x + 0.5 + (hash(sc.x, sc.y, k) - 0.5) * 0.25, cy = sc.y + 0.5 + (hash(sc.x, sc.y, k + 5) - 0.5) * 0.25;
        const g = c.createRadialGradient(cx, cy, 0.02, cx, cy, 0.5 - k * 0.12);
        g.addColorStop(0, `rgba(25,12,5,${a})`); g.addColorStop(0.6, `rgba(25,12,5,${a * 0.5})`); g.addColorStop(1, 'rgba(25,12,5,0)');
        c.fillStyle = g; c.fillRect(sc.x - 0.1, sc.y - 0.1, 1.2, 1.2);
      }
    }
    // footprints in the snow
    for (const f of footprints) {
      const a = Math.max(0, 1 - f.age / 8) * 0.35;
      const horiz = f.facing === 'left' || f.facing === 'right';
      c.fillStyle = `rgba(70,110,150,${a})`;
      ell(c, f.x + (horiz ? 0 : f.side * 0.08), f.y + (horiz ? f.side * 0.05 : 0), horiz ? 0.07 : 0.045, horiz ? 0.04 : 0.065); c.fill();
    }

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const sp = game.special[y][x];
        if (!sp) continue;
        if (sp.type === 'conveyor') drawConveyor(c, x, y, sp.dir, t);
        else if (sp.type === 'warp') drawWarp(c, x, y, sp, t);
      }
    }

    const sh = shadowSprite();
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const cell = game.grid[y][x];
        if (cell === EMPTY) continue;
        if (cell === SOFT && game.burnMap[y][x]) continue;
        c.drawImage(sh, x - 0.12, y - 0.06, 1.7, 1.7);
      }
    }
    // light: explosions, lit fuses, neon underglow
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) { const f = game.flames[y][x]; if (f) drawFlameGlow(c, x, y, f); }
    for (const b of game.bombs) {
      if (b.state === 'fly' || (b.remote && !b.triggered)) continue;
      const lx = b.x + 0.15, ly = b.y - 0.3, fl = 0.13 + 0.06 * Math.sin(t * 37 + b.id * 3) + 0.03 * Math.sin(t * 61 + b.id);
      const g = c.createRadialGradient(lx, ly, 0.02, lx, ly, 0.85);
      g.addColorStop(0, `rgba(255,170,60,${fl})`); g.addColorStop(1, 'rgba(255,120,0,0)');
      c.fillStyle = g; c.fillRect(lx - 0.85, ly - 0.85, 1.7, 1.7);
    }
    if (th.style === 'space') {
      for (const p of game.players) {
        if (!p.alive) continue;
        const g = c.createRadialGradient(p.x, p.y + 0.38, 0.02, p.x, p.y + 0.38, 0.55);
        g.addColorStop(0, rgba(p.style.main, 0.35 + 0.1 * Math.sin(t * 6 + p.id))); g.addColorStop(1, rgba(p.style.main, 0));
        c.fillStyle = g; c.fillRect(p.x - 0.6, p.y - 0.2, 1.2, 1.2);
      }
    }
    c.restore();

    // entity shadows
    c.fillStyle = 'rgba(0,0,0,0.28)';
    for (const p of game.players) {
      if (!p.alive && p.deadT > 0.6) continue;
      if (game.phase === 'countdown' && RULES.countdown - game.phaseT - p.id * 0.3 < 0) continue;
      const k = 1 - (p.h || 0) * 0.45;
      ell(c, p.x, p.y + 0.42, (p.mount ? 0.42 : 0.3) * k, 0.11 * k); c.fill();
    }
    for (const b of game.bombs) {
      const s = b.state === 'fly' ? Math.max(0.3, 1 - b.h * 0.4) : 1;
      ell(c, b.x + 0.03, b.y + 0.3, 0.27 * s, 0.09 * s); c.fill();
    }
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (game.pickups[y][x] && game.pickups[y][x].age >= 0) { ell(c, x + 0.53, y + 0.88, 0.32, 0.07); c.fill(); }
    for (const f of game.falling) {
      const k = f.t / f.dur;
      c.fillStyle = `rgba(0,0,0,${0.15 + 0.3 * k})`;
      ell(c, f.x + 0.5, f.y + 0.6, 0.2 + 0.3 * k, 0.1 + 0.15 * k); c.fill();
    }

    const hardS = hardSprite(th, false), wallS = hardSprite(th, true), softS = softSprite(th);
    const byRow = [];
    for (let y = 0; y < ROWS; y++) byRow.push({ bombs: [], players: [] });
    for (const b of game.bombs) if (b.state !== 'fly') byRow[Math.max(0, Math.min(ROWS - 1, Math.floor(b.y)))].bombs.push(b);
    for (const p of game.players) if (!(p.alive && p.jump)) byRow[Math.max(0, Math.min(ROWS - 1, Math.floor(p.y)))].players.push(p);

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const cell = game.grid[y][x];
        if (cell === HARD) {
          const wall = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
          c.drawImage(wall ? wallS : hardS, x, y, 1, 1 + LIFT_HARD);
        } else if (cell === SOFT) {
          if (game.burnMap[y][x]) {
            const k = game.burnProgress(x, y);
            c.save();
            c.globalAlpha = 1 - k;
            c.translate(x + 0.5 + (Math.random() - 0.5) * 0.05, y + 1 + LIFT_SOFT); c.scale(1 - k * 0.3, 1 - k * 0.5);
            c.drawImage(softS, -0.5, -1 - LIFT_SOFT, 1, 1 + LIFT_SOFT);
            c.restore();
            drawFlame(c, x, y, { t: RULES.flameTime * (1 - k) * 0.9 + 0.05, arms: {}, center: false }, t);
          } else {
            c.drawImage(softS, x, y, 1, 1 + LIFT_SOFT);
          }
        }
        const pk = game.pickups[y][x];
        if (pk) drawItem(c, x, y, pk, t);
      }
      for (const b of byRow[y].bombs) drawBomb(c, b.x, b.y, b, t, game.time);
      for (let x = 0; x < COLS; x++) { const f = game.flames[y][x]; if (f) drawFlame(c, x, y, f, t); }
      const prow = byRow[y].players.slice().sort((a, b) => a.y - b.y);
      for (const p of prow) drawPlayer(c, p, t, game);
    }

    for (const p of game.players) if (p.alive && p.jump) drawPlayer(c, p, t, game);
    for (const b of game.bombs) if (b.state === 'fly') drawBomb(c, b.x, b.y - b.h, b, t, game.time);
    for (const f of game.falling) {
      const k = Math.min(1, f.t / f.dur);
      c.drawImage(hardS, f.x, f.y - (1 - k * k) * 8, 1, 1 + LIFT_HARD);
    }
    drawParticles(c);
    for (const p of game.players) if (game.ghostActive(p)) drawGhost(c, game, p, t);

    // lighting: key light + vignette + rising tension
    let lg = c.createLinearGradient(0, 0, COLS, ROWS);
    lg.addColorStop(0, 'rgba(255,250,220,0.08)'); lg.addColorStop(0.5, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,30,0.14)');
    c.fillStyle = lg; c.fillRect(0, -0.5, COLS, ROWS + 0.5);
    lg = c.createRadialGradient(COLS / 2, ROWS / 2, ROWS * 0.35, COLS / 2, ROWS / 2, COLS * 0.75);
    lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,0.3)');
    c.fillStyle = lg; c.fillRect(0, -0.5, COLS, ROWS + 0.5);
    if (game.phase === 'play' && (game.sudden || game.timeLeft < 45)) {
      const a = game.sudden ? 0.32 + 0.08 * Math.sin(t * 3) : (45 - game.timeLeft) / 45 * 0.22;
      lg = c.createRadialGradient(COLS / 2, ROWS / 2, ROWS * 0.2, COLS / 2, ROWS / 2, COLS * 0.75);
      lg.addColorStop(0, `rgba(150,10,30,${a * 0.25})`); lg.addColorStop(1, `rgba(150,10,30,${a})`);
      c.fillStyle = lg; c.fillRect(0, -0.5, COLS, ROWS + 0.5);
    }
    if (zoomed) ctx.restore();

    pixelTransform();
    drawForegroundFx(game, t);
    for (const p of popups) {
      const k = p.age / p.life;
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      text(p.text, sx(p.x), sy(p.y - k * 0.6), Math.max(12, ts * 0.36), p.color, 'center');
      ctx.globalAlpha = 1;
    }
    drawHUD(game, t);
    drawOverlayText(game, t);
    if (podiumOn) drawPodium(game, t);
    if (confetti.length) {
      pixelTransform();
      for (const q of confetti) {
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot); ctx.scale(1, Math.cos(q.rot * 2));
        ctx.fillStyle = q.color; ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h); ctx.restore();
      }
    }
  }

  function text(str, x, y, size, color, align, stroke) {
    ctx.font = `${Math.round(size)}px ${FONT}`;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = stroke !== undefined ? stroke : Math.max(3, size * 0.16);
    ctx.strokeStyle = '#140c22';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color || '#fff';
    ctx.fillText(str, x, y);
  }

  // ======================================================= PODIUM (match winner)
  function drawPodium(game, t) {
    pixelTransform();
    ctx.fillStyle = 'rgba(10,5,22,0.72)'; ctx.fillRect(0, 0, W, H);
    const players = game.players.slice().sort((a, b) => b.wins - a.wins);
    const champ = players[0];
    const S = Math.min(W / 9, H / 6.5);
    const cx = W / 2, floorY = H * 0.72;
    // spotlight
    const sl = ctx.createRadialGradient(cx, floorY - S * 1.6, S * 0.2, cx, floorY - S * 1.2, S * 2.6);
    sl.addColorStop(0, 'rgba(255,240,180,0.28)'); sl.addColorStop(1, 'rgba(255,240,180,0)');
    ctx.fillStyle = sl; ctx.fillRect(0, 0, W, H);
    // floor
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ell(ctx, cx, floorY + S * 0.05, S * 3.6, S * 0.35); ctx.fill();
    // podium block
    const pw = S * 1.5, ph = S * 1.1, px = cx - pw / 2, py = floorY - ph;
    let g = ctx.createLinearGradient(px, 0, px + pw, 0);
    g.addColorStop(0, '#c99400'); g.addColorStop(0.45, '#ffe680'); g.addColorStop(1, '#a87400');
    ctx.fillStyle = g; rr(ctx, px, py, pw, ph, S * 0.08); ctx.fill();
    ctx.strokeStyle = '#5a3a00'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#fff3c0'; rr(ctx, px - S * 0.06, py - S * 0.12, pw + S * 0.12, S * 0.16, S * 0.05); ctx.fill(); ctx.stroke();
    text('1', cx, py + ph * 0.55, S * 0.7, '#fff6d0');
    // champion dancing on top
    const hop = Math.abs(Math.sin(t * 6)) * 0.12;
    ctx.setTransform(dpr * S, 0, 0, dpr * S, dpr * cx, dpr * (py - S * 0.5));
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ell(ctx, 0, 0.4, 0.3, 0.07); ctx.fill();
    drawBomberCore(ctx, 0, -hop, champ.style, { char: champ.char, t, mood: 'dance', armsUp: Math.floor(t * 4) % 2 === 0, facing: ['down', 'left', 'down', 'right'][Math.floor(t * 3) % 4], moving: true, walkT: t });
    pixelTransform();
    text(champ.name, cx, py - S * 1.35, S * 0.32, champ.style.light);
    // the others sit on the floor, sad
    const rest = players.slice(1);
    rest.forEach((p, i) => {
      const side = i % 2 === 0 ? 1 : -1, slot = Math.floor(i / 2);
      const x = cx + side * (pw / 2 + S * (0.75 + slot * 0.95)), y = floorY - S * 0.38;
      ctx.setTransform(dpr * S * 0.8, 0, 0, dpr * S * 0.8, dpr * x, dpr * y);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ell(ctx, 0, 0.42, 0.3, 0.07); ctx.fill();
      drawBomberCore(ctx, 0, 0, p.style, { char: p.char, t, mood: 'sad', sitting: true, facing: 'down' });
      pixelTransform();
      text(p.name, x, y + S * 0.62, S * 0.2, p.style.light, 'center', 3);
      let stars = '';
      for (let k = 0; k < p.wins; k++) stars += '★';
      if (stars) text(stars, x, y + S * 0.85, S * 0.18, '#ffd23a', 'center', 3);
    });
    let stars = '';
    for (let k = 0; k < champ.wins; k++) stars += '★';
    text(stars, cx, floorY + S * 0.35, S * 0.3, '#ffd23a');
  }

  // ======================================================= HUD
  function drawHUD(game, t) {
    pixelTransform();
    const top = oy - HUD_H * ts, h = HUD_H * ts * 0.86, w = COLS * ts;
    const g = ctx.createLinearGradient(0, top, 0, top + h);
    g.addColorStop(0, '#3a2a66'); g.addColorStop(0.5, '#22183f'); g.addColorStop(1, '#150e2a');
    ctx.fillStyle = g; rr(ctx, ox, top, w, h, ts * 0.25); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; rr(ctx, ox + 4, top + 3, w - 8, h * 0.4, ts * 0.2); ctx.fill();

    const tw = ts * 2.4, tx = ox + w / 2;
    ctx.fillStyle = '#0c0818'; rr(ctx, tx - tw / 2, top + h * 0.14, tw, h * 0.72, ts * 0.18); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.stroke();
    let label;
    if (game.sudden) label = Math.floor(t * 3) % 2 ? 'HURRY!' : '!!!';
    else { const s = Math.ceil(game.timeLeft); label = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
    const urgent = game.sudden || game.timeLeft < 30;
    text(label, tx, top + h * 0.5, ts * 0.55, urgent ? '#ff5a4a' : '#ffe36a', 'center');

    const n = game.players.length;
    const panelW = (w - tw - ts * 0.6) / 4;
    for (let i = 0; i < Math.min(4, n); i++) {
      const p = game.players[i];
      const px = i < 2 ? ox + ts * 0.15 + i * panelW : tx + tw / 2 + ts * 0.15 + (i - 2) * panelW;
      const py = top + h * 0.1, ph = h * 0.8;
      ctx.globalAlpha = p.alive ? 1 : 0.5;
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; rr(ctx, px, py, panelW - ts * 0.15, ph, ts * 0.15); ctx.fill();
      ctx.strokeStyle = p.style.main; ctx.lineWidth = 2; ctx.stroke();
      ctx.save(); rr(ctx, px, py, ts * 0.85, ph, ts * 0.15); ctx.clip();
      ctx.setTransform(dpr * ts * 0.6, 0, 0, dpr * ts * 0.6, dpr * (px + ts * 0.42), dpr * (py + ph * 0.68));
      drawBomberCore(ctx, 0, 0, p.style, { char: p.char, facing: 'down', t, mood: ps(p).panic && p.alive ? 'panic' : null });
      ctx.restore();
      pixelTransform();
      if (!p.alive) text(game.ghostActive(p) ? '☁' : '✖', px + ts * 0.42, py + ph * 0.5, ts * 0.55, game.ghostActive(p) ? '#fff' : '#ff4a3c', 'center');
      const nx = px + ts * 0.85;
      text(p.tag, nx, py + ph * 0.3, ts * Math.min(0.32, 1.2 / p.tag.length), p.style.light, 'left', 3);
      const need = game.cfg.winsNeeded;
      for (let k = 0; k < Math.min(need, 7); k++) {
        ctx.setTransform(dpr * ts * 0.22, 0, 0, dpr * ts * 0.22, dpr * (nx + ts * 0.14 + k * ts * 0.26), dpr * (py + ph * 0.72));
        ctx.fillStyle = k < p.wins ? '#ffd23a' : 'rgba(255,255,255,0.18)';
        star(ctx, 0, 0, 0.55); ctx.fill();
        if (k < p.wins) { ctx.strokeStyle = '#7a4a00'; ctx.lineWidth = 0.1; ctx.stroke(); }
        pixelTransform();
      }
      const sx2 = px + panelW - ts * 1.25;
      if (panelW > ts * 2.6) {
        ctx.setTransform(dpr * ts * 0.5, 0, 0, dpr * ts * 0.5, dpr * sx2, dpr * (py + ph * 0.32));
        drawItemIcon(ctx, 'bomb', t);
        ctx.setTransform(dpr * ts * 0.5, 0, 0, dpr * ts * 0.5, dpr * sx2, dpr * (py + ph * 0.74));
        drawItemIcon(ctx, p.stats.gold ? 'gold' : 'fire', t);
        pixelTransform();
        text(String(p.stats.bombs), sx2 + ts * 0.32, py + ph * 0.32, ts * 0.3, '#fff', 'left', 3);
        text(p.stats.gold ? 'MAX' : String(p.stats.fire), sx2 + ts * 0.32, py + ph * 0.74, ts * 0.3, '#fff', 'left', 3);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawOverlayText(game, t) {
    pixelTransform();
    const cx = ox + COLS * ts / 2, cy = oy + ROWS * ts / 2;
    if (game.phase === 'countdown') {
      const unit = RULES.countdown / 3, n = Math.ceil(game.phaseT / unit);
      const frac = game.phaseT / unit - Math.floor(game.phaseT / unit);
      const sc = 1 + frac * 0.5;
      if (game.round && n === 3) text('ROUND ' + game.round, cx, cy - ts * 1.6, ts * 0.8, '#fff');
      if (n === 3) text(game.arena.name, cx, cy - ts * 0.8, ts * 0.5, '#bfe9ff');
      text(String(n), cx, cy + ts * 0.4, ts * 1.6 * sc, '#ffe36a');
    } else if (game.phase === 'play' && game.time - game.goTime < 0.8) {
      const k = (game.time - game.goTime) / 0.8;
      ctx.globalAlpha = 1 - k;
      text('GO!', cx, cy, ts * (1.8 + k), '#7dff6a');
      ctx.globalAlpha = 1;
    }
    if (banner) {
      const k = banner.age / banner.life;
      const a = k < 0.1 ? k / 0.1 : k > 0.8 ? (1 - k) / 0.2 : 1;
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(20,8,30,0.6)'; ctx.fillRect(ox, cy - ts * 0.9, COLS * ts, ts * 1.8);
      text(banner.text, cx, cy - ts * 0.15, ts * 1.1, banner.color);
      text(banner.sub, cx, cy + ts * 0.55, ts * 0.4, '#fff');
      ctx.globalAlpha = 1;
    }
  }

  function itemCanvas(type, size) {
    const cv = document.createElement('canvas');
    const d = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = size * d; cv.height = size * d; cv.style.width = size + 'px'; cv.style.height = size + 'px';
    const c = cv.getContext('2d');
    c.setTransform(size * d, 0, 0, size * d, size * d / 2, size * d / 2);
    drawItem(c, -0.5, -0.45, { type, age: 1 }, 0);
    return cv;
  }
  function bomberCanvas(style, size, char, mood) {
    const cv = document.createElement('canvas');
    const d = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = size * d; cv.height = size * d; cv.style.width = size + 'px'; cv.style.height = size + 'px';
    const c = cv.getContext('2d');
    c.setTransform(size * d * 0.72, 0, 0, size * d * 0.72, size * d / 2, size * d * 0.62);
    drawBomberCore(c, 0, 0, style, { char, facing: 'down', t: 0, mood, armsUp: mood === 'happy' });
    return cv;
  }

  return { init, resize, draw, update, onEvent, itemCanvas, bomberCanvas, setOptions };
})();
