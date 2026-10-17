# Quick Start

Run the current stack locally: PostgreSQL, the `backend-nest` API, the mobile wallet and, optionally, the organisation console. Full details are in [SETUP.md](SETUP.md) and [docs/DEV_WORKFLOW.md](docs/DEV_WORKFLOW.md).

## Prerequisites

- Docker and Docker Compose
- Node.js 20 (the `backend-nest` Docker image uses `node:20-alpine`), Node.js 22 or newer for `frontweb` (`engines` in its `package.json`)
- Expo Go on a phone, or an Android or iOS emulator

## 1. Start the infrastructure (repo root)

```bash
npm run dev:up
```

This starts DioteKo's PostgreSQL (`dioteko-postgres`, host port 5435), the `backend-nest` container (port 3001) and a local Appwrite (port 8090). The first run builds the images and can take a while.

## 2. Configure the backend

```bash
cd backend-nest
npm install
cp .env.example .env
```

Fill in `JWT_SECRET` and `VC_SIGNING_SECRET`. The app refuses to start while either is empty. The Bitnob and Appwrite variables can stay empty for boot, but invoices and login need them (see [SETUP.md](SETUP.md)).

## 3. Create and seed the databases (repo root)

```bash
npm run db:setup
```

This runs migrations and the seed for `dioteko_dev` and `dioteko_test`.

## 4. Check the API

```bash
curl http://localhost:3001/api/healthz
```

Expected: `{"status":"ok","db":"up",...}`. Swagger UI: http://localhost:3001/api-docs

## 5. Start the mobile wallet

```bash
cd frontmobile
npm install
cp .env.exemple .env
npm start
```

Press `a` (Android) or `i` (iOS), or scan the QR code with Expo Go. On a physical phone, leave `EXPO_PUBLIC_API_BASE_URL` empty: the app then uses the LAN address of the Metro host. `localhost` points to the phone itself.

Google sign-in needs a one-time Appwrite setup and an HTTPS tunnel. Follow "Appwrite first-run" and "Testing Google login from a phone or emulator" in [docs/DEV_WORKFLOW.md](docs/DEV_WORKFLOW.md).

## 6. Optional: start the organisation console

```bash
cd frontweb
npm ci
cp .env.example .env
npm run dev
```

Open http://localhost:3000. Set `VITE_USE_MOCKS=true` in `.env` to work without the API.

## Common problems

| Symptom | Cause and fix |
|---|---|
| `backend-nest` does not start | `JWT_SECRET` or `VC_SIGNING_SECRET` is empty in `backend-nest/.env` |
| Mobile gets `Cannot GET /api/admin-certificates/requests` (404) | The `backend-nest` image is older than the source. Run `npm run dev:up` again (a restart is not enough) |
| `GET /api/health` returns `implemented: false` | That is a stub for a future domain. Use `GET /api/healthz` |
| Bitnob answers 403 "IP address not whitelisted" | Allow your public IP in the Bitnob dashboard |
| Google sign-in shows `redirect_uri_mismatch` | The Appwrite callback URI is not registered in Google Cloud. See [docs/DEV_WORKFLOW.md](docs/DEV_WORKFLOW.md) |
| Phone cannot reach the API | Use the LAN IP (leave `EXPO_PUBLIC_API_BASE_URL` empty), and check that the phone and PC share the same network |

## Next steps

- [SETUP.md](SETUP.md): ports, environment variables, environments and tests
- [ARCHITECTURE.md](ARCHITECTURE.md): how the system is built
- [CONTRIBUTING.md](CONTRIBUTING.md): how to contribute
- [DEPLOYMENT.md](DEPLOYMENT.md): what is and is not ready for production
