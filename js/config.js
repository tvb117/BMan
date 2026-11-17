'use strict';

// ---------- Grid ----------
const COLS = 15;
const ROWS = 13;
const HUD_H = 1.35; // HUD height in tiles

const EMPTY = 0, HARD = 1, SOFT = 2;

const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const DIR_NAMES = ['up', 'down', 'left', 'right'];
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

// ---------- Rules / tuning ----------
const RULES = {
  fuse: 2.8,
  shortFuse: 1.0,
  flameTime: 0.8,
  burnTime: 0.5,
  baseSpeed: 3.0,
  speedStep: 0.5,
  maxSpeedUps: 8,
  slowSpeed: 1.8,
  hyperSpeed: 8.5,
  startBombs: 1,
  startFire: 2,
  maxBombs: 10,
  maxFire: 10,
  goldFire: 20,
  kickSpeed: 8.5,
  punchDist: 3,
  flyTime: 0.55,
  bounceTime: 0.22,
  diseaseTime: 12,
  invulnTime: 1.8,
  stunTime: 1.1,
  conveyorSpeed: 1.7,
  suddenDeathInterval: 0.2,
  roundEndDelay: 1.2,
  countdown: 2.4,
  // Llama abilities
  jumpDist: 2,
  jumpTime: 0.45,
  jumpCd: 0.9,
  dashSpeed: 11,
  dashTime: 0.45,
  dashCd: 1.4,
  // Sideline revenge (dead players)
  ghostDelay: 1.5,
  ghostSpeed: 5.5,
  ghostCd: 1.3,
  ghostRange: 2,
  ghostThrow: 3,
  ghostCloseAt: 60, // seconds left on the clock when the sideline closes
};

// ---------- Players ----------
const PLAYER_STYLES = [
  { name: 'Blaze', main: '#f04a3c', dark: '#9e2016', light: '#ff9a8c' },
  { name: 'Frost', main: '#3c8cf0', dark: '#1a4a9c', light: '#9cc8ff' },
  { name: 'Lime', main: '#56c838', dark: '#2a7d15', light: '#a8f08c' },
  { name: 'Sunny', main: '#f5bd24', dark: '#a8740a', light: '#ffe68f' },
];

// Selectable characters (look only; colour comes from the player slot).
const CHARACTERS = [
  { id: 'robo',   name: 'Robo',  desc: 'Helmeted blast-bot' },
  { id: 'kitty',  name: 'Kit',   desc: 'Curious bomb cat' },
  { id: 'viking', name: 'Bjorn', desc: 'Horned demolition viking' },
  { id: 'ninja',  name: 'Kage',  desc: 'Silent fuse ninja' },
  { id: 'punk',   name: 'Spike', desc: 'Mohawk punk rocker' },
  { id: 'alien',  name: 'Zorp',  desc: 'One-eyed space visitor' },
];

// ---------- Items ----------
const ITEM_INFO = {
  bomb:   { label: 'Extra Bomb',   bg: ['#5a9cf0', '#1d4fa0'], desc: '+1 bomb at the same time' },
  fire:   { label: 'Fire Up',      bg: ['#ffa64a', '#c4400f'], desc: '+1 blast range' },
  speed:  { label: 'Speed Up',     bg: ['#6ee06e', '#1f8a2a'], desc: 'Walk faster' },
  kick:   { label: 'Kick',         bg: ['#4fd8e6', '#11788a'], desc: 'Walk into a bomb to kick it' },
  punch:  { label: 'Power Glove',  bg: ['#ff7fb4', '#b21f5c'], desc: 'Action: punch a bomb over walls' },
  pierce: { label: 'Pierce Bomb',  bg: ['#e65050', '#7a1010'], desc: 'Blasts go through bricks' },
  line:   { label: 'Line Bomb',    bg: ['#a07ef0', '#4a2aa0'], desc: 'Bomb twice: drop a whole line' },
  gold:   { label: 'Gold Flame',   bg: ['#ffe680', '#c99400'], desc: 'Maximum blast range' },
  skull:  { label: 'Skull',        bg: ['#8a4fb0', '#2a0d40'], desc: 'A random curse. Contagious!' },
  egg:    { label: 'Llama',        bg: ['#8fd8ff', '#2a7ab8'], desc: 'Ride a llama: extra life + special move' },
};
// Average number hidden per map. Fractions are chances, e.g. 0.4 = a 40% chance of one.
// Basic items are common, the strongest ones rare.
const ITEM_COUNTS = {
  bomb: 8, fire: 8, speed: 5,          // common
  kick: 2, skull: 2,                   // uncommon
  punch: 1.3, line: 1, egg: 1.3,       // rare
  pierce: 0.6, gold: 0.4,              // very rare
};

const DISEASES = {
  reverse:      'Reversed controls!',
  slow:         'Sluggish!',
  hyper:        'Hyper speed!',
  diarrhea:     'Bomb diarrhea!',
  constipation: 'Can\'t bomb!',
  shortfuse:    'Short fuse!',
  tinyflame:    'Tiny flames!',
};
const DISEASE_TYPES = Object.keys(DISEASES);

// Each Llama is an extra life and gives a special move on the Action button.
const MOUNTS = [
  { type: 'punch', color: '#6fc8ff', label: 'Punch Llama', desc: 'Action: punch bombs over walls' },
  { type: 'jump',  color: '#ff8fb1', label: 'Jump Llama',  desc: 'Action: leap 2 tiles over anything' },
  { type: 'dash',  color: '#9be36b', label: 'Dash Llama',  desc: 'Action: sprint forward at top speed' },
  { type: 'kick',  color: '#f7c948', label: 'Kick Llama',  desc: 'Walk into bombs to kick them' },
];

// The ring of border tiles (clockwise) that dead players float along.
const RING = (() => {
  const r = [];
  for (let x = 0; x < COLS; x++) r.push({ x, y: 0 });
  for (let y = 1; y < ROWS; y++) r.push({ x: COLS - 1, y });
  for (let x = COLS - 2; x >= 0; x--) r.push({ x, y: ROWS - 1 });
  for (let y = ROWS - 2; y >= 1; y--) r.push({ x: 0, y });
  return r;
})();
function ringInward(t) {
  const corner = (t.x === 0 || t.x === COLS - 1) && (t.y === 0 || t.y === ROWS - 1);
  if (corner) return null;
  if (t.y === 0) return 'down';
  if (t.y === ROWS - 1) return 'up';
  if (t.x === 0) return 'right';
  return 'left';
}
