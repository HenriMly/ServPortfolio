// Serveur de scores du Space Invaders du portfolio.
//
// Variables d'environnement :
//   PORT             port d'écoute (3001 par défaut)
//   ALLOWED_ORIGINS  sites autorisés à appeler l'API, séparés par des virgules
//                    (http://localhost:3000 par défaut, à remplacer par l'adresse du portfolio en ligne)
//   UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN
//                    base de données où sont gardés le classement et les parties en cours.
//                    Indispensables en ligne : sans elles, tout est perdu à chaque redémarrage.
//   SCORES_FILE      sans base de données (en local), fichier où le classement est sauvegardé
//   TRUST_PROXY      mettre 1 si le serveur est derrière un proxy (Render, Railway...),
//                    sinon tous les visiteurs partagent la même limite de requêtes
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3001;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:3000").split(",").map((origin) => origin.trim());
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const SCORES_FILE = process.env.SCORES_FILE || path.join(__dirname, "scores.json");

const LEADERBOARD_SIZE = 10;
const NAME_MAX_LENGTH = 12;
const GAME_TTL_SECONDS = 60 * 60;
const MAX_POSTS_PER_MINUTE = 20;
const LEADERBOARD_KEY = "invaders:leaderboard";
const GAME_ID = /^[0-9a-f-]{36}$/;

// Anti-triche : le score ne peut pas dépasser ce qu'il est possible de marquer depuis l'ouverture
// de la partie. Même un robot parfait avec un bonus de tir permanent reste sous 40 points par
// seconde (mesuré par simulation). Voir les cadences de tir, POINTS et les bonus dans
// src/game/engine.js du portfolio.
const MAX_POINTS_PER_SECOND = 45;
const SCORE_MARGIN = 300;

// ---- Stockage ----
// En ligne : base Redis Upstash, qui survit aux redémarrages et aux mises en veille du serveur.
// En local : mémoire, avec le classement écrit dans un fichier.
// Les deux offrent get(clé), set(clé, valeur, duréeEnSecondes) et del(clé).

function storageError(message) {
  return Object.assign(new Error(`Stockage : ${message}`), { status: 503 });
}

function redisStore() {
  // Une commande Redis = une requête HTTP à l'API REST d'Upstash
  async function command(...args) {
    let response;
    try {
      response = await fetch(REDIS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      throw storageError(`base de données injoignable (${error.message})`);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw storageError(data.error || `réponse ${response.status}`);
    return data.result;
  }

  return {
    get: (key) => command("GET", key),
    set: (key, value, ttl) => (ttl ? command("SET", key, value, "EX", ttl) : command("SET", key, value)),
    del: (key) => command("DEL", key),
  };
}

function localStore() {
  const data = new Map(); // clé -> { value, expiresAt }
  try {
    data.set(LEADERBOARD_KEY, { value: fs.readFileSync(SCORES_FILE, "utf8"), expiresAt: 0 });
  } catch {
    // pas encore de fichier
  }
  const expired = (entry) => entry.expiresAt !== 0 && Date.now() > entry.expiresAt;

  return {
    async get(key) {
      const entry = data.get(key);
      return entry && !expired(entry) ? entry.value : null;
    },
    async set(key, value, ttl) {
      for (const [otherKey, entry] of data) {
        if (expired(entry)) data.delete(otherKey);
      }
      data.set(key, { value, expiresAt: ttl ? Date.now() + ttl * 1000 : 0 });
      if (key === LEADERBOARD_KEY) {
        // Écriture dans un fichier temporaire puis renommage : jamais de fichier à moitié écrit
        fs.writeFileSync(`${SCORES_FILE}.tmp`, value);
        fs.renameSync(`${SCORES_FILE}.tmp`, SCORES_FILE);
      }
    },
    async del(key) {
      return data.delete(key) ? 1 : 0;
    },
  };
}

const store = REDIS_URL && REDIS_TOKEN ? redisStore() : localStore();
const storageName = REDIS_URL && REDIS_TOKEN ? "base de données" : "fichier local";
const gameKey = (gameId) => `invaders:game:${gameId}`;

// ---- Classement ----

async function readLeaderboard() {
  const raw = await store.get(LEADERBOARD_KEY);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.slice(0, LEADERBOARD_SIZE) : [];
  } catch {
    return [];
  }
}

// Les ajouts passent un par un : deux scores envoyés au même instant ne s'écrasent pas
let lastUpdate = Promise.resolve();

function addToLeaderboard(entry) {
  const update = lastUpdate.then(async () => {
    const leaderboard = await readLeaderboard();
    leaderboard.push(entry);
    leaderboard.sort((a, b) => b.score - a.score);
    leaderboard.length = Math.min(leaderboard.length, LEADERBOARD_SIZE);
    await store.set(LEADERBOARD_KEY, JSON.stringify(leaderboard));
    return leaderboard;
  });
  lastUpdate = update.catch(() => {});
  return update;
}

// Le pseudo ne garde que lettres, chiffres, espaces, tirets et underscores
function cleanName(name) {
  const cleaned = (typeof name === "string" ? name : "")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim()
    .slice(0, NAME_MAX_LENGTH)
    .trim();
  return cleaned || "Anonyme";
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

// ---- Routes ----

const app = express();
app.set("trust proxy", Number(process.env.TRUST_PROXY) || 0);
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({ limit: "1kb" }));

app.get("/", (req, res) => {
  res.json({ service: "Serveur de scores du portfolio", status: "ok", stockage: storageName });
});

app.get("/api/scores", async (req, res) => {
  res.json({ leaderboard: await readLeaderboard() });
});

// Ouverture d'une partie : le serveur note l'heure, l'identifiant servira à valider le score
app.post("/api/games", rateLimit, async (req, res) => {
  const gameId = crypto.randomUUID();
  await store.set(gameKey(gameId), String(Date.now()), GAME_TTL_SECONDS);
  res.status(201).json({ gameId });
});

// Fin de partie : envoi du score
app.post("/api/scores", rateLimit, async (req, res) => {
  const { gameId, name, score } = req.body || {};
  const key = typeof gameId === "string" && GAME_ID.test(gameId) ? gameKey(gameId) : null;
  const startedAt = key ? Number(await store.get(key)) : 0;
  if (!startedAt) {
    return res.status(409).json({ error: "Partie inconnue ou expirée." });
  }
  if (!Number.isInteger(score) || score < 1) {
    return res.status(400).json({ error: "Score invalide." });
  }
  const seconds = (Date.now() - startedAt) / 1000;
  if (score > seconds * MAX_POINTS_PER_SECOND + SCORE_MARGIN) {
    return res.status(400).json({ error: "Score impossible pour la durée de la partie." });
  }
  // Une partie ne donne qu'un seul score : seule la requête qui supprime la partie continue
  if ((await store.del(key)) !== 1) {
    return res.status(409).json({ error: "Partie inconnue ou expirée." });
  }

  const entry = { name: cleanName(name), score, date: new Date().toISOString() };
  const leaderboard = await addToLeaderboard(entry);
  const rank = leaderboard.indexOf(entry) + 1; // 0 si le score n'entre pas dans le classement
  res.status(201).json({ leaderboard, rank: rank || null });
});

app.use((req, res) => {
  res.status(404).json({ error: "Route inconnue." });
});

app.use((error, req, res, next) => {
  // JSON mal formé ou corps trop gros
  if (error.type === "entity.parse.failed" || error.type === "entity.too.large") {
    return res.status(400).json({ error: "Requête invalide." });
  }
  console.error(error.message);
  if (error.status === 503) {
    return res.status(503).json({ error: "Classement momentanément indisponible, réessaie." });
  }
  res.status(500).json({ error: "Erreur serveur." });
});

app.listen(PORT, () => console.log(`Serveur de scores démarré sur le port ${PORT} (stockage : ${storageName})`));
