const socket = io();

let currentRoom = null;
const letters = "ABCDEFGHIJKLMNÑOPQRSTUVXYZ".split("");

// =========================
// ESTADO GLOBAL
// =========================
let roscoCreated = false;
let lastPlayedKey = null;
let lastSpokenKey = null;

let audioUnlocked = false;
let musicStarted = false;
let isMuted = false;

// =========================
// ELEMENTOS (asegurate que existan en el HTML)
// =========================
const lobby = document.getElementById("lobby");
const game = document.getElementById("game");
const info = document.getElementById("info");

const turn = document.getElementById("turn");
const questionElem = document.getElementById("question");
const scoreboard = document.getElementById("scoreboard");
const currentLetter = document.getElementById("currentLetter");

const answer = document.getElementById("answer");
const btnAnswer = document.getElementById("btnAnswer");
const btnPass = document.getElementById("btnPass");
const btnMute = document.getElementById("btnMute");

const playerName = document.getElementById("name");
const roomInput = document.getElementById("room");
const btnJoin = document.getElementById("btnJoin");

// Texto debajo de la pregunta para feedback (respuesta correcta)
let feedback = document.getElementById("feedback");
if (!feedback && questionElem) {
    feedback = document.createElement("p");
    feedback.id = "feedback";
    feedback.style.margin = "10px 0 0";
    feedback.style.fontWeight = "800";
    feedback.style.minHeight = "24px";
    questionElem.insertAdjacentElement("afterend", feedback);
}

// =========================
// SONIDOS + MUSICA
// =========================

const SOUND_VOLUMES = {
    correct: 0.1,
    wrong: 0.7,
    pass: 0.6
};

const sounds = {
    correct: new Audio("sounds/correct.mp3"),
    wrong: new Audio("sounds/wrong.mp3"),
    pass: new Audio("sounds/pass.mp3")
};

sounds.correct.volume = SOUND_VOLUMES.correct;
sounds.wrong.volume = SOUND_VOLUMES.wrong;
sounds.pass.volume = SOUND_VOLUMES.pass;


Object.values(sounds).forEach(s => { s.preload = "auto"; });

const backgroundMusic = new Audio("sounds/background.mp3");
backgroundMusic.loop = true;
backgroundMusic.volume = 0.12;
backgroundMusic.preload = "auto";

// =========================
// AUDIO UNLOCK
// =========================
function unlockAudio() {
    if (audioUnlocked) return;

    Object.entries(sounds).forEach(([key, sound]) => {
        const vol = SOUND_VOLUMES[key];
        sound.volume = 0;
        sound.play().then(() => {
            sound.pause();
            sound.currentTime = 0;
            sound.volume = vol; // ✅ vuelve al volumen correcto
        }).catch(() => { });
    });

    backgroundMusic.volume = 0;
    backgroundMusic.play().then(() => {
        backgroundMusic.pause();
        backgroundMusic.currentTime = 0;
        backgroundMusic.volume = 0.12;
    }).catch(() => { });

    audioUnlocked = true;
}


// =========================
// TTS (Voz)
// =========================
function stopSpeaking() {
    try { window.speechSynthesis.cancel(); } catch (_) { }
}

function speak(text) {
    if (isMuted) return;
    if (!audioUnlocked) return;
    if (!("speechSynthesis" in window)) return;
    if (!text || !text.trim()) return;

    stopSpeaking();

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "es-AR";
    utter.rate = 0.95;
    utter.pitch = 1;
    utter.volume = 1;

    window.speechSynthesis.speak(utter);
}

// =========================
// MUTE
// =========================
if (btnMute) {
    btnMute.addEventListener("click", toggleMute);
}

function toggleMute() {
    isMuted = !isMuted;

    Object.values(sounds).forEach(s => s.muted = isMuted);

    if (isMuted) {
        backgroundMusic.pause();
        stopSpeaking();
        if (btnMute) btnMute.innerText = "🔇 Mute";
    } else {
        if (musicStarted && audioUnlocked) backgroundMusic.play().catch(() => { });
        if (btnMute) btnMute.innerText = "🔊 Sonido";
    }
}

// =========================
// INPUTS / BOTONES
// =========================
answer?.addEventListener("input", () => {
    // el render luego decide si además se deshabilita por turno/pausa
    btnAnswer.disabled = answer.value.trim().length === 0;
});

answer?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        if (!btnAnswer.disabled) sendAnswer();
    }
});

playerName?.addEventListener("input", updateJoinButtonState);
roomInput?.addEventListener("input", updateJoinButtonState);
updateJoinButtonState();

function updateJoinButtonState() {
    if (!btnJoin) return;
    const hasName = playerName?.value?.trim().length > 0;
    const hasRoom = roomInput?.value?.trim().length > 0;
    btnJoin.disabled = !(hasName && hasRoom);
}

// =========================
// ACCIONES (expuestas para onclick del HTML)
// =========================
function createRoom() {
    unlockAudio();
    if (!playerName.value.trim()) return alert("Ingresá tu nombre");

    socket.emit("create-room", { name: playerName.value.trim() });
}

function joinRoom() {
    unlockAudio();
    if (!playerName.value.trim() || !roomInput.value.trim()) {
        return alert("Nombre y código requeridos");
    }

    socket.emit("join-room", {
        roomId: roomInput.value.toUpperCase(),
        name: playerName.value.trim(),
    });
}

function sendAnswer() {
    if (!currentRoom) return;

    socket.emit("answer", {
        roomId: currentRoom,
        answer: answer.value.trim(),
    });

    answer.value = "";
    btnAnswer.disabled = true;
}

function pasapalabra() {
    if (!currentRoom) return;

    if (!isMuted) {
        sounds.pass.currentTime = 0;
        sounds.pass.play().catch(() => { });
    }

    socket.emit("pasapalabra", { roomId: currentRoom });
}

// Hacer disponibles para onclick (si tu HTML usa onclick="")
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.sendAnswer = sendAnswer;
window.pasapalabra = pasapalabra;

// =========================
// SOCKET EVENTS
// =========================
socket.on("room-created", (roomId) => {
    currentRoom = roomId;
    info.innerHTML = `
    <strong>Sala creada</strong><br>
    Código: <span style="font-size:22px">${roomId}</span><br>
    Esperando al segundo jugador...
  `;
});

socket.on("game-update", (data) => {
    // segundo jugador: fijar room si todavía no la tenemos
    if (!currentRoom && roomInput?.value) currentRoom = roomInput.value.toUpperCase();

    // música: arrancar cuando started = true
    if (!musicStarted && data.game.started && audioUnlocked && !isMuted) {
        backgroundMusic.currentTime = 0;
        backgroundMusic.play().catch(() => { });
        musicStarted = true;
    }

    lobby.classList.add("hidden");
    game.classList.remove("hidden");

    render(data);
});

socket.on("error-msg", (msg) => alert(msg));

// =========================
// ROSCO
// =========================
function createRosco() {
    const rosco = document.getElementById("rosco");
    if (!rosco) return;
    rosco.innerHTML = "";

    const radius = 140;
    const center = 160;

    letters.forEach((letter, index) => {
        const angle = (index / letters.length) * 2 * Math.PI - Math.PI / 2;
        const x = center + radius * Math.cos(angle) - 18;
        const y = center + radius * Math.sin(angle) - 18;

        const el = document.createElement("div");
        el.className = "rosco-letter";
        el.innerText = letter;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.dataset.index = index;

        rosco.appendChild(el);
    });
}

function updateRosco(letterIndex, results = {}, passed = {}) {
    document.querySelectorAll(".rosco-letter").forEach((el) => {
        el.classList.remove("active", "correct", "wrong", "pass");

        const idx = Number(el.dataset.index);

        if (passed && passed[idx]) el.classList.add("pass");
        if (results && results[idx]) el.classList.add(results[idx]);
    });

    const active = document.querySelector(`.rosco-letter[data-index="${letterIndex}"]`);
    if (active) active.classList.add("active");

    currentLetter.innerText = letters[letterIndex] || "";
}

// =========================
// SCOREBOARD
// =========================
function renderScoreboard(players, gameState) {
    if (!scoreboard) return;
    scoreboard.innerHTML = "";

    players.forEach((p, i) => {
        const div = document.createElement("div");
        div.className = "player-score" + (i === gameState.turn ? " active" : "");

        div.innerHTML = `
      <div class="player-name">${p.name}</div>
      <div class="player-points">${p.score} puntos</div>
      <div class="player-time">⏱️ ${Math.max(0, gameState.timer[i])}s</div>
    `;

        scoreboard.appendChild(div);
    });
}

// =========================
// SONIDOS correct/wrong (sin repetir por timer)
// =========================
function playResultSound(results = {}) {
    const keys = Object.keys(results);
    if (keys.length === 0) return;

    // último índice respondido: el mayor numérico
    const lastIndex = Math.max(...keys.map(Number));
    const res = results[lastIndex];
    const key = `${lastIndex}:${res}`;
    if (key === lastPlayedKey) return;
    lastPlayedKey = key;

    if (isMuted) return;

    if (res === "correct") {
        sounds.correct.currentTime = 0;
        sounds.correct.play().catch(() => { });
    } else if (res === "wrong") {
        sounds.wrong.currentTime = 0;
        sounds.wrong.play().catch(() => { });
    }
}

// =========================
// RENDER PRINCIPAL
// =========================
function render({ players, game: gameState }) {
    if (!roscoCreated) {
        createRosco();
        roscoCreated = true;
    }

    // Derivar SIEMPRE pregunta desde letterIndex (evita undefined/desfase)
    const idx = gameState.letterIndex;
    const letter = gameState.letters[idx];
    const q = gameState.questions?.[letter];

    const questionText = q?.question || "";
    const revealAnswer = gameState.paused && gameState.reveal?.answer ? gameState.reveal.answer : null;

    // Turno
    turn.innerText = "Turno de: " + (players[gameState.turn]?.name || "");

    // Pregunta / Feedback
    if (revealAnswer) {
        questionElem.innerHTML = `❌ Incorrecto`;
        if (feedback) {
            feedback.innerHTML = `Respuesta correcta: <strong>${revealAnswer}</strong>`;
            feedback.style.color = "#f44336";
        }
    } else {
        questionElem.innerText = questionText;
        if (feedback) {
            feedback.innerHTML = "";
            feedback.style.color = "";
        }

        // TTS solo si cambió la letra/pregunta (no en cada tick del timer)
        const speakKey = `${letter}|${questionText}`;
        if (!gameState.finished && questionText && speakKey !== lastSpokenKey) {
            lastSpokenKey = speakKey;
            speak(`Letra ${letter}. ${questionText}`);
        }
    }

    // Scoreboard
    renderScoreboard(players, gameState);

    // Rosco
    updateRosco(gameState.letterIndex, gameState.results, gameState.passed);

    // Sonidos correct/wrong
    playResultSound(gameState.results);

    // Bloqueos por turno / pausa / fin
    const myPlayer = players.find(p => p.id === socket.id);
    const isMyTurn = myPlayer && players[gameState.turn]?.id === socket.id;
    const freeze = gameState.paused;

    answer.disabled = freeze || !isMyTurn || gameState.finished;
    btnPass.disabled = freeze || !isMyTurn || gameState.finished;
    btnAnswer.disabled =
        freeze ||
        !isMyTurn ||
        gameState.finished ||
        answer.value.trim().length === 0;

    if (gameState.finished) {
        stopSpeaking();
        backgroundMusic.pause();
    }
}


document.addEventListener("DOMContentLoaded", () => {
    const nav = document.querySelector("nav");
    if (!nav) return;

    nav.addEventListener(
        "touchmove",
        e => {
            e.preventDefault();
        },
        { passive: false }
    );
});
