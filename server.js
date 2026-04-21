const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── In-memory state ──────────────────────────────────────────────────
let state = {
  tables: [],      // { id, name, dealerName, seats: [{ position, playerName, score, eliminated }] }
  players: [],     // { name, totalScore, knockouts, tablesPlayed }
  sessionName: 'Poker Night',
  dealerPin: '1234',
};

function leaderboard() {
  // Build leaderboard from all tables
  const map = {};
  for (const t of state.tables) {
    for (const s of t.seats) {
      if (!s.playerName) continue;
      if (!map[s.playerName]) {
        map[s.playerName] = { name: s.playerName, totalScore: 0, knockouts: 0, tablesPlayed: 0, eliminated: false };
      }
      map[s.playerName].totalScore += s.score || 0;
      map[s.playerName].knockouts += s.knockouts || 0;
      map[s.playerName].tablesPlayed += 1;
      if (s.eliminated) map[s.playerName].eliminated = true;
    }
  }
  return Object.values(map).sort((a, b) => b.totalScore - a.totalScore);
}

function broadcast() {
  const payload = {
    tables: state.tables,
    leaderboard: leaderboard(),
    sessionName: state.sessionName,
  };
  io.emit('state', payload);
}

// ── Socket.IO ────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  // Send current state on connect
  socket.emit('state', {
    tables: state.tables,
    leaderboard: leaderboard(),
    sessionName: state.sessionName,
  });

  // Admin: set session name
  socket.on('setSessionName', (name) => {
    state.sessionName = name || 'Poker Night';
    broadcast();
  });

  // Admin: set dealer pin
  socket.on('setDealerPin', (pin) => {
    state.dealerPin = pin || '1234';
  });

  // Admin: add table
  socket.on('addTable', ({ name, seatCount, dealerName }) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const seats = [];
    for (let i = 0; i < (seatCount || 8); i++) {
      seats.push({ position: i + 1, playerName: '', score: 0, knockouts: 0, eliminated: false });
    }
    state.tables.push({ id, name: name || `Table ${state.tables.length + 1}`, dealerName: dealerName || '', seats });
    broadcast();
  });

  // Admin: remove table
  socket.on('removeTable', (tableId) => {
    state.tables = state.tables.filter(t => t.id !== tableId);
    broadcast();
  });

  // Admin: reset everything
  socket.on('resetAll', () => {
    state.tables = [];
    state.sessionName = 'Poker Night';
    broadcast();
  });

  // Dealer: authenticate
  socket.on('dealerAuth', (pin, cb) => {
    cb({ success: pin === state.dealerPin });
  });

  // Dealer: seat a player
  socket.on('seatPlayer', ({ tableId, position, playerName }) => {
    const table = state.tables.find(t => t.id === tableId);
    if (!table) return;
    const seat = table.seats.find(s => s.position === position);
    if (!seat) return;
    seat.playerName = playerName;
    seat.score = 0;
    seat.knockouts = 0;
    seat.eliminated = false;
    broadcast();
  });

  // Dealer: unseat a player
  socket.on('unseatPlayer', ({ tableId, position }) => {
    const table = state.tables.find(t => t.id === tableId);
    if (!table) return;
    const seat = table.seats.find(s => s.position === position);
    if (!seat) return;
    seat.playerName = '';
    seat.score = 0;
    seat.knockouts = 0;
    seat.eliminated = false;
    broadcast();
  });

  // Dealer: update score
  socket.on('updateScore', ({ tableId, position, score }) => {
    const table = state.tables.find(t => t.id === tableId);
    if (!table) return;
    const seat = table.seats.find(s => s.position === position);
    if (!seat) return;
    seat.score = Number(score) || 0;
    broadcast();
  });

  // Dealer: add to score (increment/decrement)
  socket.on('addScore', ({ tableId, position, amount }) => {
    const table = state.tables.find(t => t.id === tableId);
    if (!table) return;
    const seat = table.seats.find(s => s.position === position);
    if (!seat) return;
    seat.score = (seat.score || 0) + (Number(amount) || 0);
    broadcast();
  });

  // Dealer: update knockouts
  socket.on('updateKnockouts', ({ tableId, position, knockouts }) => {
    const table = state.tables.find(t => t.id === tableId);
    if (!table) return;
    const seat = table.seats.find(s => s.position === position);
    if (!seat) return;
    seat.knockouts = Number(knockouts) || 0;
    broadcast();
  });

  // Dealer: eliminate player
  socket.on('eliminatePlayer', ({ tableId, position }) => {
    const table = state.tables.find(t => t.id === tableId);
    if (!table) return;
    const seat = table.seats.find(s => s.position === position);
    if (!seat) return;
    seat.eliminated = !seat.eliminated;
    broadcast();
  });

  // Dealer: update table name / dealer name
  socket.on('updateTable', ({ tableId, name, dealerName }) => {
    const table = state.tables.find(t => t.id === tableId);
    if (!table) return;
    if (name !== undefined) table.name = name;
    if (dealerName !== undefined) table.dealerName = dealerName;
    broadcast();
  });

  // Display: reorder tables (drag and drop)
  socket.on('reorderTables', (orderedIds) => {
    if (!Array.isArray(orderedIds)) return;
    const reordered = [];
    for (const id of orderedIds) {
      const t = state.tables.find(t => t.id === id);
      if (t) reordered.push(t);
    }
    // append any tables not in the list (safety)
    for (const t of state.tables) {
      if (!reordered.includes(t)) reordered.push(t);
    }
    state.tables = reordered;
    broadcast();
  });
});

// ── Start ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n♠♥♣♦  Poker Club is live!  ♦♣♥♠`);
  console.log(`\n  Display screen:  http://localhost:${PORT}/display.html`);
  console.log(`  Dealer phone:    http://localhost:${PORT}/dealer.html`);
  console.log(`  Admin setup:     http://localhost:${PORT}/admin.html`);
  console.log(`\n  Default dealer PIN: 1234`);
  console.log(`\n  To access from phones on the same Wi-Fi,`);
  console.log(`  use your computer's local IP instead of localhost.\n`);
});
