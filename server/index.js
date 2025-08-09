import express from 'express';
import http from 'http';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);

// Allow your site, subdomain, Render URL, and local dev
const allowedOrigins = [
  'https://avrp.me',
  'https://www.avrp.me',
  'https://api.avrp.me',
  'https://avrp.onrender.com',
  'http://localhost:3000',
  'http://127.0.0.1:5500'
];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST']
  }
});

const TICK = 30;
const ATTACK_RANGE = 1.8;
const ATTACK_ARC = Math.PI * 0.6;
const PARRY_WINDOW_MS = 1000;
const STUN_MS = 2000;

const players = new Map();
const snapshot = () => ({
  players: [...players.values()].map(p => ({
    id: p.id, pos: p.pos, rot: p.rot, stunnedUntil: p.stunnedUntil || 0
  }))
});

io.on('connection', socket => {
  const id = socket.id;
  players.set(id, {
    id,
    pos: [Math.random()*4-2, 1.6, Math.random()*4-2],
    rot: 0,
    lastAttack: 0,
    blocking: false,
    blockTime: 0,
    stunnedUntil: 0
  });

  socket.on('state', ({ pos, rot }) => {
    const p = players.get(id); if(!p) return;
    p.pos = pos; p.rot = rot;
  });

  socket.on('block', ({ holding }) => {
    const p = players.get(id); if(!p) return;
    p.blocking = !!holding;
    if (p.blocking) p.blockTime = Date.now();
  });

  socket.on('attack', () => {
    const p = players.get(id); if(!p) return;
    const now = Date.now();
    if (now < (p.stunnedUntil || 0)) return;

    p.lastAttack = now;
    for (const [oid, o] of players) {
      if (oid === id) continue;

      const dx = o.pos[0] - p.pos[0];
      const dz = o.pos[2] - p.pos[2];
      const dist2 = dx*dx + dz*dz;
      if (dist2 > ATTACK_RANGE * ATTACK_RANGE) continue;

      const yawTo = Math.atan2(dz, dx);
      let dYaw = yawTo - p.rot;
      while (dYaw > Math.PI) dYaw -= 2*Math.PI;
      while (dYaw < -Math.PI) dYaw += 2*Math.PI;
      if (Math.abs(dYaw) > ATTACK_ARC * 0.5) continue;

      if (o.blocking && (o.blockTime >= now - PARRY_WINDOW_MS)) {
        p.stunnedUntil = now + STUN_MS;
        io.to(id).emit('hit', { from: o.id, type: 'parried' });
      } else {
        io.to(o.id).emit('hit', { from: p.id, type: 'landed' });
      }
    }
  });

  socket.on('disconnect', () => {
    players.delete(id);
  });
});

setInterval(() => io.emit('world', snapshot()), 1000 / TICK);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on', PORT));
