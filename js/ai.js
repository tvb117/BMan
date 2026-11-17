'use strict';

// Computer-controlled players. They produce the same input structure as humans.
const AI = (() => {
  const LEVELS = {
    easy:   { think: 0.45, react: 0.35, aggro: 0.3, itemRange: 6,  bombChance: 0.45, hunt: 0.15, compensate: false },
    normal: { think: 0.2,  react: 0.12, aggro: 0.7, itemRange: 10, bombChance: 0.85, hunt: 0.5,  compensate: true },
    hard:   { think: 0.08, react: 0.03, aggro: 1.2, itemRange: 16, bombChance: 1.0,  hunt: 1.0,  compensate: true },
  };
  const N = COLS * ROWS;
  const idx = (x, y) => y * COLS + x;
  const dist = new Int16Array(N), prev = new Int16Array(N), queue = new Int16Array(N);

  let cacheGame = null, cacheTime = -1, cacheDanger = new Map();

  function blastTiles(game, tx, ty, range, pierce) {
    const out = [idx(tx, ty)];
    for (const dn of DIR_NAMES) {
      const d = DIRS[dn];
      for (let i = 1; i <= range; i++) {
        const x = tx + d.x * i, y = ty + d.y * i;
        if (!inBounds(x, y)) break;
        const g = game.grid[y][x];
        if (g === HARD) break;
        out.push(idx(x, y));
        if (g === SOFT) { if (!pierce) break; continue; }
        if (game.bombAt(x, y) || game.pickups[y][x]) break;
      }
    }
    return out;
  }

  // Time until each tile is hit by an explosion (Infinity = safe, negative = burning now).
  function computeDanger(game, self, extra) {
    const D = new Float32Array(N).fill(Infinity);
    const list = [];
    for (const b of game.bombs) {
      let tx = b.tx, ty = b.ty;
      if (b.state === 'fly') {
        const d = DIRS[b.dir];
        tx = wrapTile(b.fly.sx + d.x * b.fly.dist, 1, COLS - 2);
        ty = wrapTile(b.fly.sy + d.y * b.fly.dist, 1, ROWS - 2);
      }
      let t = b.fuse;
      if (b.remote && !b.triggered) t = b.owner === self.id ? 2.0 : 0.7;
      list.push({ tx, ty, range: b.range, pierce: b.pierce, t });
    }
    if (extra) list.push(extra);
    const tiles = list.map(e => blastTiles(game, e.tx, e.ty, e.range, e.pierce));
    for (let iter = 0; iter < 8; iter++) {
      let changed = false;
      for (let i = 0; i < list.length; i++) {
        for (let j = 0; j < list.length; j++) {
          if (i === j || list[j].t <= list[i].t) continue;
          if (tiles[i].includes(idx(list[j].tx, list[j].ty))) { list[j].t = list[i].t; changed = true; }
        }
      }
      if (!changed) break;
    }
    for (let i = 0; i < list.length; i++) for (const k of tiles[i]) if (list[i].t < D[k]) D[k] = list[i].t;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (game.flames[y][x]) D[idx(x, y)] = -1;
    if (game.sudden) {
      let tt = game.sdTimer;
      for (let k = game.sdIndex; k < Math.min(game.spiral.length, game.sdIndex + 14); k++) {
        const c = game.spiral[k];
        if (game.grid[c.y][c.x] === HARD) continue;
        const i = idx(c.x, c.y);
        D[i] = Math.min(D[i], tt);
        tt += RULES.suddenDeathInterval;
      }
      for (const f of game.falling) D[idx(f.x, f.y)] = Math.min(D[idx(f.x, f.y)], 0);
    }
    return D;
  }

  function dangerFor(game, p) {
    if (cacheGame !== game || cacheTime !== game.time) { cacheGame = game; cacheTime = game.time; cacheDanger = new Map(); }
    let D = cacheDanger.get(p.id);
    if (!D) { D = computeDanger(game, p, null); cacheDanger.set(p.id, D); }
    return D;
  }

  function walkable(game, x, y, avoidSkull) {
    if (game.grid[y][x] !== EMPTY || game.bombAt(x, y)) return false;
    if (avoidSkull) { const pk = game.pickups[y][x]; if (pk && pk.type === 'skull') return false; }
    return true;
  }

  // BFS. mode 'strict' = avoid every dangerous tile, 'timed' = may cross danger if fast enough.
  function bfs(game, p, D, mode) {
    dist.fill(-1);
    const sx = Math.floor(p.x), sy = Math.floor(p.y);
    const start = idx(sx, sy);
    const stepT = 1 / game.playerSpeed(p);
    let qh = 0, qt = 0;
    dist[start] = 0; prev[start] = -1; queue[qt++] = start;
    const order = [];
    while (qh < qt) {
      const i = queue[qh++];
      order.push(i);
      const x = i % COLS, y = (i / COLS) | 0;
      for (const dn of DIR_NAMES) {
        const d = DIRS[dn];
        const nx = x + d.x, ny = y + d.y;
        if (!inBounds(nx, ny)) continue;
        const j = idx(nx, ny);
        if (dist[j] >= 0) continue;
        if (!walkable(game, nx, ny, mode === 'strict')) continue;
        const dj = D[j];
        if (mode === 'strict') {
          if (dj !== Infinity) continue;
        } else {
          if (dj < 0) continue;
          if (dj !== Infinity) {
            const arrive = (dist[i] + 1) * stepT;
            const okBefore = arrive + stepT * 0.7 + 0.12 < dj;
            const okAfter = arrive > dj + RULES.flameTime + 0.15;
            if (!okBefore && !okAfter) continue;
          }
        }
        dist[j] = dist[i] + 1; prev[j] = i; queue[qt++] = j;
      }
    }
    return { order, start };
  }

  function buildPath(target) {
    const path = [];
    let i = target;
    while (i >= 0 && prev[i] >= 0) { path.push(i); i = prev[i]; }
    path.reverse();
    return path;
  }

  function bombValue(game, p, x, y, enemies, L) {
    const range = game.bombRange(p);
    const tiles = blastTiles(game, x, y, range, p.stats.pierce);
    let v = 0;
    for (const k of tiles) {
      const tx = k % COLS, ty = (k / COLS) | 0;
      if (game.grid[ty][tx] === SOFT && !game.burnMap[ty][tx]) v += 1;
      const pk = game.pickups[ty][tx];
      if (pk && pk.type !== 'skull') v -= 1.5;
    }
    for (const e of enemies) {
      const ex = Math.floor(e.x), ey = Math.floor(e.y);
      if (tiles.includes(idx(ex, ey))) v += 3 * L.aggro * (e.mount ? 0.6 : 1);
    }
    return v;
  }

  function think(game, p, s, D, L, out) {
    const cx = Math.floor(p.x), cy = Math.floor(p.y), ci = idx(cx, cy);
    const enemies = game.players.filter(o => o.alive && o !== p);

    // 1) In danger: run!
    if (D[ci] !== Infinity) {
      const r = bfs(game, p, D, 'timed');
      let target = -1;
      for (const j of r.order) if (D[j] === Infinity) { target = j; break; }
      if (target < 0) {
        let best = -Infinity;
        for (const j of r.order) if (D[j] > best) { best = D[j]; target = j; }
      }
      s.path = target >= 0 ? buildPath(target) : [];
      s.mode = 'flee';
      return;
    }
    s.mode = 'roam';

    // 2) Remote detonation
    if (p.stats.remote) {
      for (const b of game.bombs) {
        if (b.owner !== p.id || !b.remote || b.triggered || b.state !== 'idle') continue;
        const tiles = blastTiles(game, b.tx, b.ty, b.range, b.pierce);
        if (tiles.includes(ci)) continue;
        const hitsEnemy = enemies.some(e => tiles.includes(idx(Math.floor(e.x), Math.floor(e.y))));
        if (hitsEnemy || game.time - b.born > 2.2) { out.action = true; break; }
      }
    }

    // 3) Place a bomb here?
    const canBomb = p.bombsOut < p.stats.bombs && !(p.disease && p.disease.type === 'constipation') && !game.bombAt(cx, cy);
    if (canBomb) {
      const val = bombValue(game, p, cx, cy, enemies, L);
      if (val > 0.5 && Math.random() < L.bombChance) {
        const extra = { tx: cx, ty: cy, range: game.bombRange(p), pierce: p.stats.pierce, t: p.stats.remote ? 2.0 : RULES.fuse };
        const D2 = computeDanger(game, p, extra);
        const r = bfs(game, p, D2, 'timed');
        let target = -1;
        for (const j of r.order) if (D2[j] === Infinity && j !== ci) { target = j; break; }
        if (target >= 0) {
          const path = buildPath(target);
          if (path.length <= 7) { out.bomb = true; s.path = path; s.mode = 'flee'; return; }
        }
      }
    }

    // 4) Pick a goal
    const r = bfs(game, p, D, 'strict');
    let best = -1, bestScore = 0.05;
    let stepDist = new Map();
    {
      // reconstruct distances along order (dist array is still valid)
      for (const j of r.order) stepDist.set(j, dist[j]);
    }
    for (const j of r.order) {
      const d = stepDist.get(j);
      const x = j % COLS, y = (j / COLS) | 0;
      let sc = 0;
      const pk = game.pickups[y][x];
      if (pk && pk.age >= 0 && pk.type !== 'skull' && d <= L.itemRange) sc += 6;
      if (p.bombsOut < p.stats.bombs) sc += Math.max(0, bombValue(game, p, x, y, enemies, L));
      if (enemies.length && L.hunt > 0) {
        let md = 99;
        for (const e of enemies) md = Math.min(md, Math.abs(e.x - x - 0.5) + Math.abs(e.y - y - 0.5));
        sc += L.hunt * Math.max(0, 6 - md) * 0.15;
      }
      if (j === ci) sc *= 1.1;
      sc = sc / (1 + d * 0.35);
      if (sc > bestScore) { bestScore = sc; best = j; }
    }
    if (best >= 0) {
      if (best === s.goal) s.goalT += L.think; else { s.goal = best; s.goalT = 0; }
      if (s.goalT > 3 && best === ci) best = -1; // stuck: wander instead
    }
    if (best < 0 && r.order.length > 1) {
      const near = r.order.slice(1, 12);
      best = near[(Math.random() * near.length) | 0];
    }
    s.path = best >= 0 ? buildPath(best) : [];
  }

  function followPath(game, p, s) {
    const cx = Math.floor(p.x), cy = Math.floor(p.y), ci = idx(cx, cy);
    while (s.path.length && s.path[0] === ci) s.path.shift();
    if (!s.path.length) {
      const ox = p.x - (cx + 0.5), oy = p.y - (cy + 0.5);
      if (Math.abs(ox) > 0.08) return ox > 0 ? 'left' : 'right';
      if (Math.abs(oy) > 0.08) return oy > 0 ? 'up' : 'down';
      return null;
    }
    const n = s.path[0];
    const nx = n % COLS, ny = (n / COLS) | 0;
    if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1 || !walkable(game, nx, ny, false)) {
      s.path = []; s.thinkT = 0;
      return null;
    }
    if (nx > cx) return 'right';
    if (nx < cx) return 'left';
    if (ny > cy) return 'down';
    return 'up';
  }

  // Dead bots float along the border and throw bombs at the nearest enemy.
  function ghostControl(game, p, dt, L, s) {
    const out = { dir: null, dir2: null, bomb: false, action: false };
    const g = p.ghost;
    const enemies = game.players.filter(o => o.alive);
    if (!enemies.length) return out;
    const R = RING.length;
    const landing = i => {
      const t = RING[i], dir = ringInward(t);
      if (!dir) return null;
      const d = DIRS[dir];
      return { x: t.x + d.x * RULES.ghostThrow + 0.5, y: t.y + d.y * RULES.ghostThrow + 0.5 };
    };
    s.ghostT = (s.ghostT || 0) - dt;
    if (s.ghostGoal === undefined || s.ghostT <= 0) {
      s.ghostT = L.think * 3 + 0.3;
      let e = enemies[0], ed = Infinity;
      const gp = game.ghostPos(p);
      for (const o of enemies) { const d = Math.abs(o.x - gp.x) + Math.abs(o.y - gp.y); if (d < ed) { ed = d; e = o; } }
      let best = -1, bs = Infinity;
      for (let i = 0; i < R; i++) {
        const l = landing(i);
        if (!l) continue;
        let rd = Math.abs(i - g.s); rd = Math.min(rd, R - rd);
        const sc = Math.abs(l.x - e.x) + Math.abs(l.y - e.y) + rd * 0.08;
        if (sc < bs) { bs = sc; best = i; }
      }
      s.ghostGoal = best;
    }
    if (s.ghostGoal < 0) return out;
    let diff = s.ghostGoal - g.s;
    if (diff > R / 2) diff -= R;
    if (diff < -R / 2) diff += R;
    if (Math.abs(diff) > 0.1) {
      const sign = Math.sign(diff);
      const i = Math.floor(g.s) % R;
      const onPoint = g.s - Math.floor(g.s) < 0.05;
      let a, b;
      if (sign > 0 || !onPoint) { a = RING[i]; b = RING[(i + 1) % R]; }
      else { a = RING[(i - 1 + R) % R]; b = RING[i]; }
      const tx = (b.x - a.x) * sign, ty = (b.y - a.y) * sign;
      out.dir = tx > 0 ? 'right' : tx < 0 ? 'left' : ty > 0 ? 'down' : 'up';
    } else if (g.cd <= 0 && p.bombsOut < 1) {
      const l = landing(s.ghostGoal);
      const near = l && enemies.some(o => Math.abs(o.x - l.x) + Math.abs(o.y - l.y) <= (p.bot === 'easy' ? 3 : 1.6));
      if (near && Math.random() < (p.bot === 'easy' ? 0.02 : 0.08)) out.bomb = true;
    }
    return out;
  }

  // Try a Hopper jump/dash out of danger. Returns a direction to face, or null.
  function hopperEscape(game, p, D) {
    const m = p.mount;
    if (!m || m.cd > 0 || (m.type !== 'jump' && m.type !== 'dash')) return null;
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    for (const dn of DIR_NAMES) {
      const d = DIRS[dn];
      if (m.type === 'jump') {
        const x = cx + d.x * RULES.jumpDist, y = cy + d.y * RULES.jumpDist;
        if (x < 1 || y < 1 || x > COLS - 2 || y > ROWS - 2) continue;
        if (game.grid[y][x] === EMPTY && !game.bombAt(x, y) && D[idx(x, y)] === Infinity) return dn;
      } else {
        let x = cx, y = cy;
        for (let k = 0; k < 4; k++) {
          const nx = x + d.x, ny = y + d.y;
          if (!walkable(game, nx, ny, false) || D[idx(nx, ny)] < 0) break;
          x = nx; y = ny;
          if (D[idx(x, y)] === Infinity && k >= 1) return dn;
        }
      }
    }
    return null;
  }

  function control(game, p, dt) {
    const out = { dir: null, dir2: null, bomb: false, action: false };
    const L = LEVELS[p.bot] || LEVELS.normal;
    if (!p.alive) {
      if (game.phase === 'play' && game.ghostActive(p)) return ghostControl(game, p, dt, L, p.ai || (p.ai = { thinkT: 0, path: [], mode: 'roam', goal: -1, goalT: 0 }));
      return out;
    }
    if (game.phase !== 'play') return out;
    const s = p.ai || (p.ai = { thinkT: Math.random() * 0.3, path: [], mode: 'roam', goal: -1, goalT: 0 });
    const D = dangerFor(game, p);
    const ci = idx(Math.floor(p.x), Math.floor(p.y));
    s.thinkT -= dt;
    if (D[ci] !== Infinity && s.mode !== 'flee') s.thinkT = Math.min(s.thinkT, L.react);
    if (s.mode !== 'flee' && s.path.length && D[s.path[0]] !== Infinity) { s.path = []; s.thinkT = Math.min(s.thinkT, L.react); }
    if (s.thinkT <= 0) {
      s.thinkT = L.think * (0.7 + Math.random() * 0.6);
      think(game, p, s, D, L, out);
    }
    // Fleeing with no fully safe route? Use the Hopper's jump or dash (not on easy).
    if (D[ci] !== Infinity && p.bot !== 'easy' && p.mount && p.mount.cd <= 0) {
      const last = s.path.length ? s.path[s.path.length - 1] : ci;
      if (D[last] !== Infinity || s.path.length > 3) {
        const esc = hopperEscape(game, p, D);
        if (esc) { out.dir = esc; out.action = true; s.path = []; return out; }
      }
    }
    out.dir = followPath(game, p, s);
    if (L.compensate && p.disease && p.disease.type === 'reverse' && out.dir) out.dir = OPPOSITE[out.dir];
    return out;
  }

  return { control, LEVELS };
})();
