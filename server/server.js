const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path"); // <--- IMPORTANTE: Necesario para las rutas en Hostinger
const QUESTIONS = require("./questions");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- CORRECCIÓN DE RUTA ---
// Usamos path.join para asegurar que encuentre la carpeta 'public'
// Asumiendo que subiste la carpeta 'public' al mismo nivel que server.js
app.use(express.static(path.join(__dirname, 'public')));


// Si tienes la carpeta public 'atrás' (como en tu local), usa esta línea en su lugar:
// app.use(express.static(path.join(__dirname, '../public')));
// Pero te recomiendo subir 'public' junto a 'server.js' en la misma carpeta raíz.

const rooms = {};

const WRONG_PENALTY = 2;
const TIME_PER_PLAYER = 180;
const REVEAL_MS = 2000;

/* =========================
   HELPERS
========================= */

function generateRoomId() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function getRandomQuestion(letter) {
  const list = QUESTIONS[letter];
  return list[Math.floor(Math.random() * list.length)];
}

function getNextPendingIndex(game, from) {
  const total = game.letters.length;
  for (let i = 1; i <= total; i++) {
    const idx = (from + i) % total;
    if (!game.results[idx]) return idx;
  }
  return null;
}

function emit(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  io.to(roomId).emit("game-update", {
    players: room.players,
    game: room.game
  });
}

/* =========================
   SOCKETS
========================= */

io.on("connection", socket => {
  console.log("🟢 Conectado:", socket.id);

  socket.on("create-room", ({ name }) => {
    const roomId = generateRoomId();
    const letters = Object.keys(QUESTIONS);

    const questions = {};
    letters.forEach(l => (questions[l] = getRandomQuestion(l)));

    rooms[roomId] = {
      players: [{ id: socket.id, name, score: 0 }],
      game: {
        started: false,
        finished: false,
        paused: false,

        turn: 0,
        letterIndex: 0,
        letters,
        questions,

        results: {},   // correct / wrong
        passed: {},    // visual only

        timer: [TIME_PER_PLAYER, TIME_PER_PLAYER],

        reveal: null  // { index, answer }
      }
    };

    socket.join(roomId);
    socket.emit("room-created", roomId);
  });

  socket.on("join-room", ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit("error-msg", "Sala inexistente");
    if (room.players.length >= 2) return socket.emit("error-msg", "Sala llena");

    room.players.push({ id: socket.id, name, score: 0 });
    room.game.started = true;

    socket.join(roomId);
    emit(roomId);
  });

  socket.on("answer", ({ roomId, answer }) => {
    const room = rooms[roomId];
    if (!room) return;

    const g = room.game;
    if (g.finished || g.paused) return;

    const player = room.players[g.turn];
    if (player.id !== socket.id) return;

    const idx = g.letterIndex;
    const letter = g.letters[idx];
    const q = g.questions[letter];

    const ok = answer.trim().toUpperCase() === q.answer.toUpperCase();

    if (ok) {

      g.results[idx] = "correct";
      player.score += 1;
      delete g.passed[idx];

      // 🔹 NUEVO: mostrar respuesta también cuando es correcta
      g.paused = true;
      g.reveal = {
        index: idx,
        answer: q.answer,
        correct: true
      };

      emit(roomId);

      setTimeout(() => {
        const r = rooms[roomId];
        if (!r) return;

        const game = r.game;
        game.paused = false;
        game.reveal = null;

        const next = getNextPendingIndex(game, idx);

        if (next === null) {
          game.finished = true;
        } else {
          game.letterIndex = next;
        }

        emit(roomId);
      }, REVEAL_MS);

      return;
    }


    // ❌ incorrecta
    g.results[idx] = "wrong";
    player.score = Math.max(0, player.score - WRONG_PENALTY);
    delete g.passed[idx];

    g.paused = true;
    g.reveal = { index: idx, answer: q.answer };

    g.turn = (g.turn + 1) % room.players.length;

    emit(roomId);

    setTimeout(() => {
      const r = rooms[roomId];
      if (!r) return;

      const game = r.game;
      game.paused = false;
      game.reveal = null;

      const next = getNextPendingIndex(game, idx);
      if (next === null) {
        game.finished = true;
      } else {
        game.letterIndex = next;
      }

      emit(roomId);
    }, REVEAL_MS);
  });

  socket.on("pasapalabra", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    const g = room.game;
    if (g.finished || g.paused) return;

    const idx = g.letterIndex;
    g.passed[idx] = true;

    const next = getNextPendingIndex(g, idx);
    if (next === null) {
      g.finished = true;
    } else {
      g.letterIndex = next;
      g.turn = (g.turn + 1) % room.players.length;
    }

    emit(roomId);
  });
});

/* =========================
   TIMER
========================= */

setInterval(() => {
  Object.entries(rooms).forEach(([roomId, room]) => {
    const g = room.game;
    if (!g.started || g.finished || g.paused) return;

    if (g.timer[g.turn] > 0) g.timer[g.turn]--;

    if (g.timer[g.turn] <= 0) {
      const other = (g.turn + 1) % room.players.length;
      if (g.timer[other] > 0) g.turn = other;
    }

    if (g.timer.every(t => t <= 0)) {
      g.finished = true;
    }

    emit(roomId);
  });
}, 1000);

/* =========================
   SERVER
========================= */

// --- CORRECCIÓN DE PUERTO ---
// Hostinger asigna el puerto en process.env.PORT. 
// Si pones solo 3000 fallará.
const port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log(`🚀 Servidor corriendo en puerto ${port}`);
});