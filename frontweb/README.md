# DioteKo Console

Console web pour le personnel des organisations émettrices (mairies, centres d'état civil, ministères). Les citoyens utilisent l'application mobile (`frontmobile/`). L'API est `backend-nest/` (préfixe `/api`, port 3003).

Pile (`package.json`) : TanStack Start et TanStack Router (React 19), Vite 8, Tailwind 4, composants shadcn/ui (Radix), TanStack Query, serveur Node via Nitro.

## Périmètre du mode réel

Le mode réel est actif par défaut (`VITE_USE_MOCKS=false`).

| Fonction | Mode réel | Route de l'API |
|---|---|---|
| Connexion, déconnexion, profil | Oui | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Types de certificat | Oui | `GET /api/admin-certificates/types` |
| Liste des demandes de l'organisation | Oui | `GET /api/admin-certificates/organization/requests` |
| Détail d'une demande | Oui | `GET /api/admin-certificates/organization/requests/:id` |
| Accepter, rejeter, demander un complément | Oui | `POST .../organization/requests/:id/accept`, `reject`, `request-info` |
| Vérification publique d'un certificat | Oui | `POST /api/admin-certificates/:id/verify` |
| Statistiques, liste des certificats, émission manuelle, notes, recommandation, révocation, journal d'audit | Non, données simulées seulement | Pas encore branchés |

Les permissions par rôle sont dans `src/lib/permissions.ts`. Les règles d'architecture sont dans `AGENTS.md`.

## Démarrer

Node 22 ou plus récent, npm.

```sh
cd frontweb
npm ci                   # .npmrc : legacy-peer-deps=true
cp .env.example .env     # puis ajuster
npm run dev              # http://localhost:3000
```

Pour travailler sans backend : `VITE_USE_MOCKS=true` dans `.env`.

## Variables d'environnement

Les variables `VITE_*` sont figées au build : relancer `npm run build` après un changement.

| Variable | Rôle | Défaut |
|---|---|---|
| `VITE_API_BASE_URL` | URL de l'API Nest | `http://localhost:3003/api` |
| `VITE_USE_MOCKS` | `true` pour travailler sans backend (données simulées) | `false` |
| `VITE_ENV` | `production` ou `sandbox` (affiche le bandeau d'environnement) | `sandbox` |

## Scripts

| Commande | Effet |
|---|---|
| `npm run dev` | Serveur de développement (port 3000) |
| `npm run build` | Build de production dans `.output/` |
| `npm start` | Lance le build : `node .output/server/index.mjs` (`PORT`, `HOST`) |
| `npm test` | Tests Vitest |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

## Déploiement

```sh
npm ci && npm run build
PORT=3000 npm start
```

Avec Docker (`Dockerfile`, image `node:22-alpine`) : `docker build -t dioteko-console .` puis `docker run -p 3000:3000 dioteko-console`.

Ajouter l'origine de la console (exacte, sans chemin) à `CORS_ORIGINS` côté `backend-nest`. Voir `backend-nest/.env.example` pour la valeur par défaut.

## Documentation liée

- [../SETUP.md](../SETUP.md) : configuration complète
- [../docs/ARCHITECTURE_AS_BUILT.md](../docs/ARCHITECTURE_AS_BUILT.md) : flux réels et écarts connus
- [../docs/CONSOLE_ORGANISATIONS_CAHIER_DES_ECRANS.md](../docs/CONSOLE_ORGANISATIONS_CAHIER_DES_ECRANS.md) : cahier des écrans de la console
