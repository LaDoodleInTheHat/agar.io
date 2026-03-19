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
  worldW: 3000,
  worldH: 3000,
  foodCount: 500,
  virusCount: 12,
  virusRadius: 32,
  playerStartMass: 10,
  maxSplitPieces: 4,
  splitCooldown: 500,
  mergeCooldown: 3000,
  ejectMass: 14,
  ejectMinMass: 30,
  tickRate: 30,
  massDecay: 0.001,
};

const PLAYER_COLORS = ['#7df','#f7d','#fd7','#7fd','#f97','#d7f','#7ff','#ff7'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const rand  = (a, b) => Math.random() * (b - a) + a;
const randInt = (a, b) => Math.floor(rand(a, b));
const dist  = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const massToRadius = m => Math.sqrt(m) * 4;
let nextId = 1;
const uid = () => nextId++;

// ─── World State ──────────────────────────────────────────────────────────────
const state = {
  players: new Map(),
  food: [],
  viruses: [],
};

// ─── Food & Viruses ───────────────────────────────────────────────────────────
function spawnFood(n = 1) {
  for (let i = 0; i < n; i++) {
    state.food.push({
      id: uid(),
      x: rand(0, CFG.worldW), y: rand(0, CFG.worldH),
      color: `hsl(${randInt(0,360)},80%,65%)`,
      r: 5, mass: 1,
    });
  }
}

function spawnViruses() {
  for (let i = 0; i < CFG.virusCount; i++) {
    state.viruses.push({
      id: uid(),
      x: rand(50, CFG.worldW - 50), y: rand(50, CFG.worldH - 50),
      r: CFG.virusRadius,
    });
  }
}

// ─── Player / Cell factories ──────────────────────────────────────────────────
function makePlayer(id, name, color) {
  return {
    id, name, color,
    dead: false,
    splitCooldown: 0,
    input: { tx: CFG.worldW / 2, ty: CFG.worldH / 2, split: false, eject: false },
    cells: [makeCell(rand(200, CFG.worldW-200), rand(200, CFG.worldH-200), CFG.playerStartMass, color, name)],
  };
}

function makeCell(x, y, mass, color, name) {
  return { id: uid(), x, y, mass, r: massToRadius(mass), color, name, vx: 0, vy: 0, splitTimer: 0 };
}

// ─── Player physics ───────────────────────────────────────────────────────────
function tickPlayer(player, dt) {
  if (player.dead) return;
  player.splitCooldown = Math.max(0, player.splitCooldown - dt);

  if (player.input.split) { player.input.split = false; doSplit(player); }
  if (player.input.eject) { player.input.eject = false; doEject(player); }

  const { tx, ty } = player.input;

  for (const c of player.cells) {
    const speed = Math.max(1.5, 6 / Math.sqrt(c.mass / 10));
    const dx = tx - c.x, dy = ty - c.y;
    const d = Math.hypot(dx, dy);
    if (d > 1) { c.vx = (dx / d) * speed; c.vy = (dy / d) * speed; }
    c.x = Math.max(c.r, Math.min(CFG.worldW - c.r, c.x + c.vx));
    c.y = Math.max(c.r, Math.min(CFG.worldH - c.r, c.y + c.vy));
    c.splitTimer += dt;
    c.mass = Math.max(8, c.mass - CFG.massDecay);
    c.r = massToRadius(c.mass);
  }

  // Push overlapping own cells apart
  for (let i = 0; i < player.cells.length; i++) {
    for (let j = i + 1; j < player.cells.length; j++) {
      const a = player.cells[i], b = player.cells[j];
      const d = dist(a, b);
      const minD = (a.r + b.r) * 0.6;
      if (d < minD && a.splitTimer < CFG.mergeCooldown) {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const push = (minD - d) * 0.3;
        b.x += Math.cos(ang) * push; b.y += Math.sin(ang) * push;
        a.x -= Math.cos(ang) * push; a.y -= Math.sin(ang) * push;
      }
    }
  }

  // Re-merge cells after cooldown
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
  if (player.splitCooldown > 0 || player.cells.length >= CFG.maxSplitPieces) return;
  const { tx, ty } = player.input;
  for (const c of [...player.cells]) {
    if (c.mass < 20 || player.cells.length >= CFG.maxSplitPieces) continue;
    const half = c.mass / 2;
    c.mass = half; c.r = massToRadius(half);
    const ang = Math.atan2(ty - c.y, tx - c.x);
    const nc = makeCell(c.x + Math.cos(ang)*c.r, c.y + Math.sin(ang)*c.r, half, player.color, player.name);
    nc.vx = Math.cos(ang) * 14;
    nc.vy = Math.sin(ang) * 14;
    player.cells.push(nc);
  }
  player.splitCooldown = CFG.splitCooldown;
}

function doEject(player) {
  const { tx, ty } = player.input;
  for (const c of player.cells) {
    if (c.mass < CFG.ejectMinMass) continue;
    c.mass -= CFG.ejectMass; c.r = massToRadius(c.mass);
    const ang = Math.atan2(ty - c.y, tx - c.x);
    state.food.push({ id: uid(), x: c.x + Math.cos(ang)*c.r*1.1, y: c.y + Math.sin(ang)*c.r*1.1, color: c.color, r: 7, mass: CFG.ejectMass * 0.5 });
  }
}

// ─── Eating ───────────────────────────────────────────────────────────────────
function tickEating() {
  const alive = [...state.players.values()].filter(p => !p.dead);

  // Eat food
  for (const player of alive) {
    for (const c of player.cells) {
      for (let i = state.food.length - 1; i >= 0; i--) {
        const f = state.food[i];
        if (dist(c, f) < c.r - f.r * 0.5) { c.mass += f.mass; c.r = massToRadius(c.mass); state.food.splice(i, 1); }
      }
    }
  }
  while (state.food.length < CFG.foodCount) spawnFood(10);

  // Players eat each other
  for (let i = 0; i < alive.length; i++) {
    for (let j = 0; j < alive.length; j++) {
      if (i === j) continue;
      const eater = alive[i], prey = alive[j];
      for (const ec of eater.cells) {
        for (let k = prey.cells.length - 1; k >= 0; k--) {
          const pc = prey.cells[k];
          if (ec.mass > pc.mass * 1.15 && dist(ec, pc) < ec.r - pc.r * 0.5) {
            ec.mass += pc.mass; ec.r = massToRadius(ec.mass);
            prey.cells.splice(k, 1);
          }
        }
      }
      if (prey.cells.length === 0) {
        prey.dead = true;
        io.to(prey.id).emit('dead', { killer: eater.name });
      }
    }
  }

}

// ─── Snapshot (viewport-culled) ───────────────────────────────────────────────
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
    if (cells.length > 0) nearbyPlayers.push({ id: p.id, name: p.name, color: p.color, isYou: p.id === playerId, cells });
  }

  const leaderboard = [...state.players.values()]
    .filter(p => !p.dead)
    .map(p => ({ name: p.name, mass: Math.floor(p.cells.reduce((s,c)=>s+c.mass,0)), isYou: p.id === playerId }))
    .sort((a,b) => b.mass - a.mass).slice(0, 8);

  return {
    players: nearbyPlayers,
    food:    state.food.filter(f => dist({x:cx,y:cy}, f) < viewR),
    viruses: state.viruses.filter(v => dist({x:cx,y:cy}, v) < viewR),
    leaderboard,
  };
}

// ─── Game loop ────────────────────────────────────────────────────────────────
const TICK_MS = 1000 / CFG.tickRate;

function gameLoop() {
  for (const [, p] of state.players) tickPlayer(p, TICK_MS);
  tickEating();
  for (const [id, p] of state.players) {
    if (!p.dead) {
      const snap = buildSnapshot(id);
      if (snap) io.to(id).emit('state', snap);
    }
  }
}

// ─── Socket events ────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log(`[+] ${socket.id} connected  (players: ${state.players.size})`);

  socket.on('join', ({ name }) => {
    const safeName = (name || 'Player').slice(0, 16);
    const color = PLAYER_COLORS[randInt(0, PLAYER_COLORS.length)];
    state.players.set(socket.id, makePlayer(socket.id, safeName, color));
    socket.emit('joined', { id: socket.id, color });
    console.log(`[join] ${safeName}`);
  });

  // Client sends world-space mouse position directly
  socket.on('input', ({ tx, ty }) => {
    const p = state.players.get(socket.id);
    if (p) { p.input.tx = tx; p.input.ty = ty; }
  });

  socket.on('split',   () => { const p = state.players.get(socket.id); if (p) p.input.split  = true; });
  socket.on('eject',   () => { const p = state.players.get(socket.id); if (p) p.input.eject  = true; });

  socket.on('respawn', ({ name }) => {
    const p = state.players.get(socket.id);
    if (!p) return;
    const safeName = (name || p.name).slice(0, 16);
    p.name = safeName;
    p.dead = false;
    p.splitCooldown = 0;
    p.cells = [makeCell(rand(200, CFG.worldW-200), rand(200, CFG.worldH-200), CFG.playerStartMass, p.color, safeName)];
  });

  socket.on('disconnect', () => {
    state.players.delete(socket.id);
    console.log(`[-] ${socket.id} disconnected  (players: ${state.players.size})`);
  });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
spawnFood(CFG.foodCount);
spawnViruses();
setInterval(gameLoop, TICK_MS);

httpServer.listen(PORT, () => console.log(`Agario multiplayer → http://localhost:${PORT}`));