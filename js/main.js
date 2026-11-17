'use strict';

(() => {
  // ---------------------------------------------------------------- settings
  const SLOT_OPTIONS = [
    ['kb1', 'Keyboard · WASD'],
    ['kb2', 'Keyboard · Arrows'],
    ['pad0', 'Gamepad 1'], ['pad1', 'Gamepad 2'], ['pad2', 'Gamepad 3'], ['pad3', 'Gamepad 4'],
    ['cpu-easy', 'CPU · Easy'], ['cpu-normal', 'CPU · Normal'], ['cpu-hard', 'CPU · Hard'],
    ['off', '— Off —'],
  ];
  const RULE_OPTIONS = [
    { key: 'arena', label: 'Arena', values: [['cycle', 'All, in turn'], ['random', 'Random'], ...ARENAS.map(a => [a.id, a.name])] },
    { key: 'wins', label: 'Wins to take the match', values: [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [7, '7']] },
    { key: 'roundTime', label: 'Time before sudden death', values: [[60, '1:00'], [90, '1:30'], [120, '2:00'], [150, '2:30'], [180, '3:00'], [240, '4:00']] },
    { key: 'density', label: 'Power-ups', values: [['low', 'Few'], ['normal', 'Normal'], ['high', 'Lots']] },
    { key: 'diseases', label: 'Skulls (curses)', values: [[true, 'On'], [false, 'Off']] },
    { key: 'revenge', label: 'Sideline revenge', values: [[true, 'On'], [false, 'Off']] },
    { key: 'duelZoom', label: 'Final duel zoom', values: [[false, 'Off'], [true, 'On']] },
    { key: 'music', label: 'Music', values: [[true, 'On'], [false, 'Off']] },
  ];
  const DEFAULTS = {
    slots: ['kb1', 'pad0', 'cpu-normal', 'cpu-normal'],
    chars: ['robo', 'kitty', 'viking', 'ninja'],
    arena: 'cycle', wins: 3, roundTime: 150, density: 'normal', diseases: true, revenge: true, duelZoom: false, music: true,
  };
  let settings = loadSettings();

  function loadSettings() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem('blastArena.settings') || 'null'); } catch (e) { s = null; }
    const out = Object.assign({}, DEFAULTS, s || {});
    if (!Array.isArray(out.slots) || out.slots.length !== 4) out.slots = DEFAULTS.slots.slice();
    if (!Array.isArray(out.chars) || out.chars.length !== 4) out.chars = DEFAULTS.chars.slice();
    return out;
  }
  function saveSettings() {
    try { localStorage.setItem('blastArena.settings', JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- state
  const $ = id => document.getElementById(id);
  let screen = 'title';     // which DOM screen is visible (null = none)
  let mode = 'menu';        // 'menu' | 'playing' | 'paused' | 'roundOver' | 'matchOver'
  let game = null, demo = null, demoRestartT = 0;
  let overT = 0, roundOverlayT = 0;
  let focusIdx = 0;
  const pending = []; // buffered edge inputs per player
  const STEP = 1 / 120;
  let acc = 0;

  // ---------------------------------------------------------------- screens & nav
  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    screen = id; focusIdx = 0;
    refreshFocus();
  }
  function navItems() {
    if (!screen) return [];
    return [...$(screen).querySelectorAll('[data-nav]')];
  }
  function refreshFocus() {
    const items = navItems();
    if (focusIdx >= items.length) focusIdx = 0;
    items.forEach((el, i) => el.classList.toggle('focus', i === focusIdx));
  }
  function moveFocus(d) {
    const items = navItems();
    if (!items.length) return;
    focusIdx = (focusIdx + d + items.length) % items.length;
    refreshFocus();
    Sound.play('tick');
    lineupHop(false);
  }

  // ---------------------------------------------------------------- key binding screen
  const ACTION_LABELS = { up: 'Move up', down: 'Move down', left: 'Move left', right: 'Move right', bomb: 'Drop bomb', action: 'Action (punch / Llama)' };
  let capturing = null;      // { id, action, el } while waiting for a key press
  let keysReturn = 'title';  // screen to go back to

  function schemeSummary(id) {
    const s = Input.SCHEMES[id], k = a => Input.keyName(s[a][0]);
    const arrows = ['up', 'left', 'down', 'right'].map(k);
    const compact = arrows.every(x => x.length === 1);
    return compact ? arrows.join('') : arrows.join(' ');
  }

  function renderKeys() {
    for (const id of ['kb1', 'kb2']) {
      const panel = $(id + '-panel');
      const s = Input.SCHEMES[id];
      let html = `<h2>Keyboard ${id === 'kb1' ? 1 : 2}</h2>`;
      for (const a of Input.ACTIONS) {
        const waiting = capturing && capturing.id === id && capturing.action === a;
        html += `<div class="opt bind${waiting ? ' waiting' : ''}" data-nav data-bind="${id}:${a}">
          <div class="lbl">${ACTION_LABELS[a]}</div>
          <span class="val">${waiting ? 'Press a key…' : s[a].map(c => `<kbd>${Input.keyName(c)}</kbd>`).join(' ')}</span></div>`;
      }
      panel.innerHTML = html;
    }
    document.querySelectorAll('#keys .bind').forEach(row => {
      row.onclick = () => startCapture(row.dataset.bind);
      row.onmouseenter = () => { if (capturing) return; const items = navItems(); focusIdx = items.indexOf(row); refreshFocus(); };
    });
    refreshFocus();
  }

  function startCapture(bindKey) {
    const [id, action] = bindKey.split(':');
    capturing = { id, action };
    $('keys-msg').textContent = `Press the new key for Keyboard ${id === 'kb1' ? 1 : 2}: ${ACTION_LABELS[action]}  (Esc to cancel)`;
    Sound.play('select');
    renderKeys();
  }

  window.addEventListener('keydown', e => {
    if (!capturing) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.code === 'Escape') {
      $('keys-msg').textContent = 'Cancelled.';
    } else {
      Input.bind(capturing.id, capturing.action, e.code);
      $('keys-msg').textContent = `${ACTION_LABELS[capturing.action]} is now ${Input.keyName(e.code)}.`;
      Sound.play('pickup');
    }
    capturing = null;
    renderKeys();
  }, true);

  function handleMenu(m) {
    if (!screen || !m || capturing) return;
    if (screen === 'round') {
      if ((m.confirm || roundOverlayT > 7) && roundOverlayT > 0.35) continueAfterRound();
      return;
    }
    const items = navItems();
    if (m.up) moveFocus(-1);
    if (m.down) moveFocus(1);
    const el = items[focusIdx];
    if (!el) return;
    if (m.left || m.right) {
      if (el.dataset.opt) changeOpt(el.dataset.opt, m.left ? -1 : 1);
      else moveFocus(m.left ? -1 : 1);
    }
    if (m.confirm) {
      if (el.dataset.opt) changeOpt(el.dataset.opt, 1);
      else if (el.dataset.bind) startCapture(el.dataset.bind);
      else activate(el.dataset.act);
    }
    if (m.back) {
      if (screen === 'keys') activate('keys-back');
      else if (screen === 'setup' || screen === 'help') activate('title');
      else if (screen === 'pause') activate('resume');
    }
  }

  function activate(act) {
    Sound.play('select');
    switch (act) {
      case 'setup': mode = 'menu'; ensureDemo(); renderSetup(); show('setup'); break;
      case 'help': renderHelp(); show('help'); break;
      case 'title': mode = 'menu'; ensureDemo(); show('title'); break;
      case 'start': startMatch(); break;
      case 'resume': mode = 'playing'; show(null); break;
      case 'restart': startMatch(); break;
      case 'quit': mode = 'menu'; game = null; ensureDemo(); renderSetup(); show('setup'); break;
      case 'rematch': startMatch(); break;
      case 'keys': keysReturn = screen || 'title'; $('keys-msg').textContent = 'Select an action, then press the new key.'; show('keys'); renderKeys(); break;
      case 'keys-reset': Input.resetBindings(); $('keys-msg').textContent = 'Default keys restored.'; renderKeys(); break;
      case 'keys-back':
        if (keysReturn === 'setup') { renderSetup(); show('setup'); }
        else if (keysReturn === 'pause') show('pause');
        else show('title');
        break;
    }
  }

  // ---------------------------------------------------------------- setup screen
  function slotLabel(id) {
    const o = SLOT_OPTIONS.find(s => s[0] === id);
    let label = o ? o[1] : id;
    if (id === 'kb1' || id === 'kb2') label = `Keyboard ${id === 'kb1' ? 1 : 2} · ${schemeSummary(id)}`;
    if (id.startsWith('pad')) {
      const pads = Input.pads();
      const n = +id.slice(3);
      label += pads[n] ? ' ✔' : ' (press a button)';
    }
    return label;
  }

  function renderSetup() {
    const slots = $('slots');
    slots.innerHTML = '';
    settings.slots.forEach((s, i) => {
      const st = PLAYER_STYLES[i];
      const ch = CHARACTERS.find(c => c.id === settings.chars[i]) || CHARACTERS[0];
      const card = document.createElement('div');
      card.className = 'slot-card' + (s === 'off' ? ' off' : '');
      card.style.setProperty('--pc', st.main);
      const icon = Renderer.bomberCanvas(st, 64, ch.id);
      icon.className = 'slot-icon';
      card.appendChild(icon);
      const rows = document.createElement('div');
      rows.className = 'slot-rows';
      rows.innerHTML =
        `<div class="opt" data-nav data-opt="slot${i}"><div class="lbl"><b>P${i + 1}</b> controls</div>
           <button class="arr" data-dir="-1">◀</button><span class="val">${slotLabel(s)}</span><button class="arr" data-dir="1">▶</button></div>
         <div class="opt" data-nav data-opt="char${i}"><div class="lbl">character <span class="pname">${ch.desc}</span></div>
           <button class="arr" data-dir="-1">◀</button><span class="val">${ch.name}</span><button class="arr" data-dir="1">▶</button></div>`;
      card.appendChild(rows);
      slots.appendChild(card);
    });
    const rules = $('rules');
    rules.innerHTML = '';
    for (const r of RULE_OPTIONS) {
      const v = r.values.find(x => x[0] === settings[r.key]) || r.values[0];
      const row = document.createElement('div');
      row.className = 'opt'; row.dataset.nav = ''; row.dataset.opt = r.key;
      row.innerHTML = `<div class="lbl">${r.label}</div><button class="arr" data-dir="-1">◀</button><span class="val">${v[1]}</span><button class="arr" data-dir="1">▶</button>`;
      rules.appendChild(row);
    }
    // arena description
    const a = ARENAS.find(x => x.id === settings.arena);
    $('arena-desc').textContent = a ? a.desc : settings.arena === 'random' ? 'A random arena every round.' : 'Every round takes place in the next arena.';
    validateSetup();
    refreshFocus();
    bindOptRows();
  }

  function bindOptRows() {
    document.querySelectorAll('#setup .opt').forEach(row => {
      row.onmouseenter = () => { const items = navItems(); focusIdx = items.indexOf(row); refreshFocus(); };
      row.querySelectorAll('.arr').forEach(btn => {
        btn.onclick = ev => { ev.stopPropagation(); changeOpt(row.dataset.opt, +btn.dataset.dir); };
      });
      row.onclick = () => changeOpt(row.dataset.opt, 1);
    });
  }

  function changeOpt(key, d) {
    Sound.play('tick');
    if (key.startsWith('char')) {
      const i = +key.slice(4);
      const cur = CHARACTERS.findIndex(c => c.id === settings.chars[i]);
      settings.chars[i] = CHARACTERS[(cur + d + CHARACTERS.length) % CHARACTERS.length].id;
    } else if (key.startsWith('slot')) {
      const i = +key.slice(4);
      const ids = SLOT_OPTIONS.map(s => s[0]);
      const cur = ids.indexOf(settings.slots[i]);
      settings.slots[i] = ids[(cur + d + ids.length) % ids.length];
    } else {
      const r = RULE_OPTIONS.find(x => x.key === key);
      const cur = r.values.findIndex(x => x[0] === settings[key]);
      settings[key] = r.values[(cur + d + r.values.length) % r.values.length][0];
      if (key === 'music') Sound.setMusic(settings.music);
      if (key === 'duelZoom') Renderer.setOptions({ duelZoom: settings.duelZoom });
    }
    saveSettings();
    const keepFocus = focusIdx;
    renderSetup();
    focusIdx = keepFocus; refreshFocus();
  }

  function validateSetup() {
    const msg = [];
    const active = settings.slots.filter(s => s !== 'off');
    if (active.length < 2) msg.push('You need at least 2 players.');
    const humans = settings.slots.filter(s => s !== 'off' && !s.startsWith('cpu'));
    const dup = humans.filter((s, i) => humans.indexOf(s) !== i);
    if (dup.length) msg.push('Two players can\'t share the same controls (' + slotLabel(dup[0]).replace(/ ✔| \(press a button\)/, '') + ').');
    const pads = Input.pads();
    const missing = humans.filter(s => s.startsWith('pad') && !pads[+s.slice(3)]);
    if (missing.length) msg.push('Controller not detected yet: press any button on it.');
    $('setup-msg').textContent = msg.join(' ');
    if (active.length < 2 || dup.length) return 'error';
    return missing.length ? 'warn' : 'ok';
  }

  // ---------------------------------------------------------------- help screen
  function renderHelp() {
    for (const id of ['kb1', 'kb2']) {
      const s = Input.SCHEMES[id], k = a => s[a].map(c => `<kbd>${Input.keyName(c)}</kbd>`).join(' / ');
      $('help-' + id).innerHTML = `<td>Keyboard ${id === 'kb1' ? 1 : 2}</td><td>${['up', 'left', 'down', 'right'].map(a => `<kbd>${Input.keyName(s[a][0])}</kbd>`).join('')}</td><td>${k('bomb')}</td><td>${k('action')}</td>`;
    }
    const list = $('item-list');
    if (list.childElementCount) return;
    for (const [type, info] of Object.entries(ITEM_INFO)) {
      const div = document.createElement('div');
      div.className = 'item';
      div.appendChild(Renderer.itemCanvas(type, 40));
      div.insertAdjacentHTML('beforeend', `<div><b>${info.label}</b><span>${info.desc}</span></div>`);
      list.appendChild(div);
    }
    const hop = $('hopper-list');
    for (const m of MOUNTS) {
      hop.insertAdjacentHTML('beforeend', `<div class="item"><i class="dot" style="background:${m.color}"></i><div><b>${m.label}</b><span>${m.desc}</span></div></div>`);
    }
  }

  // ---------------------------------------------------------------- matches
  function buildPlayers(slots, chars) {
    const players = [];
    slots.forEach((s, i) => {
      if (s === 'off') return;
      const bot = s.startsWith('cpu') ? s.slice(4) : null;
      const ch = CHARACTERS.find(c => c.id === (chars || settings.chars)[i]) || CHARACTERS[i % CHARACTERS.length];
      players.push({ name: ch.name, char: ch.id, tag: bot ? 'CPU' + (i + 1) : 'P' + (i + 1), style: PLAYER_STYLES[i], control: bot ? null : s, bot });
    });
    return players;
  }

  function pickArena(round) {
    if (settings.arena === 'random') return ARENAS[(Math.random() * ARENAS.length) | 0];
    if (settings.arena === 'cycle') return ARENAS[(round - 1) % ARENAS.length];
    return ARENAS.find(a => a.id === settings.arena) || ARENAS[0];
  }

  function startMatch() {
    const v = validateSetup();
    if (v === 'error') { show('setup'); renderSetup(); Sound.play('bonk'); return; }
    Sound.init();
    game = new Game({
      players: buildPlayers(settings.slots), winsNeeded: settings.wins, roundTime: settings.roundTime,
      density: settings.density, diseases: settings.diseases, revenge: settings.revenge,
    });
    AI.setup(game);
    demo = null;
    nextRound();
  }

  function nextRound() {
    game.startRound(pickArena(game.round + 1));
    pending.length = 0;
    acc = 0;
    mode = 'playing'; overT = 0;
    Sound.setTempo(132);
    show(null);
  }

  function continueAfterRound() {
    const champ = game.matchWinner();
    if (champ) {
      mode = 'matchOver';
      $('match-title').innerHTML = `<span style="color:${champ.style.main}">${champ.name}</span> is the champion!`;
      renderScoreboard($('match-board'), champ);
      Sound.play('win');
      show('match');
    } else {
      nextRound();
    }
  }

  function renderScoreboard(el, highlight) {
    el.innerHTML = '';
    const sorted = game.players.slice().sort((a, b) => b.wins - a.wins);
    for (const p of sorted) {
      const row = document.createElement('div');
      row.className = 'score' + (highlight && highlight.id === p.id ? ' hl' : '');
      row.style.setProperty('--pc', p.style.main);
      row.appendChild(Renderer.bomberCanvas(p.style, 44, p.char));
      let stars = '';
      for (let i = 0; i < game.cfg.winsNeeded; i++) stars += `<i class="${i < p.wins ? 'on' : ''}">★</i>`;
      row.insertAdjacentHTML('beforeend', `<div class="nm">${p.name} <small>${p.tag}</small></div><div class="stars">${stars}</div>`);
      el.appendChild(row);
    }
  }

  function showRoundResult() {
    mode = 'roundOver'; roundOverlayT = 0;
    const w = game.winner;
    $('round-title').innerHTML = w ? `<span style="color:${w.style.main}">${w.name}</span> wins round ${game.round}!` : 'Draw!';
    $('round-sub').textContent = w ? '' : 'Nobody survived. No points this round.';
    renderScoreboard($('scoreboard'), w);
    show('round');
  }

  // ---------------------------------------------------------------- demo (title background)
  function ensureDemo() {
    if (demo) return;
    demo = new Game({
      players: buildPlayers(['cpu-normal', 'cpu-hard', 'cpu-normal', 'cpu-easy'], shuffle(CHARACTERS.map(c => c.id))),
      winsNeeded: 99, roundTime: 60, density: 'normal', diseases: true, revenge: true,
    });
    AI.setup(demo);
    demo.startRound(ARENAS[(Math.random() * ARENAS.length) | 0]);
    demo.phase = 'play'; demo.goTime = -10;
    demoRestartT = 0;
  }
  function runDemo(dt) {
    if (!demo) return;
    const n = subSteps(dt), step = dt / n;
    for (let i = 0; i < n; i++) {
      const inps = demo.players.map(p => AI.control(demo, p, step));
      demo.update(step, inps);
      for (const e of demo.events) Renderer.onEvent(e, demo);
      demo.events.length = 0;
    }
    if (demo.phase === 'over') {
      demoRestartT += dt;
      if (demoRestartT > 2) {
        demo.startRound(ARENAS[(Math.random() * ARENAS.length) | 0]);
        demo.phase = 'play'; demo.goTime = -10; demoRestartT = 0;
        for (const e of demo.events) Renderer.onEvent(e, demo);
        demo.events.length = 0;
      }
    }
  }

  // number of simulation sub-steps for a frame (each at most STEP long)
  function subSteps(dt) { return Math.min(12, Math.max(1, Math.ceil(dt / STEP - 1e-6))); }

  // ---------------------------------------------------------------- game loop
  const SOUND_FOR = {
    place: 'place', kick: 'kick', punch: 'punch', land: 'land', bounce: 'land', bonk: 'bonk',
    die: 'die', mountLost: 'mountLost', hurry: 'hurry', beep: 'beep', go: 'go', thud: 'thud', warp: 'warp',
    click: 'click', skull: 'skull', cured: 'cured', jump: 'jump', dash: 'dash', ghost: 'ghost',
  };

  function runGame(dt, m) {
    if (mode === 'playing' && m.pause) { mode = 'paused'; show('pause'); Sound.play('select'); return; }
    if (mode !== 'playing') return;

    // gather human input; buffer button edges until a sim step consumes them
    const human = game.players.map(p => (p.bot ? null : Input.control(p.control)));
    human.forEach((h, i) => {
      if (!h) return;
      const pd = pending[i] || (pending[i] = { bomb: false, action: false });
      pd.bomb = pd.bomb || h.bomb; pd.action = pd.action || h.action;
    });

    // Simulate exactly this frame's time in equal sub-steps: even motion every frame and
    // input takes effect in the very frame it was read (no leftover-time stutter).
    const n = subSteps(dt), step = dt / n;
    for (let s = 0; s < n; s++) {
      const inps = game.players.map((p, i) => {
        if (p.bot) return AI.control(game, p, step);
        const h = human[i], pd = pending[i];
        const out = { dir: h.dir, dir2: h.dir2, bomb: pd.bomb, action: pd.action };
        pd.bomb = false; pd.action = false;
        return out;
      });
      game.update(step, inps);
      flushEvents();
    }

    if (game.phase === 'over') {
      overT += dt;
      if (overT > 0.5) showRoundResult();
    }
  }

  function flushEvents() {
    for (const e of game.events) {
      Renderer.onEvent(e, game);
      if (e.type === 'pickup') Sound.play(e.item === 'skull' ? 'skull' : e.item === 'egg' ? 'egg' : 'pickup');
      else if (e.type === 'roundOver') Sound.play(e.winner >= 0 ? 'win' : 'draw');
      else if (e.type === 'hurry') { Sound.play('hurry'); Sound.setTempo(160); }
      else if (e.type === 'explode') Sound.play('explode', e.range);
      else if (SOUND_FOR[e.type]) Sound.play(SOUND_FOR[e.type]);
    }
    game.events.length = 0;
  }

  let last = performance.now();
  let padRefreshT = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    Input.update(dt);
    const m = Input.menu();

    if (mode === 'menu' || !game) {
      runDemo(dt);
      handleMenu(m);
      padRefreshT += dt;
      if (padRefreshT > 0.5) {
        padRefreshT = 0;
        updatePadHints();
      }
    } else {
      if (mode === 'playing') runGame(dt, m);
      else {
        if (mode === 'roundOver') roundOverlayT += dt;
        handleMenu(m);
      }
    }

    const shown = mode === 'menu' || !game ? demo : game;
    Renderer.update(dt, shown);
    Renderer.draw(shown, { podium: mode === 'matchOver' });
    Input.endFrame();
    requestAnimationFrame(frame);
  }

  let lastPadSig = '';
  function updatePadHints() {
    const pads = Input.pads();
    const sig = pads.map(p => p.id).join('|');
    if (sig === lastPadSig) return;
    lastPadSig = sig;
    const txt = pads.length
      ? '🎮 ' + pads.map((p, i) => `Gamepad ${i + 1}: ${p.id.replace(/\(.*?\)/g, '').trim().slice(0, 40)}`).join(' · ')
      : '🎮 No controller detected yet: plug it in and press any button.';
    $('pad-hint').textContent = txt;
    $('pad-list').textContent = txt;
    if (screen === 'setup') { const k = focusIdx; renderSetup(); focusIdx = k; refreshFocus(); }
  }

  // ---------------------------------------------------------------- title lineup
  function buildLineup() {
    const el = $('lineup');
    el.innerHTML = '';
    CHARACTERS.forEach((ch, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'lu';
      wrap.appendChild(Renderer.bomberCanvas(PLAYER_STYLES[i % PLAYER_STYLES.length], 76, ch.id));
      el.appendChild(wrap);
    });
  }
  function lineupHop(big) {
    if (screen !== 'title') return;
    document.querySelectorAll('#lineup .lu').forEach((w, i) => {
      w.classList.remove('hop', 'cheer');
      void w.offsetWidth; // restart the CSS animation
      w.style.setProperty('--d', (i * (big ? 0.04 : 0.06)) + 's');
      w.classList.add(big ? 'cheer' : 'hop');
    });
  }

  // ---------------------------------------------------------------- boot
  function boot() {
    Renderer.init($('game'));
    Renderer.setOptions({ duelZoom: settings.duelZoom });
    buildLineup();
    // mouse support for buttons
    document.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', () => activate(btn.dataset.act));
      btn.addEventListener('mouseenter', () => { const items = navItems(); const i = items.indexOf(btn); if (i >= 0) { focusIdx = i; refreshFocus(); } });
    });
    $('round').addEventListener('click', () => { if (roundOverlayT > 0.35) continueAfterRound(); });
    const unlock = () => { Sound.init(); Sound.setMusic(settings.music); };
    window.addEventListener('keydown', unlock);
    window.addEventListener('mousedown', unlock);
    window.addEventListener('touchstart', unlock);
    Input.onPadConnected(() => { lastPadSig = ''; updatePadHints(); });
    ensureDemo();
    show('title');
    updatePadHints();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => Renderer.resize());
    requestAnimationFrame(frame);
  }

  boot();
})();
