const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const rooms = {};

function generateCode() {
  let code;
  do { code = String(Math.floor(1000 + Math.random() * 9000)); }
  while (rooms[code]);
  return code;
}

app.get('/', (req, res) => res.send('Beyblade Server Running ✅'));

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('ping_check', () => socket.emit('pong_check'));

  // ── CREATE ROOM ──
  socket.on('create_room', (data) => {
    const code = generateCode();
    rooms[code] = {
      p1: socket,
      p2: null,
      p1Data: data || {},
      p2Data: {},
      rounds: (data && data.rounds) || 3,
      stadium: (data && data.stadium) || 'classic',
      p1Ready: false,  // track ready state server-side
      p2Ready: false
    };
    socket.roomCode = code;
    socket.playerSlot = 'p1';
    socket.username = (data && data.username) || 'P1';
    socket.join(code);
    socket.emit('room_created', { code });
    console.log(`Room ${code} created by ${socket.username}`);
  });

  // ── JOIN ROOM ──
  socket.on('join_room', (data) => {
    const code = data && data.code;
    const room = rooms[code];
    if (!room) { socket.emit('room_error', { message: 'Room not found. Check your code.' }); return; }
    if (room.p2) { socket.emit('room_error', { message: 'Room is full.' }); return; }

    room.p2 = socket;
    room.p2Data = data || {};
    socket.roomCode = code;
    socket.playerSlot = 'p2';
    socket.username = (data && data.username) || 'P2';
    socket.join(code);

    // Tell joiner they joined successfully
    socket.emit('room_joined', {
      code,
      rounds: room.rounds,
      stadium: room.stadium,
      hostName: room.p1.username
    });

    // Tell host their opponent arrived
    room.p1.emit('opponent_joined', {
      username: socket.username,
      topIdx: room.p2Data.topIdx || 0
    });

    // Tell BOTH players to show the prebattle screen — NOT game_start
    // both_ready means "both players are in the room", not "both clicked ready"
    setTimeout(() => {
      if (!rooms[code]) return;
      room.p1.emit('both_ready', {
        oppName: socket.username,
        oppTopIdx: room.p2Data.topIdx || 0,
        rounds: room.rounds,
        stadium: room.stadium
      });
      room.p2.emit('both_ready', {
        oppName: room.p1.username,
        oppTopIdx: room.p1Data.topIdx || 0,
        rounds: room.rounds,
        stadium: room.stadium
      });
      console.log(`Room ${code} — both players in lobby, waiting for ready`);
    }, 400);

    // DO NOT auto-fire game_start here — wait for both player_ready events
  });

  // ── PLAYER READY ──
  // Fired when a player clicks the READY button on the prebattle screen
  socket.on('player_ready', (data) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;

    // Update ready state and bey selection
    if (socket.playerSlot === 'p1') {
      room.p1Ready = true;
      if (data) room.p1Data = { ...room.p1Data, ...data };
    } else {
      room.p2Ready = true;
      if (data) room.p2Data = { ...room.p2Data, ...data };
    }

    console.log(`Room ${code} — ${socket.username} is ready (p1:${room.p1Ready} p2:${room.p2Ready})`);

    // Relay to opponent so their UI updates
    const opp = socket.playerSlot === 'p1' ? room.p2 : room.p1;
    if (opp) {
      opp.emit('opponent_ready', {
        oppName: socket.username,
        topIdx: (socket.playerSlot === 'p1' ? room.p1Data.topIdx : room.p2Data.topIdx) || 0
      });
    }

    // If BOTH are ready → fire game_start
    if (room.p1Ready && room.p2Ready) {
      const startData = {
        p1: { ...room.p1Data, username: room.p1.username },
        p2: { ...room.p2Data, username: room.p2 ? room.p2.username : 'P2' },
        rounds: room.rounds,
        stadium: room.stadium
      };
      io.to(code).emit('game_start', startData);
      console.log(`Room ${code} — BOTH READY → game_start fired`);
    }
  });

  // ── LEAVE ROOM ──
  socket.on('leave_room', (data) => {
    cleanupRoom((data && data.code) || socket.roomCode, socket);
  });

  // ── LIVE SYNC ──
  socket.on('player_state', (state) => {
    const opp = getOpponent(socket);
    if (opp) opp.emit('opponent_state', state);
  });

  socket.on('player_hp', (data) => {
    const opp = getOpponent(socket);
    if (opp) opp.emit('opponent_hp', data);
  });

  socket.on('game_event', (event) => {
    const opp = getOpponent(socket);
    if (opp) opp.emit('game_event', event);
  });

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    cleanupRoom(socket.roomCode, socket);
  });
});

function getOpponent(socket) {
  const room = rooms[socket.roomCode];
  if (!room) return null;
  return socket.playerSlot === 'p1' ? room.p2 : room.p1;
}

function cleanupRoom(code, triggeringSocket) {
  const room = rooms[code];
  if (!room) return;
  const opp = triggeringSocket.playerSlot === 'p1' ? room.p2 : room.p1;
  if (opp) {
    opp.emit('opponent_disconnected');
    opp.roomCode = null;
    opp.playerSlot = null;
  }
  delete rooms[code];
  console.log(`Room ${code} closed`);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Beyblade server on port ${PORT}`));
