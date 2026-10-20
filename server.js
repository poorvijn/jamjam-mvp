const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));

// In-memory MVP state: rooms persist while the server process is running.
const rooms = new Map();
const makeRoomCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const newRoom = () => ({
  queue: [], currentIndex: 0, isPlaying: false, position: 0,
  updatedAt: Date.now(), members: new Map(), revision: 0, lastEndedVideoId: null, lastEndedAt: 0
});
function getRoom(code) {
  const normalized = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  if (!normalized) return null;
  if (!rooms.has(normalized)) rooms.set(normalized, newRoom());
  return { code: normalized, room: rooms.get(normalized) };
}
function currentPosition(room) {
  if (!room.isPlaying) return Math.max(0, room.position || 0);
  return Math.max(0, (room.position || 0) + (Date.now() - room.updatedAt) / 1000);
}
function snapshot(code, room) {
  return {
    code, queue: room.queue, currentIndex: room.currentIndex,
    isPlaying: room.isPlaying, position: currentPosition(room),
    updatedAt: Date.now(), revision: room.revision,
    members: [...room.members.values()].map(m => ({ id: m.id, name: m.name }))
  };
}
function publish(code, room) { room.revision++; io.to(code).emit('room:state', snapshot(code, room)); }
function cleanVideoId(input) {
  try {
    const u = new URL(input);
    let id = '';
    if (u.hostname === 'youtu.be' || u.hostname.endsWith('.youtu.be')) id = u.pathname.split('/').filter(Boolean)[0] || '';
    else if (u.hostname.includes('youtube.com') || u.hostname.includes('youtube-nocookie.com')) {
      id = u.searchParams.get('v') || (u.pathname.match(/\/(?:embed|shorts|live)\/([^/?]+)/) || [])[1] || '';
    }
    return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}
function updatePlayback(room, { playing, position, index }) {
  if (Number.isInteger(index) && room.queue.length) room.currentIndex = Math.min(room.queue.length - 1, Math.max(0, index));
  if (typeof position === 'number' && Number.isFinite(position)) room.position = Math.max(0, position);
  if (typeof playing === 'boolean') room.isPlaying = playing;
  room.updatedAt = Date.now();
}
io.on('connection', socket => {
  socket.on('room:join', ({ code, name } = {}) => {
    let roomCode = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (!roomCode || roomCode === 'NEW') {
      do { roomCode = makeRoomCode(); } while (rooms.has(roomCode));
      rooms.set(roomCode, newRoom());
    }
    if (!rooms.has(roomCode)) rooms.set(roomCode, newRoom());
    const room = rooms.get(roomCode);
    for (const joined of socket.rooms) if (joined !== socket.id) socket.leave(joined);
    socket.join(roomCode);
    const displayName = String(name || 'Listener').trim().slice(0, 24) || 'Listener';
    room.members.set(socket.id, { id: socket.id, name: displayName });
    socket.data.roomCode = roomCode;
    socket.emit('room:joined', { code: roomCode, state: snapshot(roomCode, room) });
    publish(roomCode, room);
  });

  socket.on('queue:add', ({ url, title } = {}) => {
    const code = socket.data.roomCode; const room = rooms.get(code); if (!room) return;
    const videoId = cleanVideoId(url || '');
    if (!videoId) return socket.emit('app:error', 'Paste a valid YouTube video link (regular, youtu.be, Shorts, or embed URL).');
    if (room.queue.some(item => item.videoId === videoId)) return socket.emit('app:notice', 'That video is already in this room’s queue.');
    room.queue.push({ id: crypto.randomUUID(), videoId, url: `https://www.youtube.com/watch?v=${videoId}`, title: String(title || '').slice(0, 120), addedBy: room.members.get(socket.id)?.name || 'Listener' });
    if (room.queue.length === 1) { room.currentIndex = 0; room.position = 0; room.isPlaying = false; room.updatedAt = Date.now(); }
    publish(code, room);
  });
  socket.on('queue:remove', ({ id } = {}) => {
    const code = socket.data.roomCode; const room = rooms.get(code); if (!room) return;
    const idx = room.queue.findIndex(item => item.id === id); if (idx < 0) return;
    room.queue.splice(idx, 1);
    if (!room.queue.length) { room.currentIndex = 0; room.position = 0; room.isPlaying = false; }
    else if (idx < room.currentIndex) room.currentIndex--;
    else if (idx === room.currentIndex) { room.currentIndex = Math.min(room.currentIndex, room.queue.length - 1); room.position = 0; room.isPlaying = false; room.updatedAt = Date.now(); }
    publish(code, room);
  });
  socket.on('queue:move', ({ id, to } = {}) => {
    const code = socket.data.roomCode; const room = rooms.get(code); if (!room) return;
    const from = room.queue.findIndex(item => item.id === id);
    if (from < 0 || !Number.isInteger(to) || to < 0 || to >= room.queue.length || from === to) return;
    const currentId = room.queue[room.currentIndex]?.id;
    const [item] = room.queue.splice(from, 1); room.queue.splice(to, 0, item);
    room.currentIndex = room.queue.findIndex(q => q.id === currentId);
    publish(code, room);
  });
  socket.on('playback:command', (payload = {}) => {
    const code = socket.data.roomCode; const room = rooms.get(code); if (!room) return;
    const { action } = payload;
    if (action === 'play') updatePlayback(room, { playing: true, position: payload.position });
    else if (action === 'pause') updatePlayback(room, { playing: false, position: payload.position });
    else if (action === 'seek') updatePlayback(room, { position: payload.position });
    else if (action === 'select') {
      if (!Number.isInteger(payload.index) || payload.index < 0 || payload.index >= room.queue.length) return;
      updatePlayback(room, { index: payload.index, position: 0, playing: true });
    } else if (action === 'next' || action === 'previous') {
      if (!room.queue.length) return;
      const delta = action === 'next' ? 1 : -1;
      const next = (room.currentIndex + delta + room.queue.length) % room.queue.length;
      updatePlayback(room, { index: next, position: 0, playing: true });
    } else return;
    publish(code, room);
  });
  socket.on('playback:ended', ({ videoId } = {}) => {
    const code = socket.data.roomCode; const room = rooms.get(code); if (!room || !room.queue.length) return;
    if (videoId && room.queue[room.currentIndex]?.videoId !== videoId) return;
    if (room.lastEndedVideoId === videoId && Date.now() - room.lastEndedAt < 4000) return;
    room.lastEndedVideoId = videoId || room.queue[room.currentIndex]?.videoId; room.lastEndedAt = Date.now();
    const next = (room.currentIndex + 1) % room.queue.length;
    updatePlayback(room, { index: next, position: 0, playing: true }); publish(code, room);
  });
  socket.on('disconnect', () => {
    const code = socket.data.roomCode; const room = rooms.get(code); if (!room) return;
    room.members.delete(socket.id); publish(code, room);
    if (!room.members.size && !room.queue.length) rooms.delete(code);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Jam Jam MVP running at http://localhost:${PORT}`));
