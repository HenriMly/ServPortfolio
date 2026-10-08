# ServPortfolio

Serveur de scores du Space Invaders de [mon portfolio](https://github.com/HenriMly/portfolio).
Le jeu tourne dans le navigateur ; ce serveur **Node.js + Express** garde le classement.

- Classement des 10 meilleurs scores, sauvegardé sur disque (`scores.json`)
- Vérification de chaque score : pseudo nettoyé, score refusé s'il est impossible pour la durée de la partie
- Accès limité au site du portfolio (CORS) et 20 envois par minute au maximum par visiteur

## Lancer en local

```bash
git clone https://github.com/HenriMly/ServPortfolio.git
cd ServPortfolio
npm install
npm start
```

Le serveur écoute sur http://localhost:3001. Il faut Node.js 18 ou plus récent.

## API

| Route | Rôle | Réponse |
|---|---|---|
| `GET /` | Vérifier que le serveur tourne | `{ service, status }` |
| `GET /api/scores` | Lire le classement | `{ leaderboard: [{ name, score, date }] }` |
| `POST /api/games` | Ouvrir une partie, au clic sur « Jouer » | `{ gameId }` |
| `POST /api/scores` | Envoyer un score en fin de partie | `{ leaderboard, rank }` |

`POST /api/scores` attend un corps JSON `{ gameId, name, score }`. `rank` vaut `null` si le score n'entre pas dans le top 10.

Erreurs possibles, toujours au format `{ error }` :

- `400` : score invalide, ou impossible pour la durée de la partie
- `409` : partie inconnue, expirée (1 heure) ou déjà utilisée
- `429` : trop d'envois en une minute

## Configuration

Tout se règle par variables d'environnement.

| Variable | Valeur par défaut | Rôle |
|---|---|---|
| `PORT` | `3001` | Port d'écoute |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Sites autorisés à appeler l'API, séparés par des virgules |
| `SCORES_FILE` | `scores.json` | Fichier où le classement est sauvegardé |
| `TRUST_PROXY` | `0` | Mettre `1` derrière un proxy (Render, Railway...) |

## Mise en ligne

1. Mettre l'adresse du portfolio en ligne dans `ALLOWED_ORIGINS`, et `TRUST_PROXY=1` si l'hébergeur passe par un proxy.
2. Côté portfolio, mettre l'adresse de ce serveur dans `REACT_APP_API_URL`.

Chez un hébergeur dont le disque est effacé à chaque déploiement, le classement repart de zéro à ce moment-là.

## Limite connue

Le score est calculé dans le navigateur. Le serveur refuse les scores absurdes, mais ne peut pas empêcher l'envoi d'un faux score qui reste plausible.

## Historique

Ce dépôt contenait auparavant le serveur Socket.IO du jeu Asteroids Arena. Il reste consultable dans l'historique (commit `6a49653`).
