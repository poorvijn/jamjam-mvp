const socket = io();
const $ = id => document.getElementById(id);
const joinView = $('joinView'), roomView = $('roomView');
let roomCode = '', displayName = '', state = null, player = null, playerReady = false;
let lastLoadedVideo = null, applyingRemote = false, pendingSeek = null, lastActionAt = 0, progressTimer = null, toastTimer = null;
let localDuration = 0, localPosition = 0, isSeeking = false, lastRevision = -1;

function toast(message, error = false) { const el = $('toast'); el.textContent = message; el.classList.toggle('error', error); el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2900); }
function fmt(seconds) { if (!Number.isFinite(seconds) || seconds < 0) seconds = 0; const s = Math.floor(seconds); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function currentItem(s = state) { return s && s.queue[s.currentIndex] ? s.queue[s.currentIndex] : null; }
function getPlayerPosition() { try { if (playerReady && player && typeof player.getCurrentTime === 'function') return player.getCurrentTime() || 0; } catch {} return localPosition || 0; }
function command(action, extra = {}) { if (!roomCode) return; lastActionAt = Date.now(); socket.emit('playback:command', { action, position: getPlayerPosition(), ...extra }); }
function playerStateCode() { try { return playerReady && player ? player.getPlayerState() : -1; } catch { return -1; } }
function applyRoomState(next) {
  if (!next || (next.revision != null && next.revision < lastRevision)) return;
  const oldItem = currentItem(); const oldPlaying = state?.isPlaying;
  state = next; lastRevision = next.revision ?? lastRevision;
  renderRoom();
  const item = currentItem();
  if (!playerReady || !player || !item) return;
  const position = Math.max(0, next.position || 0);
  if (item.videoId !== lastLoadedVideo) {
    lastLoadedVideo = item.videoId; localPosition = position;
    applyingRemote = true;
    if (next.isPlaying) player.loadVideoById({ videoId: item.videoId, startSeconds: position });
    else player.cueVideoById({ videoId: item.videoId, startSeconds: position });
    setTimeout(() => { applyingRemote = false; }, 900);
    return;
  }
  const actual = getPlayerPosition();
  if (Math.abs(actual - position) > 3) {
    applyingRemote = true; try { player.seekTo(position, true); } catch {} setTimeout(() => { applyingRemote = false; }, 350);
  }
  if (next.isPlaying && playerStateCode() !== 1) { applyingRemote = true; try { player.playVideo(); } catch {} setTimeout(() => { applyingRemote = false; }, 600); }
  else if (!next.isPlaying && playerStateCode() === 1) { applyingRemote = true; try { player.pauseVideo(); } catch {} setTimeout(() => { applyingRemote = false; }, 400); }
  if (oldItem?.videoId !== item.videoId || oldPlaying !== next.isPlaying) updateTransport();
}
function renderRoom() {
  $('roomCode').textContent = roomCode;
  $('listenerCount').textContent = `${state.members.length} listener${state.members.length === 1 ? '' : 's'}`;
  $('peopleCount').textContent = `${state.members.length} ${state.members.length === 1 ? 'person' : 'people'}`;
  $('queueCount').textContent = state.queue.length;
  const item = currentItem();
  $('currentTitle').textContent = item ? (item.title || `YouTube video · ${item.videoId}`) : 'Nothing playing yet';
  $('currentByline').textContent = item ? `Added by ${item.addedBy || 'a listener'}` : 'The next song is one link away';
  $('equalizer').classList.toggle('paused', !state.isPlaying);
  $('syncStatus').innerHTML = `<i></i> ${state.isPlaying ? 'Sync active' : 'Sync ready'}`;
  $('peopleList').innerHTML = state.members.map(m => `<div class="person-chip"><span class="avatar">${escapeHtml((m.name || '?').slice(0,1).toUpperCase())}</span>${escapeHtml(m.name)}${m.id === socket.id ? ' (you)' : ''}</div>`).join('');
  if (!state.queue.length) $('queueList').innerHTML = '<div class="empty-queue"><span>♫</span><strong>Your queue is waiting</strong><p>Paste a link above and start the party.</p></div>';
  else $('queueList').innerHTML = state.queue.map((q, i) => `<div class="queue-item ${i === state.currentIndex ? 'active' : ''}" draggable="true" data-id="${q.id}" data-index="${i}"><span class="queue-number">${i === state.currentIndex ? '♫' : String(i + 1).padStart(2,'0')}</span><img class="queue-thumb" src="https://i.ytimg.com/vi/${q.videoId}/mqdefault.jpg" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><div class="queue-meta"><strong>${escapeHtml(q.title || `YouTube video · ${q.videoId}`)}</strong><span>${i === state.currentIndex ? 'NOW PLAYING' : `Added by ${escapeHtml(q.addedBy || 'listener')}`}</span></div><div class="queue-actions"><button data-action="up" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button><button data-action="down" title="Move down" ${i === state.queue.length - 1 ? 'disabled' : ''}>↓</button><button data-action="remove" class="remove" title="Remove song">×</button></div></div>`).join('');
  $('prevBtn').disabled = state.queue.length < 2; $('nextBtn').disabled = state.queue.length < 2;
}
function updateTransport() {
  const playing = state?.isPlaying && currentItem();
  $('playBtn').textContent = playing ? 'Ⅱ' : '▶';
  $('playBtn').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('equalizer').classList.toggle('paused', !playing);
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

$('joinForm').addEventListener('submit', e => { e.preventDefault(); displayName = $('nameInput').value.trim() || 'Listener'; const requestedCode = $('roomInput').value.trim(); socket.emit('room:join', { code: requestedCode || 'NEW', name: displayName }); });
socket.on('room:joined', data => { roomCode = data.code; history.replaceState({}, '', `/?room=${encodeURIComponent(roomCode)}`); joinView.classList.add('hidden'); roomView.classList.remove('hidden'); applyRoomState(data.state); toast(`You're in room ${roomCode}`); });
socket.on('room:state', applyRoomState);
socket.on('app:error', message => toast(message, true)); socket.on('app:notice', toast);
socket.on('connect', () => { $('syncStatus').innerHTML = '<i></i> Connected'; });
socket.on('disconnect', () => { $('syncStatus').innerHTML = '<i></i> Reconnecting…'; toast('Connection lost — trying to reconnect.', true); });

$('addForm').addEventListener('submit', e => { e.preventDefault(); const url = $('youtubeUrl').value.trim(); if (!url) return; socket.emit('queue:add', { url }); $('youtubeUrl').value = ''; $('youtubeUrl').blur(); });
$('queueList').addEventListener('click', e => { const btn = e.target.closest('button[data-action]'); const itemEl = e.target.closest('.queue-item'); if (!btn || !itemEl || !state) return; const index = Number(itemEl.dataset.index), id = itemEl.dataset.id; const action = btn.dataset.action; if (action === 'remove') socket.emit('queue:remove', { id }); else if (action === 'up' && index > 0) socket.emit('queue:move', { id, to: index - 1 }); else if (action === 'down' && index < state.queue.length - 1) socket.emit('queue:move', { id, to: index + 1 }); });
let draggedId = null;
$('queueList').addEventListener('dragstart', e => { const row = e.target.closest('.queue-item'); if (!row) return; draggedId = row.dataset.id; e.dataTransfer.effectAllowed = 'move'; });
$('queueList').addEventListener('dragover', e => { if (e.target.closest('.queue-item')) e.preventDefault(); });
$('queueList').addEventListener('drop', e => { e.preventDefault(); const target = e.target.closest('.queue-item'); if (!target || !draggedId) return; socket.emit('queue:move', { id: draggedId, to: Number(target.dataset.index) }); draggedId = null; });
$('playBtn').addEventListener('click', () => { if (!currentItem()) return toast('Add a YouTube link first.'); if (!playerReady) return toast('Player is still loading — try again in a moment.'); const playing = playerStateCode() === 1; command(playing ? 'pause' : 'play'); });
$('nextBtn').addEventListener('click', () => command('next')); $('prevBtn').addEventListener('click', () => command('previous'));
$('seekBar').addEventListener('pointerdown', () => { isSeeking = true; }); $('seekBar').addEventListener('pointerup', () => { isSeeking = false; const p = localDuration * (Number($('seekBar').value) / 1000); command('seek', { position: p }); }); $('seekBar').addEventListener('change', () => { if (!isSeeking && localDuration) command('seek', { position: localDuration * Number($('seekBar').value) / 1000 }); });
$('inviteBtn').addEventListener('click', async () => { const url = `${location.origin}/?room=${encodeURIComponent(roomCode)}`; try { await navigator.clipboard.writeText(url); toast('Invite link copied!'); } catch { prompt('Copy this invite link:', url); } });
$('copyCodeBtn').addEventListener('click', async () => { try { await navigator.clipboard.writeText(roomCode); toast('Room code copied!'); } catch { prompt('Copy this room code:', roomCode); } });
$('leaveBtn').addEventListener('click', () => { location.href = '/'; }); $('clearInputBtn').addEventListener('click', () => $('youtubeUrl').focus());

window.onYouTubeIframeAPIReady = function() {
  player = new YT.Player('player', { width: '100%', height: '100%', videoId: '', playerVars: { playsinline: 1, rel: 0, origin: location.origin }, events: {
    onReady: () => { playerReady = true; $('syncStatus').innerHTML = '<i></i> Player ready'; if (state) applyRoomState(state); },
    onStateChange: event => {
      if (applyingRemote || !state) return;
      if (event.data === YT.PlayerState.PLAYING) { localDuration = player.getDuration() || localDuration; localPosition = player.getCurrentTime() || 0; if (!state.isPlaying && Date.now() - lastActionAt > 1200) command('play', { position: localPosition }); }
      else if (event.data === YT.PlayerState.PAUSED && state.isPlaying && Date.now() - lastActionAt > 1200) command('pause', { position: player.getCurrentTime() || 0 });
      else if (event.data === YT.PlayerState.ENDED) socket.emit('playback:ended', { videoId: currentItem()?.videoId });
    },
    onError: event => { const messages = {2:'Invalid YouTube video ID.',5:'This video could not be played in the embedded player.',100:'Video not found or removed.',101:'The owner does not allow this video to be embedded.',150:'The owner does not allow this video to be embedded.'}; toast(messages[event.data] || 'YouTube could not play this video.', true); }
  }});
};
setInterval(() => {
  if (!state || !playerReady) return;
  try {
    const pos = player.getCurrentTime?.() || 0; const dur = player.getDuration?.() || 0;
    localPosition = pos; if (dur > 0) localDuration = dur;
    if (!isSeeking) $('seekBar').value = dur > 0 ? Math.round(pos / dur * 1000) : 0;
    $('currentTime').textContent = fmt(pos); $('durationTime').textContent = fmt(dur);
    const item = currentItem(); if (item && player.getVideoData) { const title = player.getVideoData()?.title; if (title && $('currentTitle').textContent !== title) $('currentTitle').textContent = title; }
  } catch {}
}, 600);
const params = new URLSearchParams(location.search); const inviteCode = params.get('room'); if (inviteCode) $('roomInput').value = inviteCode;
