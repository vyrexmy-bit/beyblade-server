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

  socket.on('create_room', (data) => {
    const code = generateCode();
    rooms[code] = {
      p1: socket, p2: null,
      p1Data: data || {},
      p2Data: {},
      rounds: (data && data.rounds) || 3,
      stadium: (data && data.stadium) || 'classic'
    };
    socket.roomCode = code;
    socket.playerSlot = 'p1';
    socket.username = (data && data.username) || 'P1';
    socket.join(code);
    socket.emit('room_created', { code });
    console.log(`Room ${code} created by ${socket.username}`);
  });

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
    socket.emit('room_joined', { code, rounds: room.rounds, stadium: room.stadium, hostName: room.p1.username });
    room.p1.emit('opponent_joined', { username: socket.username });
    console.log(`Room ${code}: ${room.p1.username} vs ${socket.username}`);
    setTimeout(() => {
      if (!rooms[code]) return;
      const startData = {
        p1: { ...room.p1Data, username: room.p1.username },
        p2: { ...room.p2Data, username: room.p2 ? room.p2.username : 'P2' },
        rounds: room.rounds,
        stadium: room.stadium
      };
      room.p1.emit('both_ready', { oppName: room.p2 ? room.p2.username : 'P2', rounds: room.rounds });
      if (room.p2) room.p2.emit('both_ready', { oppName: room.p1.username, rounds: room.rounds });
      io.to(code).emit('game_start', startData);
      console.log(`Room ${code} — game started`);
    }, 500);
  });

  socket.on('leave_room', (data) => {
    cleanupRoom((data && data.code) || socket.roomCode, socket);
  });

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
  if (opp) { opp.emit('opponent_disconnected'); opp.roomCode = null; opp.playerSlot = null; }
  delete rooms[code];
  console.log(`Room ${code} closed`);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Beyblade server on port ${PORT}`));
