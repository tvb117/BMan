'use strict';

function approach(v, t, s) { return v < t ? Math.min(t, v + s) : Math.max(t, v - s); }
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function inBounds(x, y) { return x >= 0 && y >= 0 && x < COLS && y < ROWS; }
function wrapTile(v, lo, hi) { const n = hi - lo + 1; return ((((v - lo) % n) + n) % n) + lo; }
function wrapPos(v, lo, hi) { const n = hi - lo; return ((((v - lo) % n) + n) % n) + lo; }
function makeGrid(fill) { const g = []; for (let y = 0; y < ROWS; y++) g.push(new Array(COLS).fill(fill)); return g; }
function pick(a) { return a[(Math.random() * a.length) | 0]; }

const NO_INPUT = { dir: null, dir2: null, bomb: false, action: false };

class Game {
  // cfg: { players:[{name, tag, style, control, bot}], winsNeeded, roundTime, density, diseases }
  constructor(cfg) {
    this.cfg = cfg;
    this.players = cfg.players.map((pc, i) => ({
      id: i, name: pc.name, tag: pc.tag, style: pc.style, char: pc.char || 'robo', control: pc.control, bot: pc.bot || null,
      wins: 0, spawn: SPAWNS[i],
    }));
    this.round = 0;
    this.events = [];
    this.time = 0;
    this.bombSeq = 0;
    this.mapVersion = 0;
  }

  emit(type, data) { this.events.push(Object.assign({ type }, data || {})); }

  startRound(arena) {
    this.round++;
    this.mapVersion++;
    this.arena = arena;
    const m = buildArena(arena, this.cfg);
    this.grid = m.grid; this.special = m.special; this.hidden = m.hidden;
    this.pickups = makeGrid(null);
    this.flames = makeGrid(null);
    this.burnMap = makeGrid(false);
    this.bombs = []; this.burning = []; this.falling = [];
    this.timeLeft = this.cfg.roundTime;
    this.sudden = false; this.spiral = spiralOrder(); this.sdIndex = 0; this.sdTimer = 0;
    this.phase = 'countdown'; this.phaseT = RULES.countdown; this.lastBeep = RULES.countdown + 1;
    this.ending = false; this.endT = 0; this.winner = null; this.goTime = -10;
    for (const p of this.players) {
      Object.assign(p, {
        x: p.spawn.x + 0.5, y: p.spawn.y + 0.5, facing: 'down', alive: true, deadT: 0,
        stats: { bombs: RULES.startBombs, fire: RULES.startFire, speed: 0, kick: false, punch: false, remote: false, pierce: false, line: false, gold: false },
        bombsOut: 0, disease: null, mount: null, invuln: 0, stun: 0, collected: [], walkT: 0, moving: false,
        slideDir: null, warpLock: -1, ai: null, diarrheaT: 0,
        jump: null, dash: null, h: 0, ghost: null,
      });
    }
    this.emit('roundStart');
  }

  // ---------- queries ----------
  bombAt(x, y) {
    for (const b of this.bombs) if (b.state !== 'fly' && b.tx === x && b.ty === y) return b;
    return null;
  }
  playerOnTile(x, y) {
    for (const p of this.players) if (p.alive && Math.floor(p.x) === x && Math.floor(p.y) === y) return p;
    return null;
  }
  specialAt(x, y) { return inBounds(x, y) ? this.special[y][x] : null; }
  blocksPlayer(p, x, y) {
    if (!inBounds(x, y)) return true;
    if (this.grid[y][x] !== EMPTY) return true;
    const b = this.bombAt(x, y);
    if (b && !(x === Math.floor(p.x) && y === Math.floor(p.y))) return true;
    return false;
  }
  blocksBomb(x, y) {
    if (!inBounds(x, y)) return true;
    if (this.grid[y][x] !== EMPTY) return true;
    if (this.bombAt(x, y)) return true;
    if (this.playerOnTile(x, y)) return true;
    return false;
  }
  playerSpeed(p) {
    const d = p.disease && p.disease.type;
    if (d === 'slow') return RULES.slowSpeed;
    if (d === 'hyper') return RULES.hyperSpeed;
    return RULES.baseSpeed + RULES.speedStep * p.stats.speed;
  }
  bombRange(p) {
    if (p.disease && p.disease.type === 'tinyflame') return 1;
    return p.stats.gold ? RULES.goldFire : p.stats.fire;
  }

  // ---------- main update ----------
  update(dt, inputs) {
    this.time += dt;
    if (this.phase === 'countdown') {
      this.phaseT -= dt;
      const n = Math.ceil(this.phaseT / (RULES.countdown / 3));
      if (n < this.lastBeep && n > 0) { this.lastBeep = n; this.emit('beep', { n }); }
      if (this.phaseT <= 0) { this.phase = 'play'; this.goTime = this.time; this.emit('go'); }
      return;
    }
    if (this.phase === 'over') return;

    if (!this.sudden) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.sudden = true; this.emit('hurry'); }
    } else {
      this.updateSudden(dt);
    }

    for (let i = 0; i < this.players.length; i++) this.updatePlayer(this.players[i], inputs[i] || NO_INPUT, dt);
    this.updateBombs(dt);
    this.updateFlames(dt);
    this.updateBurning(dt);
    this.updateFalling(dt);
    this.updatePickups(dt);
    this.checkHazards();
    this.checkPickups();
    this.spreadDisease();
    this.checkRoundEnd(dt);
  }

  // ---------- players ----------
  updatePlayer(p, inp, dt) {
    if (!p.alive) {
      p.deadT += dt;
      if (this.cfg.revenge) this.updateGhost(p, inp, dt);
      return;
    }
    if (p.invuln > 0) p.invuln -= dt;
    if (p.mount && p.mount.cd > 0) p.mount.cd -= dt;
    if (p.disease) {
      p.disease.t -= dt;
      if (p.disease.t <= 0) { p.disease = null; this.emit('cured', { player: p.id, x: p.x, y: p.y }); }
    }

    // Hopper jump: airborne, no control until landing
    if (p.jump) {
      const j = p.jump;
      j.t += dt;
      const k = Math.min(1, j.t / j.dur);
      p.x = j.sx + (j.tx - j.sx) * k;
      p.y = j.sy + (j.ty - j.sy) * k;
      p.h = Math.sin(Math.PI * k) * 0.9;
      p.moving = true; p.walkT += dt;
      if (k >= 1) { p.jump = null; p.h = 0; this.emit('land', { x: p.x, y: p.y, player: p.id }); }
      return;
    }

    if (p.stun > 0) { p.stun -= dt; p.moving = false; p.dash = null; return; }

    // Hopper dash: run straight ahead until blocked or time is up
    if (p.dash) {
      p.dash.t -= dt;
      const m = this.tryMove(p, p.dash.dir, RULES.dashSpeed * dt, true);
      p.moving = m > 0; p.walkT += dt * 2;
      if (m === 0 || p.dash.t <= 0) p.dash = null;
      if (inp.bomb) this.tryPlaceBomb(p, true);
      return;
    }

    const dis = p.disease && p.disease.type;
    let dir = inp.dir, dir2 = inp.dir2;
    if (dis === 'reverse') { dir = dir && OPPOSITE[dir]; dir2 = dir2 && OPPOSITE[dir2]; }

    const speed = this.playerSpeed(p);
    const dist = speed * dt;
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    const sp = this.special[cy][cx];
    const onIce = sp && sp.type === 'ice';
    let moved = 0, movedDir = null;

    if (dir) {
      p.facing = dir;
      moved = this.tryMove(p, dir, dist, true);
      movedDir = moved > 0 ? dir : null;
      if (moved < dist * 0.5 && dir2) {
        const m2 = this.tryMove(p, dir2, dist - moved, true);
        if (m2 > 0) { moved += m2; movedDir = dir2; p.facing = dir2; }
      }
    } else if (onIce && p.slideDir) {
      moved = this.tryMove(p, p.slideDir, dist, false);
      movedDir = moved > 0 ? p.slideDir : null;
    }
    if (onIce) p.slideDir = movedDir; else p.slideDir = null;

    p.moving = moved > 0;
    if (p.moving) p.walkT += dt * Math.min(speed, 6) / 3.4;

    // Conveyor belts
    const tx = Math.floor(p.x), ty = Math.floor(p.y);
    const sp2 = this.special[ty][tx];
    if (sp2 && sp2.type === 'conveyor') this.tryMove(p, sp2.dir, RULES.conveyorSpeed * dt, false);

    // Warps
    const wx = Math.floor(p.x), wy = Math.floor(p.y), wk = wy * COLS + wx;
    const sp3 = this.special[wy][wx];
    if (p.warpLock !== wk) p.warpLock = -1;
    if (sp3 && sp3.type === 'warp' && p.warpLock === -1 &&
        Math.abs(p.x - wx - 0.5) < 0.2 && Math.abs(p.y - wy - 0.5) < 0.2) {
      const t = sp3.to;
      if (!this.bombAt(t.x, t.y)) {
        this.emit('warp', { x: p.x, y: p.y });
        p.x = t.x + 0.5; p.y = t.y + 0.5;
        p.warpLock = t.y * COLS + t.x;
        p.slideDir = null;
        this.emit('warp', { x: p.x, y: p.y });
      }
    }

    // Bombs
    if (dis === 'diarrhea') {
      p.diarrheaT -= dt;
      if (p.diarrheaT <= 0) { if (this.tryPlaceBomb(p, false)) p.diarrheaT = 0.25; }
    }
    if (inp.bomb) this.tryPlaceBomb(p, true);
    if (inp.action) this.doAction(p);
  }

  tryMove(p, dir, dist, canKick) {
    const d = DIRS[dir];
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    const horiz = d.x !== 0;
    const s = horiz ? d.x : d.y;
    const along = horiz ? p.x : p.y;
    const perp = horiz ? p.y : p.x;
    const centerAlong = (horiz ? cx : cy) + 0.5;
    const centerPerp = (horiz ? cy : cx) + 0.5;
    const offPerp = perp - centerPerp;
    const past = (along - centerAlong) * s;
    const nx = cx + d.x, ny = cy + d.y;
    const setPos = (a, b) => { if (horiz) { p.x = a; p.y = b; } else { p.y = a; p.x = b; } };

    if (!this.blocksPlayer(p, nx, ny)) {
      setPos(along + s * dist, approach(perp, centerPerp, dist));
      return dist;
    }
    // Blocked ahead: maybe kick
    if (canKick && this.canKick(p) && past > -0.15 && Math.abs(offPerp) < 0.3) {
      const b = this.bombAt(nx, ny);
      if (b && b.state === 'idle') this.kickBomb(b, dir);
    }
    if (past < 0) {
      const m = Math.min(dist, -past);
      setPos(along + s * m, approach(perp, centerPerp, m));
      return m;
    }
    // Corner sliding: if we're leaning towards a free lane, slide into it
    if (Math.abs(offPerp) > 0.1) {
      const ps = Math.sign(offPerp);
      const sx = horiz ? cx : cx + ps, sy = horiz ? cy + ps : cy;
      if (!this.blocksPlayer(p, sx, sy) && !this.blocksPlayer(p, sx + d.x, sy + d.y)) {
        setPos(along, perp + ps * dist);
        return dist;
      }
      // Otherwise just center back
      const m = Math.min(dist, Math.abs(offPerp));
      setPos(along, approach(perp, centerPerp, m));
      return 0;
    }
    return 0;
  }

  tryPlaceBomb(p, pressed) {
    if (p.disease && p.disease.type === 'constipation') return false;
    const tx = Math.floor(p.x), ty = Math.floor(p.y);
    const existing = this.bombAt(tx, ty);
    if (existing) {
      if (pressed && p.stats.line) return this.lineBomb(p, tx, ty);
      return false;
    }
    if (p.bombsOut >= p.stats.bombs) return false;
    if (this.grid[ty][tx] !== EMPTY) return false;
    this.placeBomb(p, tx, ty);
    return true;
  }

  lineBomb(p, tx, ty) {
    const d = DIRS[p.facing];
    let x = tx + d.x, y = ty + d.y, placed = 0;
    while (p.bombsOut < p.stats.bombs && inBounds(x, y) && this.grid[y][x] === EMPTY &&
           !this.bombAt(x, y) && !this.playerOnTile(x, y)) {
      this.placeBomb(p, x, y, true);
      placed++;
      x += d.x; y += d.y;
    }
    if (placed) this.emit('place', { x: tx, y: ty });
    return placed > 0;
  }

  placeBomb(p, tx, ty, silent) {
    const dis = p.disease && p.disease.type;
    const b = {
      id: ++this.bombSeq, owner: p.id, tx, ty, x: tx + 0.5, y: ty + 0.5, h: 0,
      fuse: dis === 'shortfuse' ? RULES.shortFuse : RULES.fuse,
      range: this.bombRange(p), pierce: p.stats.pierce, remote: p.stats.remote && dis !== 'shortfuse',
      triggered: false, state: 'idle', dir: null, progress: 0, centerDone: true, conv: false, born: this.time,
    };
    this.bombs.push(b);
    p.bombsOut++;
    if (!silent) this.emit('place', { x: tx, y: ty });
    return b;
  }

  canKick(p) { return p.stats.kick || (p.mount && p.mount.type === 'kick'); }
  canPunch(p) { return p.stats.punch || (p.mount && p.mount.type === 'punch'); }

  // Action button: punch > remote detonation > Hopper move
  doAction(p) {
    const tx = Math.floor(p.x), ty = Math.floor(p.y);
    if (this.canPunch(p)) {
      const d = DIRS[p.facing];
      let b = this.bombAt(tx + d.x, ty + d.y);
      if (b) {
        const dd = Math.abs(b.x - p.x) + Math.abs(b.y - p.y);
        if (dd > 1.25) b = null;
      }
      if (!b) b = this.bombAt(tx, ty);
      if (b && (b.state === 'idle' || b.state === 'slide')) { this.punchBomb(b, p.facing); return; }
    }
    if (p.stats.remote) {
      let oldest = null;
      for (const b of this.bombs) {
        if (b.owner === p.id && b.remote && !b.triggered && b.state !== 'fly' && (!oldest || b.id < oldest.id)) oldest = b;
      }
      if (oldest) { oldest.triggered = true; oldest.fuse = 0; this.emit('click'); return; }
    }
    this.hopperMove(p);
  }

  hopperMove(p) {
    const m = p.mount;
    if (!m || m.cd > 0) return false;
    const d = DIRS[p.facing];
    const tx = Math.floor(p.x), ty = Math.floor(p.y);
    if (m.type === 'jump') {
      const jx = tx + d.x * RULES.jumpDist, jy = ty + d.y * RULES.jumpDist;
      if (jx < 1 || jy < 1 || jx > COLS - 2 || jy > ROWS - 2) return false;
      if (this.grid[jy][jx] !== EMPTY || this.bombAt(jx, jy)) return false;
      p.jump = { sx: p.x, sy: p.y, tx: jx + 0.5, ty: jy + 0.5, t: 0, dur: RULES.jumpTime };
      p.slideDir = null;
      m.cd = RULES.jumpCd;
      this.emit('jump', { x: p.x, y: p.y });
      return true;
    }
    if (m.type === 'dash') {
      p.dash = { dir: p.facing, t: RULES.dashTime };
      m.cd = RULES.dashCd;
      this.emit('dash', { x: p.x, y: p.y, dir: p.facing });
      return true;
    }
    return false;
  }

  // ---------- sideline revenge (dead players) ----------
  ghostActive(p) { return !p.alive && !!p.ghost; }
  // The sideline closes for the last minute (and sudden death).
  sidelineOpen() { return !this.sudden && this.timeLeft > RULES.ghostCloseAt; }
  ghostPos(p) {
    const L = RING.length, s = p.ghost.s;
    const i = Math.floor(s) % L, f = s - Math.floor(s);
    const a = RING[i], b = RING[(i + 1) % L];
    return { x: a.x + (b.x - a.x) * f + 0.5, y: a.y + (b.y - a.y) * f + 0.5 };
  }
  ghostTile(p) { return RING[Math.round(p.ghost.s) % RING.length]; }
  updateGhost(p, inp, dt) {
    if (this.phase !== 'play') return;
    if (!this.sidelineOpen()) {
      if (p.ghost) { const pos = this.ghostPos(p); p.ghost = null; this.emit('ghostGone', { player: p.id, x: pos.x, y: pos.y }); }
      return;
    }
    if (!p.ghost) {
      if (p.deadT < RULES.ghostDelay) return;
      // appear at the border point closest to where we died
      let best = 0, bd = Infinity;
      RING.forEach((t, i) => { const d = Math.abs(t.x + 0.5 - p.x) + Math.abs(t.y + 0.5 - p.y); if (d < bd) { bd = d; best = i; } });
      p.ghost = { s: best, cd: 0.5 };
      this.emit('ghost', { player: p.id });
    }
    const g = p.ghost, L = RING.length;
    if (g.cd > 0) g.cd -= dt;
    if (inp.dir) {
      const d = DIRS[inp.dir];
      const i = Math.floor(g.s) % L;
      const a = RING[i], b = RING[(i + 1) % L];
      let dot = d.x * (b.x - a.x) + d.y * (b.y - a.y);
      if (dot === 0 && g.s - Math.floor(g.s) < 0.05) {
        const pa = RING[(i - 1 + L) % L];
        dot = d.x * (a.x - pa.x) + d.y * (a.y - pa.y);
      }
      if (dot !== 0) { g.s = (g.s + Math.sign(dot) * RULES.ghostSpeed * dt + L) % L; p.facing = inp.dir; }
    }
    if (inp.bomb) this.ghostThrow(p);
  }
  ghostThrow(p) {
    const g = p.ghost;
    if (g.cd > 0 || p.bombsOut >= 1) return false;
    const t = this.ghostTile(p);
    const dir = ringInward(t);
    if (!dir) return false;
    g.s = Math.round(g.s) % RING.length;
    g.cd = RULES.ghostCd;
    const b = {
      id: ++this.bombSeq, owner: p.id, tx: t.x, ty: t.y, x: t.x + 0.5, y: t.y + 0.5, h: 0,
      fuse: RULES.fuse, range: RULES.ghostRange, pierce: false, remote: false,
      triggered: false, state: 'fly', dir, progress: 0, centerDone: true, conv: false, born: this.time,
      fly: { sx: t.x, sy: t.y, dist: RULES.ghostThrow, t: 0, dur: RULES.flyTime },
    };
    this.bombs.push(b);
    p.bombsOut++;
    this.emit('punch', { x: b.x, y: b.y });
    return true;
  }

  // ---------- bombs ----------
  kickBomb(b, dir) {
    if (this.startSlide(b, dir, RULES.kickSpeed, false)) this.emit('kick', { x: b.x, y: b.y });
  }

  startSlide(b, dir, speed, conv) {
    const d = DIRS[dir];
    if (this.blocksBomb(b.tx + d.x, b.ty + d.y)) return false;
    b.state = 'slide'; b.dir = dir; b.speed = speed; b.conv = conv; b.progress = 0; b.centerDone = true;
    return true;
  }

  punchBomb(b, dir) {
    b.state = 'fly'; b.dir = dir;
    b.fly = { sx: b.tx, sy: b.ty, dist: RULES.punchDist, t: 0, dur: RULES.flyTime };
    this.emit('punch', { x: b.x, y: b.y });
  }

  updateBombs(dt) {
    for (const b of this.bombs.slice()) {
      if (b.state === 'fly') {
        if (!b.remote || b.triggered) b.fuse -= dt;
        this.updateFly(b, dt);
        continue;
      }
      if (!b.remote || b.triggered) b.fuse -= dt;
      if (b.state === 'slide') this.updateSlide(b, dt);
      else {
        const sp = this.special[b.ty][b.tx];
        if (sp && sp.type === 'conveyor') this.startSlide(b, sp.dir, RULES.conveyorSpeed, true);
      }
    }
    // A bomb that slides, lands or sits in live flames is set off too
    for (const b of this.bombs) {
      if (b.state !== 'fly' && this.flames[b.ty][b.tx] && b.fuse > 0.06) { b.triggered = true; b.fuse = 0.06; }
    }
    let guard = 0, found = true;
    while (found && guard++ < 200) {
      found = false;
      for (const b of this.bombs) {
        if (b.state !== 'fly' && b.fuse <= 0) { this.explode(b); found = true; break; }
      }
    }
  }

  updateSlide(b, dt) {
    b.progress += b.speed * dt;
    let guard = 0;
    while (guard++ < 6) {
      if (!b.centerDone && b.progress >= 0) {
        b.centerDone = true;
        if (this.bombArrive(b)) { b.progress = 0; break; }
      }
      if (b.progress >= 0.5) {
        const d = DIRS[b.dir];
        b.tx += d.x; b.ty += d.y; b.progress -= 1; b.centerDone = false;
        continue;
      }
      break;
    }
    const d = DIRS[b.dir];
    b.x = b.tx + 0.5 + d.x * (b.state === 'slide' ? b.progress : 0);
    b.y = b.ty + 0.5 + d.y * (b.state === 'slide' ? b.progress : 0);
  }

  // Called when a sliding bomb reaches the center of a tile. Returns true if it stopped.
  bombArrive(b) {
    let sp = this.special[b.ty][b.tx];
    if (sp && sp.type === 'warp' && !b.justWarped) {
      const t = sp.to;
      if (!this.bombAt(t.x, t.y) && !this.playerOnTile(t.x, t.y)) {
        this.emit('warp', { x: b.tx + 0.5, y: b.ty + 0.5 });
        b.tx = t.x; b.ty = t.y; b.justWarped = true;
        this.emit('warp', { x: b.tx + 0.5, y: b.ty + 0.5 });
        sp = this.special[b.ty][b.tx];
      }
    } else {
      b.justWarped = false;
    }
    if (sp && sp.type === 'conveyor') {
      if (b.conv) b.dir = sp.dir;
    } else if (b.conv) {
      b.state = 'idle';
      return true;
    }
    const d = DIRS[b.dir];
    if (this.blocksBomb(b.tx + d.x, b.ty + d.y)) { b.state = 'idle'; return true; }
    return false;
  }

  updateFly(b, dt) {
    const f = b.fly;
    f.t += dt;
    const k = Math.min(1, f.t / f.dur);
    const d = DIRS[b.dir];
    const ux = f.sx + 0.5 + d.x * f.dist * k, uy = f.sy + 0.5 + d.y * f.dist * k;
    const fromWall = f.sx === 0 || f.sy === 0 || f.sx === COLS - 1 || f.sy === ROWS - 1;
    b.x = fromWall && ux >= 0 && ux <= COLS ? ux : wrapPos(ux, 1, COLS - 1);
    b.y = fromWall && uy >= 0 && uy <= ROWS ? uy : wrapPos(uy, 1, ROWS - 1);
    b.h = Math.sin(Math.PI * k) * (f.dist > 1 ? 1.3 : 0.5);
    if (k < 1) return;
    const tx = wrapTile(f.sx + d.x * f.dist, 1, COLS - 2);
    const ty = wrapTile(f.sy + d.y * f.dist, 1, ROWS - 2);
    b.tx = tx; b.ty = ty; b.x = tx + 0.5; b.y = ty + 0.5; b.h = 0;
    const victim = this.playerOnTile(tx, ty);
    const blocked = this.grid[ty][tx] !== EMPTY || this.bombAt(tx, ty) || victim;
    if (blocked && b.fuse <= 0 && this.grid[ty][tx] !== HARD) {
      // Fuse ran out while bouncing: blow up right here (on the brick / bomb / player)
      b.state = 'idle';
      if (this.grid[ty][tx] === SOFT) this.burnSoft(tx, ty);
      return;
    }
    if (blocked && b.fuse < -4) {
      // Only stone left to land on: fizzle out
      this.bombs.splice(this.bombs.indexOf(b), 1);
      const o = this.players[b.owner]; if (o) o.bombsOut = Math.max(0, o.bombsOut - 1);
      this.emit('itemBurn', { x: b.x, y: b.y });
      return;
    }
    if (blocked) {
      if (victim && victim.stun <= 0) { victim.stun = RULES.stunTime; this.emit('bonk', { x: victim.x, y: victim.y }); }
      b.fly = { sx: tx, sy: ty, dist: 1, t: 0, dur: RULES.bounceTime };
      this.emit('bounce', { x: b.x, y: b.y });
    } else {
      b.state = 'idle';
      this.emit('land', { x: b.x, y: b.y });
    }
  }

  explode(b) {
    const idx = this.bombs.indexOf(b);
    if (idx < 0) return;
    this.bombs.splice(idx, 1);
    const owner = this.players[b.owner];
    if (owner) owner.bombsOut = Math.max(0, owner.bombsOut - 1);
    const cx = b.tx, cy = b.ty;
    this.addFlame(cx, cy).center = true;
    const tiles = [[cx, cy]];
    for (const dn of DIR_NAMES) {
      const d = DIRS[dn];
      let px = cx, py = cy;
      for (let i = 1; i <= b.range; i++) {
        const x = cx + d.x * i, y = cy + d.y * i;
        if (!inBounds(x, y) || this.grid[y][x] === HARD) break;
        if (this.grid[y][x] === SOFT) {
          this.burnSoft(x, y);
          if (!b.pierce) break;
          this.linkFlame(px, py, x, y, dn); px = x; py = y; tiles.push([x, y]);
          continue;
        }
        this.linkFlame(px, py, x, y, dn); px = x; py = y; tiles.push([x, y]);
        const ob = this.bombAt(x, y);
        if (ob) { ob.triggered = true; ob.fuse = Math.min(ob.fuse, 0.06); break; }
        if (this.pickups[y][x]) { this.destroyPickup(x, y); break; }
      }
    }
    this.emit('explode', { x: cx + 0.5, y: cy + 0.5, range: b.range, tiles });
  }

  addFlame(x, y) {
    let f = this.flames[y][x];
    if (!f) { f = { t: 0, arms: { up: false, down: false, left: false, right: false }, center: false }; this.flames[y][x] = f; }
    f.t = RULES.flameTime;
    return f;
  }
  linkFlame(px, py, x, y, dn) {
    const prev = this.flames[py][px] || this.addFlame(px, py);
    prev.arms[dn] = true;
    const f = this.addFlame(x, y);
    f.arms[OPPOSITE[dn]] = true;
  }
  updateFlames(dt) {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const f = this.flames[y][x];
        if (f) { f.t -= dt; if (f.t <= 0) this.flames[y][x] = null; }
      }
    }
  }

  burnSoft(x, y) {
    if (this.burnMap[y][x]) return;
    this.burnMap[y][x] = true;
    this.burning.push({ x, y, t: RULES.burnTime });
    this.emit('softBreak', { x: x + 0.5, y: y + 0.5 });
  }
  updateBurning(dt) {
    for (let i = this.burning.length - 1; i >= 0; i--) {
      const b = this.burning[i];
      b.t -= dt;
      if (b.t <= 0) {
        this.burning.splice(i, 1);
        this.burnMap[b.y][b.x] = false;
        if (this.grid[b.y][b.x] === SOFT) {
          this.grid[b.y][b.x] = EMPTY;
          const item = this.hidden[b.y][b.x];
          if (item) { this.pickups[b.y][b.x] = { type: item, age: 0 }; this.hidden[b.y][b.x] = null; }
        }
      }
    }
  }
  burnProgress(x, y) {
    for (const b of this.burning) if (b.x === x && b.y === y) return 1 - b.t / RULES.burnTime;
    return 0;
  }

  updatePickups(dt) {
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) { const pk = this.pickups[y][x]; if (pk) pk.age += dt; }
  }
  destroyPickup(x, y) {
    this.pickups[y][x] = null;
    this.emit('itemBurn', { x: x + 0.5, y: y + 0.5 });
  }

  // ---------- hazards / pickups ----------
  checkHazards() {
    for (const p of this.players) {
      if (!p.alive) continue;
      if (p.jump && p.h > 0.3) continue; // airborne Hopper jump clears flames
      const tx = Math.floor(p.x), ty = Math.floor(p.y);
      if (this.flames[ty][tx]) this.hit(p);
    }
  }
  hit(p) {
    if (p.invuln > 0) return;
    if (p.mount) {
      this.emit('mountLost', { x: p.x, y: p.y, color: p.mount.color });
      p.mount = null; p.dash = null;
      p.invuln = RULES.invulnTime;
      return;
    }
    this.kill(p);
  }
  kill(p) {
    if (!p.alive) return;
    p.alive = false; p.deadT = 0; p.disease = null; p.mount = null;
    p.jump = null; p.dash = null; p.h = 0; p.ghost = null;
    this.emit('die', { x: p.x, y: p.y, player: p.id });
    for (const b of this.bombs) if (b.owner === p.id && b.remote) b.remote = false;
    this.scatterItems(p);
  }
  scatterItems(p) {
    const items = p.collected.slice();
    if (!items.length) return;
    const free = [];
    for (let y = 1; y < ROWS - 1; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        if (this.grid[y][x] === EMPTY && !this.pickups[y][x] && !this.bombAt(x, y) && !this.flames[y][x] &&
            !this.playerOnTile(x, y) && !(this.special[y][x] && this.special[y][x].type === 'warp')) free.push({ x, y });
      }
    }
    shuffle(free);
    for (let i = 0; i < items.length && i < free.length; i++) {
      this.pickups[free[i].y][free[i].x] = { type: items[i], age: -0.4 - i * 0.05 };
    }
  }
  checkPickups() {
    for (const p of this.players) {
      if (!p.alive || p.jump) continue;
      const tx = Math.floor(p.x), ty = Math.floor(p.y);
      const pk = this.pickups[ty][tx];
      if (pk && pk.age >= 0) { this.pickups[ty][tx] = null; this.collect(p, pk.type, tx, ty); }
    }
  }
  collect(p, type, tx, ty) {
    const s = p.stats;
    switch (type) {
      case 'bomb': s.bombs = Math.min(RULES.maxBombs, s.bombs + 1); break;
      case 'fire': s.fire = Math.min(RULES.maxFire, s.fire + 1); break;
      case 'speed': s.speed = Math.min(RULES.maxSpeedUps, s.speed + 1); break;
      case 'kick': s.kick = true; break;
      case 'punch': s.punch = true; break;
      case 'remote': s.remote = true; s.pierce = false; break;
      case 'pierce': s.pierce = true; s.remote = false; break;
      case 'line': s.line = true; break;
      case 'gold': s.gold = true; break;
      case 'skull': this.infect(p, pick(DISEASE_TYPES.filter(d => !p.disease || d !== p.disease.type))); break;
      case 'egg': {
        // A new egg swaps your Hopper for a fresh random one
        const mt = pick(MOUNTS.filter(m => !p.mount || m.type !== p.mount.type));
        p.mount = { type: mt.type, color: mt.color, cd: 0 };
        break;
      }
    }
    if (type !== 'skull' && type !== 'egg') p.collected.push(type);
    this.emit('pickup', { x: tx + 0.5, y: ty + 0.5, item: type, player: p.id, mount: type === 'egg' ? p.mount.type : null });
  }
  infect(p, type) {
    p.disease = { type, t: RULES.diseaseTime };
    p.diarrheaT = 0;
    this.emit('skull', { x: p.x, y: p.y, disease: type, player: p.id });
  }
  spreadDisease() {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], b = ps[j];
        if (!a.alive || !b.alive || (!a.disease) === (!b.disease)) continue;
        if (Math.abs(a.x - b.x) < 0.75 && Math.abs(a.y - b.y) < 0.75) {
          const src = a.disease ? a : b, dst = a.disease ? b : a;
          this.infect(dst, src.disease.type);
          dst.disease.t = Math.max(4, src.disease.t);
        }
      }
    }
  }

  // ---------- sudden death ----------
  updateSudden(dt) {
    this.sdTimer -= dt;
    while (this.sdTimer <= 0 && this.sdIndex < this.spiral.length) {
      const c = this.spiral[this.sdIndex++];
      if (this.grid[c.y][c.x] === HARD) continue;
      this.falling.push({ x: c.x, y: c.y, t: 0, dur: 0.4 });
      this.sdTimer += RULES.suddenDeathInterval;
    }
  }
  updateFalling(dt) {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.t += dt;
      if (f.t < f.dur) continue;
      this.falling.splice(i, 1);
      const { x, y } = f;
      this.grid[y][x] = HARD;
      this.hidden[y][x] = null; this.pickups[y][x] = null; this.flames[y][x] = null;
      if (this.burnMap[y][x]) { this.burnMap[y][x] = false; this.burning = this.burning.filter(b => b.x !== x || b.y !== y); }
      for (const b of this.bombs.slice()) {
        if (b.state !== 'fly' && b.tx === x && b.ty === y) {
          this.bombs.splice(this.bombs.indexOf(b), 1);
          const o = this.players[b.owner]; if (o) o.bombsOut = Math.max(0, o.bombsOut - 1);
        }
      }
      for (const p of this.players) {
        if (p.alive && Math.floor(p.x) === x && Math.floor(p.y) === y) { p.mount = null; p.invuln = 0; this.kill(p); }
      }
      this.emit('thud', { x: x + 0.5, y: y + 0.5 });
    }
  }

  // ---------- round end ----------
  checkRoundEnd(dt) {
    const alive = this.players.filter(p => p.alive);
    if (!this.ending && alive.length <= 1) { this.ending = true; this.endT = RULES.roundEndDelay; }
    if (this.ending) {
      this.endT -= dt;
      if (this.endT <= 0) {
        const still = this.players.filter(p => p.alive);
        this.winner = still.length === 1 ? still[0] : null;
        if (this.winner) this.winner.wins++;
        this.phase = 'over';
        this.emit('roundOver', { winner: this.winner ? this.winner.id : -1 });
      }
    }
  }
  matchWinner() {
    return this.players.find(p => p.wins >= this.cfg.winsNeeded) || null;
  }
}
