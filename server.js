const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path"); // <--- NUEVO: Para manejar rutas
const QUESTIONS = require("./questions");

const app = express();
const server = http.createServer(app);

// <--- MEJORA: Configuración CORS para evitar bloqueos en producción
const io = new Server(server, {
  cors: {
    origin: "*", // En producción idealmente pon tu dominio real, pero "*" funciona para probar
    methods: ["GET", "POST"]
  }
});

const fs = require('fs'); // <--- Agrega esto arriba del todo con los otros require

// ... resto del código ...

app.use(express.static(path.join(__dirname, 'public')));

// CÓDIGO DE DIAGNÓSTICO
app.get('/', (req, res) => {
  const rutaArchivo = path.join(__dirname, 'public', 'index.html');
  
  // Verificamos si el archivo realmente existe
  if (fs.existsSync(rutaArchivo)) {
    res.sendFile(rutaArchivo);
  } else {
    // Si falla, imprimimos en pantalla dónde está el servidor buscando
    res.send(`
      <h1>Error 404 - Archivo no encontrado</h1>
      <p>El servidor está buscando en: <strong>${rutaArchivo}</strong></p>
      <p>La carpeta actual del servidor (__dirname) es: <strong>${__dirname}</strong></p>
      <p>Revisa en tu Gestor de Archivos si esa ruta es REALMENTE correcta.</p>
    `);
  }
});

// ... resto del código ...

const rooms = {};

const WRONG_PENALTY = 2;
const TIME_PER_PLAYER = 180;
const REVEAL_MS = 2000;

/* =========================
   HELPERS
========================= */
// ... (Tus funciones helpers están perfectas, déjalas igual) ...
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
// ... (Toda tu lógica de sockets está bien, déjala igual) ...
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
        started: false, finished: false, paused: false,
        turn: 0, letterIndex: 0, letters, questions,
        results: {}, passed: {},
        timer: [TIME_PER_PLAYER, TIME_PER_PLAYER],
        reveal: null
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
      const next = getNextPendingIndex(g, idx);
      if (next === null) g.finished = true;
      else g.letterIndex = next;
      emit(roomId);
      return;
    }

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
      if (next === null) game.finished = true;
      else game.letterIndex = next;
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
    if (next === null) g.finished = true;
    else {
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
    emit(roomId); // Optimización: Solo emitir si cambió el segundo
  });
}, 1000);

/* =========================
   SERVER
========================= */
// <--- CAMBIO CRÍTICO: Usar process.env.PORT
const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`🚀 Servidor en puerto ${port}`);
});