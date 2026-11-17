'use strict';

// Spawn order: opposite corners first, so 2 players start far apart.
const SPAWNS = [
  { x: 1, y: 1 },
  { x: COLS - 2, y: ROWS - 2 },
  { x: COLS - 2, y: 1 },
  { x: 1, y: ROWS - 2 },
];

const ARENAS = [
  {
    id: 'garden', name: 'Sunny Garden', desc: 'The classic. Grass, stones and lots of bricks.',
    theme: {
      style: 'garden', bg: '#1f3d1b',
      floorA: '#6fc152', floorB: '#65b649', floorDot: '#8ad86c',
      hardTop1: '#c9d0d8', hardTop2: '#8f99a6', hardFront1: '#6f7885', hardFront2: '#474e59', hardEdge: '#2f353e',
      softTop1: '#f0a564', softTop2: '#c86a30', softFront1: '#a8521f', softFront2: '#7a3612', softEdge: '#5a2608',
      debris: ['#e08a44', '#b8622a', '#f5b070'],
    },
  },
  {
    id: 'factory', name: 'Conveyor Factory', desc: 'Conveyor belts carry players and bombs around.',
    theme: {
      style: 'factory', bg: '#1d2128',
      floorA: '#858f9c', floorB: '#7b8592', floorDot: '#959fac',
      hardTop1: '#6d7787', hardTop2: '#454d5a', hardFront1: '#353b46', hardFront2: '#22262e', hardEdge: '#15181d',
      softTop1: '#dcae72', softTop2: '#b8864a', softFront1: '#99683a', softFront2: '#7a5028', softEdge: '#4f3216',
      debris: ['#dcae72', '#b8864a', '#f2d3a0'],
    },
  },
  {
    id: 'space', name: 'Warp Station', desc: 'Warp holes teleport anything that enters them.',
    theme: {
      style: 'space', bg: '#070818',
      floorA: '#1e2348', floorB: '#1a1f40', floorDot: '#3a4690',
      hardTop1: '#7a68e6', hardTop2: '#41339c', hardFront1: '#2f2578', hardFront2: '#1b1450', hardEdge: '#0c0830',
      softTop1: '#e48cff', softTop2: '#9a3ad0', softFront1: '#7024a8', softFront2: '#4c147a', softEdge: '#2a0848',
      debris: ['#e48cff', '#b05ae8', '#ffd0ff'],
    },
  },
  {
    id: 'glacier', name: 'Glacier Rink', desc: 'Slippery ice in the middle: you keep sliding!',
    theme: {
      style: 'glacier', bg: '#16304a',
      floorA: '#9fbcd8', floorB: '#94b2d0', floorDot: '#ffffff',
      hardTop1: '#a8d4f2', hardTop2: '#5f9cc8', hardFront1: '#4a83b0', hardFront2: '#2c5a80', hardEdge: '#1a3a58',
      softTop1: '#ffffff', softTop2: '#cfe2f2', softFront1: '#b4cde2', softFront2: '#8eaecb', softEdge: '#5a7c9c',
      debris: ['#ffffff', '#dbeaf6', '#b4cde2'],
    },
  },
];

function buildArena(arena, opts) {
  const grid = [], special = [], hidden = [];
  for (let y = 0; y < ROWS; y++) {
    grid.push(new Array(COLS).fill(EMPTY));
    special.push(new Array(COLS).fill(null));
    hidden.push(new Array(COLS).fill(null));
    for (let x = 0; x < COLS; x++) {
      if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 || (x % 2 === 0 && y % 2 === 0)) grid[y][x] = HARD;
    }
  }
  const noSoft = new Set();
  const key = (x, y) => y * COLS + x;
  for (const s of SPAWNS) {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) noSoft.add(key(s.x + dx, s.y + dy));
  }

  if (arena.id === 'factory') {
    const set = (x, y, dir) => { special[y][x] = { type: 'conveyor', dir }; noSoft.add(key(x, y)); };
    for (let x = 3; x < 11; x++) set(x, 3, 'right');
    for (let y = 3; y < 9; y++) set(11, y, 'down');
    for (let x = 11; x > 3; x--) set(x, 9, 'left');
    for (let y = 9; y > 3; y--) set(3, y, 'up');
  } else if (arena.id === 'space') {
    const pairs = [
      [{ x: 3, y: 3 }, { x: 11, y: 9 }],
      [{ x: 11, y: 3 }, { x: 3, y: 9 }],
      [{ x: 7, y: 1 }, { x: 7, y: 11 }],
    ];
    pairs.forEach(([a, b], i) => {
      const hue = [190, 300, 45][i];
      special[a.y][a.x] = { type: 'warp', to: b, hue };
      special[b.y][b.x] = { type: 'warp', to: a, hue };
      noSoft.add(key(a.x, a.y)); noSoft.add(key(b.x, b.y));
    });
  } else if (arena.id === 'glacier') {
    for (let y = 3; y <= 9; y++) {
      for (let x = 3; x <= 11; x++) if (grid[y][x] === EMPTY) special[y][x] = { type: 'ice' };
    }
  }

  const softs = [];
  for (let y = 1; y < ROWS - 1; y++) {
    for (let x = 1; x < COLS - 1; x++) {
      if (grid[y][x] === EMPTY && !noSoft.has(key(x, y)) && Math.random() < 0.78) {
        grid[y][x] = SOFT;
        softs.push({ x, y });
      }
    }
  }

  // Hide power-ups inside soft blocks
  shuffle(softs);
  const mult = opts.density === 'low' ? 0.6 : opts.density === 'high' ? 1.6 : 1;
  const list = [];
  for (const [type, n] of Object.entries(ITEM_COUNTS)) {
    if (type === 'skull' && !opts.diseases) continue;
    const avg = n * mult;
    let c = Math.floor(avg) + (Math.random() < avg - Math.floor(avg) ? 1 : 0);
    if (type === 'bomb' || type === 'fire') c = Math.max(2, c);
    for (let i = 0; i < c; i++) list.push(type);
  }
  for (let i = 0; i < list.length && i < softs.length; i++) hidden[softs[i].y][softs[i].x] = list[i];

  return { grid, special, hidden };
}

// Order in which sudden-death blocks fall: a spiral from the outside in.
function spiralOrder() {
  const out = [];
  let x0 = 1, y0 = 1, x1 = COLS - 2, y1 = ROWS - 2;
  while (x0 <= x1 && y0 <= y1) {
    for (let x = x0; x <= x1; x++) out.push({ x, y: y0 });
    for (let y = y0 + 1; y <= y1; y++) out.push({ x: x1, y });
    if (y1 > y0) for (let x = x1 - 1; x >= x0; x--) out.push({ x, y: y1 });
    if (x1 > x0) for (let y = y1 - 1; y > y0; y--) out.push({ x: x0, y });
    x0++; y0++; x1--; y1--;
  }
  return out;
}
