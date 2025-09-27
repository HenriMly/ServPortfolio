const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const WIDTH = 800;
const HEIGHT = 600;

let players = {};
let asteroids = [];
let nextAsteroidId = 1;
const ASTEROID_SPEED = 2;

// Leaderboard top 5
let leaderboard = [];

// Fonction pour créer un nouvel astéroïde
function spawnAsteroid() {
  asteroids.push({
    id: nextAsteroidId++,
    x: Math.random() * (WIDTH - 30),
    y: -30,
    w: 30,
    h: 30
  });
}

// Vérification collisions
function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

// Endpoint pour récupérer leaderboard (optionnel)
app.get("/leaderboard", (req, res) => {
  res.json(leaderboard);
});

io.on("connection", (socket) => {
  console.log("Nouvelle connexion:", socket.id);

  // Quand le joueur clique "Start"
  socket.on("startGame", (name) => {
    players[socket.id] = {
      id: socket.id,
      x: WIDTH / 2 - 25,
      y: HEIGHT - 60,
      w: 50,
      h: 50,
      score: 0,
      alive: true,
      name: name || "Player"
    };
  });

  // Réception des inputs
  socket.on("input", (data) => {
    if (players[socket.id]) {
      players[socket.id].input = data;
    }
  });

  // Déconnexion
  socket.on("disconnect", () => {
    console.log("Déconnexion:", socket.id);
    const p = players[socket.id];
    if (p) {
      leaderboard.push({
        id: p.id,
        name: p.name || "Player",
        score: Math.floor(p.score / 20)
      });
      leaderboard.sort((a, b) => b.score - a.score);
      leaderboard = leaderboard.slice(0, 5); // garder top 5
    }
    delete players[socket.id];
  });
});

// Boucle principale du jeu
setInterval(() => {
  // 1) Update players
  Object.values(players).forEach((p) => {
    if (!p.alive) return;
    const input = p.input || {};
    if (input.left) p.x -= 6;
    if (input.right) p.x += 6;
    if (p.x < 0) p.x = 0;
    if (p.x > WIDTH - p.w) p.x = WIDTH - p.w;
    p.score++;
  });

  // 2) Asteroids movement
  asteroids.forEach((a) => (a.y += ASTEROID_SPEED));

  // 3) Collisions
  Object.values(players).forEach((p) => {
    asteroids.forEach((a) => {
      if (p.alive && rectsOverlap(p, a)) {
        p.alive = false;
      }
    });
  });

  // 4) Remove asteroids out of screen
  asteroids = asteroids.filter((a) => a.y < HEIGHT + 50);

  // 5) Spawn new asteroids
  if (Math.random() < 0.03) spawnAsteroid();

  // 6) Emit state to all clients
  io.emit("state", { players, asteroids, leaderboard });
}, 50);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log("✅ Server running on port", PORT));
