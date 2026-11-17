'use strict';

// Keyboard + Gamepad input. Call Input.update(dt) once per frame, Input.endFrame() at the end.
const Input = (() => {
  const down = new Set();
  const pressOrder = new Map();
  const justPressed = new Set();
  let counter = 0;

  const DEFAULT_SCHEMES = {
    kb1: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], bomb: ['Space'], action: ['ShiftLeft', 'KeyE'] },
    kb2: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], bomb: ['Enter', 'NumpadEnter'], action: ['ShiftRight', 'Period'] },
  };
  const ACTIONS = ['up', 'down', 'left', 'right', 'bomb', 'action'];
  const clone = o => JSON.parse(JSON.stringify(o));
  const SCHEMES = clone(DEFAULT_SCHEMES);
  const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Slash', 'Tab', 'Quote', 'Backquote']);

  // Load / save custom key bindings
  try {
    const saved = JSON.parse(localStorage.getItem('blastArena.keys') || 'null');
    if (saved) for (const id of Object.keys(SCHEMES)) for (const a of ACTIONS) {
      if (saved[id] && Array.isArray(saved[id][a]) && saved[id][a].length) SCHEMES[id][a] = saved[id][a].slice();
    }
  } catch (e) { /* ignore */ }
  function saveBindings() { try { localStorage.setItem('blastArena.keys', JSON.stringify(SCHEMES)); } catch (e) { /* ignore */ } }

  // Assign `code` to scheme/action. If the key was used elsewhere, the two bindings swap.
  function bind(id, action, code) {
    const old = SCHEMES[id][action].slice();
    for (const sid of Object.keys(SCHEMES)) for (const a of ACTIONS) {
      if (sid === id && a === action) continue;
      const list = SCHEMES[sid][a];
      const i = list.indexOf(code);
      if (i >= 0) {
        list.splice(i, 1);
        if (!list.length && old[0] && old[0] !== code) list.push(old[0]); // swap keys
      }
    }
    SCHEMES[id][action] = [code];
    saveBindings();
  }
  function resetBindings() {
    const d = clone(DEFAULT_SCHEMES);
    for (const id of Object.keys(SCHEMES)) SCHEMES[id] = d[id];
    saveBindings();
  }

  function keyName(code) {
    const special = {
      ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', Enter: 'Enter', NumpadEnter: 'Num Enter',
      ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt',
      MetaLeft: 'L-Cmd', MetaRight: 'R-Cmd', Period: '.', Comma: ',', Slash: '/', Semicolon: ';', Quote: '\'', BracketLeft: '[',
      BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', Tab: 'Tab', CapsLock: 'Caps', Backspace: 'Bksp',
      NumpadDecimal: 'Num .', NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /',
      IntlBackslash: '<',
    };
    if (special[code]) return special[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
    return code;
  }

  window.addEventListener('keydown', e => {
    if (!e.metaKey && !e.ctrlKey && (PREVENT.has(e.code) || Object.values(SCHEMES).some(s => ACTIONS.some(a => s[a].includes(e.code))))) e.preventDefault();
    if (e.repeat) return;
    down.add(e.code);
    pressOrder.set(e.code, ++counter);
    justPressed.add(e.code);
  });
  window.addEventListener('keyup', e => { down.delete(e.code); });
  window.addEventListener('blur', () => down.clear());

  // ---------- gamepads ----------
  let pads = [];
  const padState = {}; // index -> { b:[], d:{}, just:Set, order:{}, ax, ay }
  let connectedListeners = [];
  window.addEventListener('gamepadconnected', e => connectedListeners.forEach(f => f(e.gamepad)));

  function pollPads() {
    let list = [];
    try { list = navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) { list = []; }
    pads = [];
    for (const gp of list) if (gp && gp.connected) pads.push(gp);
    pads.sort((a, b) => a.index - b.index);
    for (const gp of pads) {
      const st = padState[gp.index] || (padState[gp.index] = { b: [], d: {}, just: new Set(), order: {}, ax: 0, ay: 0 });
      const just = new Set();
      const b = gp.buttons.map(x => !!(x && (x.pressed || x.value > 0.5)));
      b.forEach((v, i) => { if (v && !st.b[i]) just.add(i); });
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      const dz = 0.45;
      const d = {
        up: !!b[12] || ay < -dz, down: !!b[13] || ay > dz,
        left: !!b[14] || ax < -dz, right: !!b[15] || ax > dz,
      };
      for (const k of DIR_NAMES) if (d[k] && !st.d[k]) { st.order[k] = ++counter; just.add(k); }
      st.b = b; st.d = d; st.just = just; st.ax = ax; st.ay = ay;
    }
  }

  function latest(codes) { let m = 0; for (const c of codes) if (down.has(c)) m = Math.max(m, pressOrder.get(c) || 0); return m; }
  function perpendicular(a, b) { return !!a && !!b && (DIRS[a].x === 0) !== (DIRS[b].x === 0); }

  function control(id) {
    const out = { dir: null, dir2: null, bomb: false, action: false };
    if (!id) return out;
    if (SCHEMES[id]) {
      const s = SCHEMES[id];
      const held = DIR_NAMES.filter(k => s[k].some(c => down.has(c) || justPressed.has(c)));
      held.sort((a, b) => latest(s[b]) - latest(s[a]));
      out.dir = held[0] || null;
      out.dir2 = held.find(h => perpendicular(h, out.dir)) || null;
      out.bomb = s.bomb.some(c => justPressed.has(c));
      out.action = s.action.some(c => justPressed.has(c));
      return out;
    }
    if (id.startsWith('pad')) {
      const gp = pads[+id.slice(3)];
      if (!gp) return out;
      const st = padState[gp.index];
      const dz = 0.45;
      const stickActive = Math.max(Math.abs(st.ax), Math.abs(st.ay)) > dz;
      const dpad = { up: !!st.b[12], down: !!st.b[13], left: !!st.b[14], right: !!st.b[15] };
      if (stickActive && !(dpad.up || dpad.down || dpad.left || dpad.right)) {
        const h = st.ax < 0 ? 'left' : 'right', v = st.ay < 0 ? 'up' : 'down';
        const hOn = Math.abs(st.ax) > dz, vOn = Math.abs(st.ay) > dz;
        if (Math.abs(st.ax) >= Math.abs(st.ay)) { out.dir = h; out.dir2 = vOn ? v : null; }
        else { out.dir = v; out.dir2 = hOn ? h : null; }
      } else {
        const held = DIR_NAMES.filter(k => dpad[k]);
        held.sort((a, b) => (st.order[b] || 0) - (st.order[a] || 0));
        out.dir = held[0] || null;
        out.dir2 = held.find(h => perpendicular(h, out.dir)) || null;
      }
      // A / Y = bomb, B / X / shoulders = action
      out.bomb = st.just.has(0) || st.just.has(3);
      out.action = st.just.has(1) || st.just.has(2) || st.just.has(4) || st.just.has(5);
      return out;
    }
    return out;
  }

  // ---------- menu navigation (any device) ----------
  const hold = { up: 0, down: 0, left: 0, right: 0 };
  let menuState = null;

  function computeMenu(dt) {
    const m = { up: false, down: false, left: false, right: false, confirm: false, back: false, pause: false, any: false };
    const keyDir = {
      up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
    };
    for (const k of DIR_NAMES) {
      let held = keyDir[k].some(c => down.has(c));
      let pressed = keyDir[k].some(c => justPressed.has(c));
      for (const gp of pads) {
        const st = padState[gp.index];
        if (st.d[k]) held = true;
        if (st.just.has(k)) pressed = true;
      }
      if (pressed) { m[k] = true; hold[k] = 0; }
      else if (held) {
        hold[k] += dt;
        if (hold[k] > 0.4) { m[k] = true; hold[k] -= 0.12; }
      } else hold[k] = 0;
    }
    if (['Enter', 'Space', 'NumpadEnter'].some(c => justPressed.has(c))) m.confirm = true;
    if (['Escape', 'Backspace'].some(c => justPressed.has(c))) m.back = true;
    if (['Escape', 'KeyP'].some(c => justPressed.has(c))) m.pause = true;
    for (const gp of pads) {
      const st = padState[gp.index];
      if (st.just.has(0)) m.confirm = true;
      if (st.just.has(1)) m.back = true;
      if (st.just.has(9)) { m.pause = true; m.confirm = true; }
      if (st.just.size) m.any = true;
    }
    if (justPressed.size) m.any = true;
    return m;
  }

  return {
    update(dt) { pollPads(); menuState = computeMenu(dt); },
    endFrame() { justPressed.clear(); },
    control,
    menu() { return menuState; },
    pads() { return pads.map(p => ({ index: p.index, id: p.id })); },
    onPadConnected(f) { connectedListeners.push(f); },
    SCHEMES, ACTIONS, bind, resetBindings, keyName,
    isGameKey(code) { return Object.values(SCHEMES).some(s => ACTIONS.some(a => s[a].includes(code))); },
  };
})();
