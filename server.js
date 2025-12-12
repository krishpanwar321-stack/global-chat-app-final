// server.js — E2EE-ready server (stores salts only; relays ciphertexts)
const express = require('express');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

function generateRoomCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
function generateSaltBase64() {
  return crypto.randomBytes(16).toString('base64');
}

const roomSalts = {};   // room -> saltBase64
const roomColors = {};  // room -> { socketId: color }
const messageReactions = {}; // messageId -> [{ ciphertext, time }]

const colors = ["#5865F2","#F04747","#43B581","#FAA61A","#7289DA","#9B59B6","#2ECC71","#3498DB","#E67E22","#E84393","#00B894","#D63031"];

function assignColor(room, sid) {
  if (!roomColors[room]) roomColors[room] = {};
  const used = Object.values(roomColors[room]);
  const col = colors.find(c => !used.includes(c)) || colors[Math.floor(Math.random()*colors.length)];
  roomColors[room][sid] = col;
  return col;
}

function updateCount(room) {
  const r = io.sockets.adapter.rooms.get(room);
  io.to(room).emit("userCountUpdate", r ? r.size : 0);
}

io.on('connection', (socket) => {

  // Create room: server makes code + salt, joins creator, sends room+salt back
  socket.on('createRoom', (username) => {
    const room = generateRoomCode();
    const color = assignColor(room, socket.id);

    // server generates & stores salt for this room
    const salt = generateSaltBase64();
    roomSalts[room] = salt;

    socket.join(room);
    socket.data = { username, room, color };

    // send code & salt to creator
    socket.emit('roomCreated', room);
    socket.emit('roomSalt', { room, salt });

    socket.emit('systemMessage', `Created & joined room ${room}`);
    updateCount(room);
  });

  // Client requests salt for existing room (join flow: client asks salt first)
  socket.on('getSalt', ({ room }) => {
    if (!room) { socket.emit('errorMessage', 'Room required'); return; }
    if (!io.sockets.adapter.rooms.has(room)) {
      socket.emit('errorMessage', 'Room does not exist');
      return;
    }
    // ensure salt present
    if (!roomSalts[room]) roomSalts[room] = generateSaltBase64();
    socket.emit('roomSalt', { room, salt: roomSalts[room] });
  });

  // Client now emits joinRoom after deriving key locally
  socket.on('joinRoom', ({ username, room }) => {
    if (!room) { socket.emit('errorMessage', 'Room required'); return; }
    if (!io.sockets.adapter.rooms.has(room)) {
      socket.emit('errorMessage', 'Room does not exist'); return;
    }
    const color = assignColor(room, socket.id);
    socket.join(room);
    socket.data = { username, room, color };

    socket.emit('systemMessage', `Joined room ${room}`);
    socket.to(room).emit('systemMessage', `${username} joined`);
    updateCount(room);
  });

  // Relay encrypted message object to room unchanged
  socket.on('chatMessage', (encryptedPayload) => {
    const { username, room } = socket.data || {};
    if (!room) return;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const messageId = `${socket.id}-${Date.now()}`;

    // reply to sender that it's sent
    socket.emit('messageSent', { messageId });

    // broadcast ciphertext object to room
    io.to(room).emit('chatMessage', {
      username,
      encrypted: encryptedPayload,
      time,
      messageId
    });
  });

  // reactions (clients send opaque ciphertexts which server stores & broadcasts)
  socket.on('addReactionEncrypted', ({ messageId, encryptedCipher }) => {
    const { username, room } = socket.data || {};
    if (!room || !messageId || !encryptedCipher) return;
    if (!messageReactions[messageId]) messageReactions[messageId] = [];
    messageReactions[messageId].push({ ciphertext: encryptedCipher, time: Date.now() });
    io.to(room).emit('reactionUpdate', { messageId, history: messageReactions[messageId] });
  });

  socket.on('typing', () => {
    const { username, room } = socket.data || {};
    if (!room || !username) return;
    socket.to(room).emit('typing', username);
  });
  socket.on('stopTyping', () => {
    const { room } = socket.data || {};
    if (!room) return;
    socket.to(room).emit('stopTyping');
  });

  socket.on('leaveRoom', () => {
    const { username, room } = socket.data || {};
    if (!room) return;
    socket.leave(room);
    socket.to(room).emit('systemMessage', `${username} left`);
    updateCount(room);
  });

  socket.on('disconnect', () => {
    if (!socket.data?.room) return;
    const { username, room } = socket.data;
    socket.to(room).emit('systemMessage', `${username} disconnected`);
    updateCount(room);
  });
});

server.listen(3000, () => console.log('Server running on port 3000'));
