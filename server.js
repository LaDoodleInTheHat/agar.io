const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ─── Config ───────────────────────────────────────────────────────────────────
const CFG = {
  worldW: 3000, worldH: 3000,
  foodCount: 500, virusCount: 12, virusRadius: 32,
  playerStartMass: 10,
  maxSplitPieces: 4,
  splitCooldown: 500,
  splitMomentumTicks: 20,
  splitMomentumDecay: 0.80,
  mergeCooldown: 3000,
  ejectMass: 12, ejectMinMass: 20,
  splitMinMass: 16,
  tickRate: 30,
  massDecay: 0.001,
};

const PLAYER_COLORS = ['#7df','#f7d','#fd7','#7fd','#f97','#d7f','#7ff','#ff7'];

const rand = (a, b) => Math.random() * (b - a) + a;
const randInt = (a, b) => Math.floor(rand(a, b));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const massToRadius = m => Math.sqrt(m) * 4;
let nextId = 1;
const uid = () => String(nextId++);

const state = { players: new Map(), food: [], viruses: [] };

function spawnFood(n = 1) {
  for (let i = 0; i < n; i++)
    state.food.push({ id: uid(), x: rand(0, CFG.worldW), y: rand(0, CFG.worldH),
      color: `hsl(${randInt(0,360)},80%,65%)`, r: 5, mass: 1 });
}

function spawnViruses() {
  for (let i = 0; i < CFG.virusCount; i++)
    state.viruses.push({ id: uid(), x: rand(50, CFG.worldW-50), y: rand(50, CFG.worldH-50), r: CFG.virusRadius });
}

function makePlayer(id, name, color) {
  return { id, name, color, dead: false, splitCooldown: 0,
    input: { tx: CFG.worldW/2, ty: CFG.worldH/2 },
    cells: [makeCell(rand(200, CFG.worldW-200), rand(200, CFG.worldH-200), CFG.playerStartMass, color, name)] };
}

function makeCell(x, y, mass, color, name) {
  return { id: uid(), x, y, mass, r: massToRadius(mass), color, name,
    vx: 0, vy: 0, splitTimer: 0, splitTick: 999 };
}

function tickPlayer(player, dt) {
  if (player.dead) return;
  player.splitCooldown = Math.max(0, player.splitCooldown - dt);
  const { tx, ty } = player.input;

  for (const c of player.cells) {
    const speed = Math.max(1.5, 6 / Math.sqrt(c.mass / 10));

    if (c.splitTick < CFG.splitMomentumTicks) {
      // Smoothly blend from momentum to steering as splitTick increases
      const blend = c.splitTick / CFG.splitMomentumTicks;
      c.vx *= CFG.splitMomentumDecay;
      c.vy *= CFG.splitMomentumDecay;
      const dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy);
      if (d > 1) {
        c.vx += (dx/d) * speed * blend * 0.25;
        c.vy += (dy/d) * speed * blend * 0.25;
      }
      c.splitTick++;
    } else {
      // Normal steering — zero velocity when already at target (stops idle jitter)
      const dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy);
      if (d > speed * 0.5) {
        c.vx = (dx/d) * speed;
        c.vy = (dy/d) * speed;
      } else {
        c.vx = 0; c.vy = 0;
      }
    }

    c.x = Math.max(c.r, Math.min(CFG.worldW - c.r, c.x + c.vx));
    c.y = Math.max(c.r, Math.min(CFG.worldH - c.r, c.y + c.vy));
    c.splitTimer += dt;
    c.mass = Math.max(8, c.mass - CFG.massDecay);
    c.r = massToRadius(c.mass);
  }

  // Separate overlapping own cells (3 iterations for stability)
  for (let iter = 0; iter < 3; iter++) {
    for (let i = 0; i < player.cells.length; i++) {
      for (let j = i+1; j < player.cells.length; j++) {
        const a = player.cells[i], b = player.cells[j];
        const d = dist(a, b), minD = a.r + b.r;
        if (d < minD) {
          const ang = Math.atan2(b.y - a.y, b.x - a.x) || 0;
          const push = (minD - d) * 0.5;
          b.x += Math.cos(ang)*push; b.y += Math.sin(ang)*push;
          a.x -= Math.cos(ang)*push; a.y -= Math.sin(ang)*push;
        }
      }
    }
  }

  // Merge cells after cooldown
  if (player.cells.length > 1) {
    for (let i = player.cells.length - 1; i > 0; i--) {
      const c = player.cells[i];
      if (c.splitTimer > CFG.mergeCooldown && dist(player.cells[0], c) < player.cells[0].r) {
        player.cells[0].mass += c.mass;
        player.cells[0].r = massToRadius(player.cells[0].mass);
        player.cells.splice(i, 1);
      }
    }
  }
}

function doSplit(player) {
  if (player.splitCooldown > 0) return;
  const { tx, ty } = player.input;
  let didSplit = false;
  for (const c of [...player.cells]) {
    if (player.cells.length >= CFG.maxSplitPieces) break;
    if (c.mass < CFG.splitMinMass) continue;
    const half = c.mass / 2;
    c.mass = half; c.r = massToRadius(half);
    const ang = Math.atan2(ty - c.y, tx - c.x);
    const nc = makeCell(c.x + Math.cos(ang)*c.r*2.2, c.y + Math.sin(ang)*c.r*2.2, half, player.color, player.name);
    const spd = Math.max(14, 22 / Math.sqrt(half/10));
    nc.vx = Math.cos(ang)*spd; nc.vy = Math.sin(ang)*spd;
    nc.splitTimer = 0; nc.splitTick = 0;
    player.cells.push(nc); didSplit = true;
  }
  if (didSplit) player.splitCooldown = CFG.splitCooldown;
}

function doEject(player) {
  const { tx, ty } = player.input;
  for (const c of player.cells) {
    if (c.mass < CFG.ejectMinMass) continue;
    c.mass -= CFG.ejectMass; c.r = massToRadius(c.mass);
    const ang = Math.atan2(ty - c.y, tx - c.x);
    state.food.push({ id: uid(), x: c.x + Math.cos(ang)*(c.r+10), y: c.y + Math.sin(ang)*(c.r+10),
      color: c.color, r: 7, mass: CFG.ejectMass * 0.8 });
  }
}

function tickEating() {
  const alive = [...state.players.values()].filter(p => !p.dead);
  for (const player of alive) {
    for (const c of player.cells) {
      for (let i = state.food.length - 1; i >= 0; i--) {
        const f = state.food[i];
        if (dist(c, f) < c.r - f.r*0.5) { c.mass += f.mass; c.r = massToRadius(c.mass); state.food.splice(i, 1); }
      }
    }
  }
  while (state.food.length < CFG.foodCount) spawnFood(10);

  for (let i = 0; i < alive.length; i++) {
    for (let j = 0; j < alive.length; j++) {
      if (i === j) continue;
      const eater = alive[i], prey = alive[j];
      for (const ec of eater.cells) {
        for (let k = prey.cells.length - 1; k >= 0; k--) {
          const pc = prey.cells[k];
          if (ec.mass > pc.mass*1.15 && dist(ec, pc) < ec.r - pc.r*0.5) {
            ec.mass += pc.mass; ec.r = massToRadius(ec.mass); prey.cells.splice(k, 1);
          }
        }
      }
      if (prey.cells.length === 0) { prey.dead = true; io.to(prey.id).emit('dead', { killer: eater.name }); }
    }
  }
}

function buildSnapshot(playerId) {
  const player = state.players.get(playerId);
  if (!player || player.dead) return null;
  const cx = player.cells.reduce((s,c) => s+c.x, 0) / player.cells.length;
  const cy = player.cells.reduce((s,c) => s+c.y, 0) / player.cells.length;
  const viewR = 1800;

  const nearbyPlayers = [];
  for (const [, p] of state.players) {
    if (p.dead) continue;
    const cells = p.id === playerId ? p.cells : p.cells.filter(c => dist({x:cx,y:cy}, c) < viewR);
    if (cells.length > 0)
      nearbyPlayers.push({ id: p.id, name: p.name, color: p.color, isYou: p.id === playerId, cells });
  }

  return {
    players: nearbyPlayers,
    food: state.food.filter(f => dist({x:cx,y:cy}, f) < viewR),
    viruses: state.viruses.filter(v => dist({x:cx,y:cy}, v) < viewR),
    leaderboard: [...state.players.values()].filter(p => !p.dead)
      .map(p => ({ name: p.name, mass: Math.floor(p.cells.reduce((s,c)=>s+c.mass,0)), isYou: p.id === playerId }))
      .sort((a,b) => b.mass - a.mass).slice(0, 8),
  };
}

const TICK_MS = 1000 / CFG.tickRate;
function gameLoop() {
  for (const [, p] of state.players) tickPlayer(p, TICK_MS);
  tickEating();
  for (const [id, p] of state.players) {
    if (!p.dead) { const snap = buildSnapshot(id); if (snap) io.to(id).emit('state', snap); }
  }
}

io.on('connection', socket => {
  console.log(`[+] ${socket.id} connected (total: ${state.players.size + 1})`);

  socket.on('join', ({ name }) => {
    const safeName = (name || 'Player').slice(0, 16);
    const color = PLAYER_COLORS[randInt(0, PLAYER_COLORS.length)];
    state.players.set(socket.id, makePlayer(socket.id, safeName, color));
    socket.emit('joined', { id: socket.id, color });
  });

  socket.on('input', ({ tx, ty }) => {
    const p = state.players.get(socket.id);
    if (p) { p.input.tx = tx; p.input.ty = ty; }
  });

  socket.on('split', () => { const p = state.players.get(socket.id); if (p && !p.dead) doSplit(p); });
  socket.on('eject', () => { const p = state.players.get(socket.id); if (p && !p.dead) doEject(p); });

  socket.on('respawn', ({ name }) => {
    const p = state.players.get(socket.id);
    if (!p) return;
    const safeName = (name || p.name).slice(0, 16);
    p.name = safeName; p.dead = false; p.splitCooldown = 0;
    p.cells = [makeCell(rand(200, CFG.worldW-200), rand(200, CFG.worldH-200), CFG.playerStartMass, p.color, safeName)];
  });

  socket.on('cheat_mass', ({ mass }) => {
    const p = state.players.get(socket.id);
    if (!p || p.dead || !p.cells.length) return;
    const m = Math.max(8, Math.min(50000, Number(mass) || 100));
    p.cells = [{ ...p.cells[0], mass: m, r: massToRadius(m), vx: 0, vy: 0 }];
    console.log(`[cheat] ${p.name} set mass to ${m}`);
  });

  socket.on('ping_', () => socket.emit('pong_'));

  socket.on('disconnect', () => {
    state.players.delete(socket.id);
    console.log(`[-] ${socket.id} disconnected (total: ${state.players.size})`);
  });
});

spawnFood(CFG.foodCount);
spawnViruses();
setInterval(gameLoop, TICK_MS);
httpServer.listen(PORT, '0.0.0.0', () => console.log(`Agario multiplayer → http://localhost:${PORT}`));