// Serveur de scores du Space Invaders du portfolio.
//
// Variables d'environnement :
//   PORT             port d'écoute (3001 par défaut)
//   ALLOWED_ORIGINS  sites autorisés à appeler l'API, séparés par des virgules
//                    (http://localhost:3000 par défaut, à remplacer par l'adresse du portfolio en ligne)
//   SCORES_FILE      fichier où le classement est sauvegardé (scores.json par défaut)
//   TRUST_PROXY      mettre 1 si le serveur est derrière un proxy (Render, Railway...),
//                    sinon tous les visiteurs partagent la même limite de requêtes
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3001;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:3000").split(",").map((origin) => origin.trim());
const SCORES_FILE = process.env.SCORES_FILE || path.join(__dirname, "scores.json");

const LEADERBOARD_SIZE = 10;
const NAME_MAX_LENGTH = 12;
const GAME_TTL_MS = 60 * 60 * 1000;
const MAX_PENDING_GAMES = 1000;
const MAX_POSTS_PER_MINUTE = 20;

// Anti-triche : une vague vaut 630 points et demande au moins 15 s (35 tirs espacés de 0,4 s),
// soit 42 points par seconde au maximum. Voir FIRE_COOLDOWN et POINTS dans src/game/engine.js du portfolio.
const MAX_POINTS_PER_SECOND = 45;
const SCORE_MARGIN = 300;

const app = express();
app.set("trust proxy", Number(process.env.TRUST_PROXY) || 0);
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({ limit: "1kb" }));

// ---- Classement, sauvegardé sur disque pour survivre aux redémarrages ----

function loadLeaderboard() {
  try {
    const data = JSON.parse(fs.readFileSync(SCORES_FILE, "utf8"));
    return Array.isArray(data) ? data.slice(0, LEADERBOARD_SIZE) : [];
  } catch {
    return []; // pas encore de fichier, ou fichier illisible
  }
}

function saveLeaderboard() {
  // Écriture dans un fichier temporaire puis renommage : jamais de fichier à moitié écrit
  try {
    fs.writeFileSync(`${SCORES_FILE}.tmp`, JSON.stringify(leaderboard, null, 2));
    fs.renameSync(`${SCORES_FILE}.tmp`, SCORES_FILE);
  } catch (error) {
    console.error("Sauvegarde du classement impossible :", error.message);
  }
}

let leaderboard = loadLeaderboard();

// ---- Parties en cours : identifiant -> heure de début ----

const games = new Map();

function purgeGames() {
  const now = Date.now();
  // Une Map garde l'ordre d'insertion : les plus anciennes parties sont en premier
  for (const [gameId, startedAt] of games) {
    if (now - startedAt < GAME_TTL_MS && games.size < MAX_PENDING_GAMES) break;
    games.delete(gameId);
  }
}

// ---- Limite de requêtes par adresse IP ----

const hits = new Map();

function rateLimit(req, res, next) {
  const now = Date.now();
  const entry = hits.get(req.ip);
  if (!entry || now > entry.resetAt) {
    hits.set(req.ip, { count: 1, resetAt: now + 60 * 1000 });
    return next();
  }
  entry.count += 1;
  if (entry.count > MAX_POSTS_PER_MINUTE) {
    return res.status(429).json({ error: "Trop de requêtes, réessaie dans une minute." });
  }
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of hits) {
    if (now > entry.resetAt) hits.delete(ip);
  }
}, 60 * 1000).unref();

// Le pseudo ne garde que lettres, chiffres, espaces, tirets et underscores
function cleanName(name) {
  const cleaned = (typeof name === "string" ? name : "")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim()
    .slice(0, NAME_MAX_LENGTH)
    .trim();
  return cleaned || "Anonyme";
}

// ---- Routes ----

app.get("/", (req, res) => {
  res.json({ service: "Serveur de scores du portfolio", status: "ok" });
});

app.get("/api/scores", (req, res) => {
  res.json({ leaderboard });
});

// Début de partie : le serveur note l'heure, l'identifiant servira à valider le score
app.post("/api/games", rateLimit, (req, res) => {
  purgeGames();
  const gameId = crypto.randomUUID();
  games.set(gameId, Date.now());
  res.status(201).json({ gameId });
});

// Fin de partie : envoi du score
app.post("/api/scores", rateLimit, (req, res) => {
  const { gameId, name, score } = req.body || {};
  const startedAt = typeof gameId === "string" ? games.get(gameId) : undefined;
  if (!startedAt || Date.now() - startedAt > GAME_TTL_MS) {
    return res.status(409).json({ error: "Partie inconnue ou expirée." });
  }
  if (!Number.isInteger(score) || score < 1) {
    return res.status(400).json({ error: "Score invalide." });
  }
  const seconds = (Date.now() - startedAt) / 1000;
  if (score > seconds * MAX_POINTS_PER_SECOND + SCORE_MARGIN) {
    return res.status(400).json({ error: "Score impossible pour la durée de la partie." });
  }
  games.delete(gameId); // une partie ne donne qu'un seul score

  const entry = { name: cleanName(name), score, date: new Date().toISOString() };
  leaderboard.push(entry);
  leaderboard.sort((a, b) => b.score - a.score);
  leaderboard = leaderboard.slice(0, LEADERBOARD_SIZE);
  saveLeaderboard();

  const rank = leaderboard.indexOf(entry) + 1; // 0 si le score n'entre pas dans le classement
  res.status(201).json({ leaderboard, rank: rank || null });
});

app.use((req, res) => {
  res.status(404).json({ error: "Route inconnue." });
});

// JSON mal formé ou corps trop gros
app.use((error, req, res, next) => {
  if (error.type === "entity.parse.failed" || error.type === "entity.too.large") {
    return res.status(400).json({ error: "Requête invalide." });
  }
  console.error(error);
  res.status(500).json({ error: "Erreur serveur." });
});

app.listen(PORT, () => console.log(`Serveur de scores démarré sur le port ${PORT}`));
