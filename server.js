const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// rooms[code] = { p1: socket|null, p2: socket|null, p1Data: {}, p2Data: {} }
const rooms = {};

function generateCode() {
  // 4-digit numeric code, avoid duplicates
  let code;
  do { code = String(Math.floor(1000 + Math.random() * 9000)); }
  while (rooms[code]);
  return code;
}

app.get('/', (req, res) => res.send('Beyblade Server Running ✅'));

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // ── PING / LATENCY CHECK ──
  socket.on('ping_check', () => {
    socket.emit('pong_check');
  });

  // ── CREATE ROOM (host player) ──
  // Client sends: { topIdx, discIdx, tipIdx }
  // Client expects back: room_created { code }
  socket.on('create_room', (data) => {
    const code = generateCode();
    rooms[code] = {
      p1: socket, p2: null,
      p1Data: data || {},
      p2Data: {}
    };
    socket.roomCode = code;
    socket.playerSlot = 'p1';
    socket.join(code);

    socket.emit('room_created', { code });
    console.log(`Room ${code} created by P1 (${socket.id})`);
  });

  // ── JOIN ROOM (joining player) ──
  // Client sends: { code, topIdx, discIdx, tipIdx }
  // Client expects back: room_joined { code } then opponent gets opponent_joined
  // Then both get both_ready and game_start
  socket.on('join_room', (data) => {
    const code = data && data.code;
    const room = rooms[code];

    if (!room) {
      socket.emit('room_error', { message: 'Room not found. Check your code.' });
      return;
    }
    if (room.p2) {
      socket.emit('room_error', { message: 'Room is full.' });
      return;
    }

    room.p2 = socket;
    room.p2Data = data || {};
    socket.roomCode = code;
    socket.playerSlot = 'p2';
    socket.join(code);

    // Tell P2 they joined successfully
    socket.emit('room_joined', { code });

    // Tell P1 opponent arrived
    room.p1.emit('opponent_joined');

    console.log(`Room ${code} — P2 joined (${socket.id}), starting countdown`);

    // Small delay then fire both_ready + game_start for both players
    setTimeout(() => {
      if (!rooms[code]) return; // room may have been cleaned up
      const startData = {
        p1: room.p1Data,
        p2: room.p2Data
      };
      io.to(code).emit('both_ready');
      io.to(code).emit('game_start', startData);
      console.log(`Room ${code} — game_start fired`);
    }, 500);
  });

  // ── LEAVE ROOM ──
  socket.on('leave_room', (data) => {
    const code = data && data.code || socket.roomCode;
    cleanupRoom(code, socket);
  });

  // ── RELAY: player position/velocity every frame ──
  socket.on('player_state', (state) => {
    const opponent = getOpponent(socket);
    if (opponent) opponent.emit('opponent_state', state);
  });

  // ── RELAY: HP sync ──
  socket.on('player_hp', (data) => {
    const opponent = getOpponent(socket);
    if (opponent) opponent.emit('opponent_hp', data);
  });

  // ── RELAY: game events (burst, collision, win, etc.) ──
  socket.on('game_event', (event) => {
    const opponent = getOpponent(socket);
    if (opponent) opponent.emit('game_event', event);
  });

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    cleanupRoom(socket.roomCode, socket);
  });
});

// ── HELPERS ──
function getOpponent(socket) {
  const room = rooms[socket.roomCode];
  if (!room) return null;
  return socket.playerSlot === 'p1' ? room.p2 : room.p1;
}

function cleanupRoom(code, triggeringSocket) {
  const room = rooms[code];
  if (!room) return;
  const opponent = triggeringSocket.playerSlot === 'p1' ? room.p2 : room.p1;
  if (opponent) {
    opponent.emit('opponent_disconnected');
    opponent.roomCode = null;
    opponent.playerSlot = null;
  }
  delete rooms[code];
  console.log(`Room ${code} closed`);
}

// ── START ──
// Railway injects PORT env variable automatically — always use it
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Beyblade server running on port ${PORT}`));
