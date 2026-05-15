const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const rooms = {}; // roomCode -> { p1: socket, p2: socket }

app.get('/', (req, res) => res.send('Beyblade Server Running ✅'));

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Player wants to create or join a room
  socket.on('join_room', (roomCode) => {
    const room = rooms[roomCode];

    if (!room) {
      // First player — create room
      rooms[roomCode] = { p1: socket, p2: null };
      socket.roomCode = roomCode;
      socket.playerNum = 1;
      socket.emit('room_joined', { playerNum: 1, status: 'waiting' });
      console.log(`Room ${roomCode} created by P1`);

    } else if (room.p1 && !room.p2) {
      // Second player — join room
      room.p2 = socket;
      socket.roomCode = roomCode;
      socket.playerNum = 2;
      socket.emit('room_joined', { playerNum: 2, status: 'ready' });

      // Tell P1 the game can start
      room.p1.emit('opponent_joined');
      console.log(`Room ${roomCode} — P2 joined, game starting`);

    } else {
      socket.emit('room_error', 'Room is full or does not exist');
    }
  });

  // Relay player state to opponent every frame
  socket.on('player_state', (state) => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const opponent = socket.playerNum === 1 ? room.p2 : room.p1;
    if (opponent) opponent.emit('opponent_state', state);
  });

  // Relay game events (collision, HP change, win/loss)
  socket.on('game_event', (event) => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const opponent = socket.playerNum === 1 ? room.p2 : room.p1;
    if (opponent) opponent.emit('game_event', event);
  });

  // Player disconnected
  socket.on('disconnect', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const opponent = socket.playerNum === 1 ? room.p2 : room.p1;
    if (opponent) opponent.emit('opponent_disconnected');
    delete rooms[socket.roomCode];
    console.log(`Room ${socket.roomCode} closed`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
