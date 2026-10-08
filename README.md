# ServPortfolio

Serveur de scores du Space Invaders de [mon portfolio](https://github.com/HenriMly/portfolio).
Le jeu tourne dans le navigateur ; ce serveur **Node.js + Express** garde le classement.

- Classement des 10 meilleurs scores, gardé dans une base de données en ligne (Upstash Redis) : il survit aux redémarrages et aux mises en veille du serveur
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

En local, aucune base de données n'est nécessaire : le classement est écrit dans le fichier `scores.json`.

## API

| Route | Rôle | Réponse |
|---|---|---|
| `GET /` | Vérifier que le serveur tourne et quel stockage il utilise | `{ service, status, stockage }` |
| `GET /api/scores` | Lire le classement | `{ leaderboard: [{ name, score, date }] }` |
| `POST /api/games` | Ouvrir une partie, dès l'arrivée sur la page du jeu | `{ gameId }` |
| `POST /api/scores` | Envoyer un score en fin de partie | `{ leaderboard, rank }` |

`POST /api/scores` attend un corps JSON `{ gameId, name, score }`. `rank` vaut `null` si le score n'entre pas dans le top 10.

Erreurs possibles, toujours au format `{ error }` :

- `400` : score invalide, ou impossible pour le temps écoulé depuis l'ouverture de la partie
- `409` : partie inconnue, expirée (1 heure) ou déjà utilisée
- `429` : trop d'envois en une minute
- `503` : base de données injoignable

## Configuration

Tout se règle par variables d'environnement.

| Variable | Valeur par défaut | Rôle |
|---|---|---|
| `PORT` | `3001` | Port d'écoute |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Sites autorisés à appeler l'API, séparés par des virgules |
| `UPSTASH_REDIS_REST_URL` | aucune | Adresse de la base de données Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | aucune | Jeton d'accès à cette base. À ne jamais mettre dans le dépôt |
| `SCORES_FILE` | `scores.json` | Sans base de données, fichier où le classement est sauvegardé |
| `TRUST_PROXY` | `0` | Mettre `1` derrière un proxy (Render, Railway...) |

## Mise en ligne

Un hébergement gratuit comme Render efface les fichiers du serveur à chaque redémarrage ou mise en veille. Le classement doit donc être gardé dans une base de données :

1. Créer une base Redis gratuite sur [upstash.com](https://upstash.com), puis copier son adresse REST et son jeton REST.
2. Chez l'hébergeur du serveur, renseigner `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `ALLOWED_ORIGINS` (adresse du portfolio en ligne) et `TRUST_PROXY=1`.
3. Côté portfolio, mettre l'adresse de ce serveur dans `REACT_APP_API_URL`.

Pour vérifier, ouvrir l'adresse du serveur : `stockage` doit valoir `"base de données"`.

## Limite connue

Le score est calculé dans le navigateur. Le serveur refuse les scores absurdes, mais ne peut pas empêcher l'envoi d'un faux score qui reste plausible.

## Historique

Ce dépôt contenait auparavant le serveur Socket.IO du jeu Asteroids Arena. Il reste consultable dans l'historique (commit `6a49653`).
