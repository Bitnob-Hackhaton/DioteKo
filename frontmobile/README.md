# DioteKo mobile wallet (frontmobile)

Citizen app built with Expo Router and React Native (Expo ~57, React Native 0.86). A citizen signs in with Google, requests an administrative certificate, pays the Lightning invoice, downloads the signed PDF and verifies a certificate.

The app calls only `backend-nest`. Architecture: [../ARCHITECTURE.md](../ARCHITECTURE.md).

## Status

- **Certificate flow (real):** types, request, resubmit, list, detail, invoice and payment status, PDF download through a signed link, public verification.
- **Login (real):** Google through Appwrite, then `POST /api/auth/appwrite/login` on the backend.
- **`app/admin/*` (mockups):** screens backed by `mockApiCall` in `services/api.ts`. They are not connected to the backend.
- **Tests:** no automated test suite. `npm run lint` is the only check. The verification flow has not been tested on a physical phone.

## Setup

```bash
cd frontmobile
npm install
cp .env.exemple .env      # the template file is spelled .env.exemple
npm start
```

Then press `a` (Android) or `i` (iOS), or scan the QR code with Expo Go. The backend must be running: see [../backend-nest/README.md](../backend-nest/README.md) and [../docs/DEV_WORKFLOW.md](../docs/DEV_WORKFLOW.md).

| Script | Command |
|---|---|
| `npm start` | Expo dev server |
| `npm run android` / `npm run ios` / `npm run web` | Open on a given target |
| `npm run lint` | `expo lint` |

## Environment

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | Explicit API base URL. On a physical phone, leave it empty: the app uses the LAN IP of the Metro host and the port below |
| `EXPO_PUBLIC_API_PORT` | API port. Default `3003` |
| `EXPO_PUBLIC_APPWRITE_ENDPOINT` | Appwrite URL that the phone can reach. For Google sign-in, use an HTTPS tunnel |
| `EXPO_PUBLIC_APPWRITE_PROJECT_ID` | Appwrite project ID |

`EXPO_PUBLIC_*` values are bundled into the app. Never put a secret in them. On a phone, `localhost` means the phone itself, so do not use it for the API or Appwrite.

API URL resolution is in `config/config.ts`.

## Google sign-in

Needs an Appwrite project with the Google provider and an HTTPS tunnel to the local Appwrite. Follow "Appwrite first-run" and "Testing Google login from a phone or emulator" in [../docs/DEV_WORKFLOW.md](../docs/DEV_WORKFLOW.md). Expo Go reaches the browser step. The full flow needs a development build with the `dioteko` scheme.

## Layout

| Path | Content |
|---|---|
| `app/(auth)/` | Sign-in and sign-up screens |
| `app/certificate/[id].tsx` | Certificate request detail |
| `app/admin/` | Mockup screens (see Status) |
| `services/api.ts` | Axios client. Adds the Bearer token, runs one shared token refresh on `401`, and replays the request |
| `services/appwriteAuth.ts` | Appwrite SDK sign-in, then backend login |
| `services/certificate-requests.ts` | Certificate request helpers |
| `config/config.ts` | API URL and Appwrite settings |
| `Provider/AppContext.tsx` | Shared app state |
| `components/` | UI components |

## Backend calls

- `POST /api/auth/appwrite/login`, `POST /api/auth/logout`, `POST /api/auth/refresh`
- `GET /api/admin-certificates/types`, `GET /api/admin-certificates/config`
- `POST /api/admin-certificates/requests`, `GET /api/admin-certificates/requests`, `GET /api/admin-certificates/requests/stats`, `GET /api/admin-certificates/requests/:id`, `POST /api/admin-certificates/requests/:id/resubmit`
- `POST /api/admin-certificates/requests/:id/lightning-invoices`, `GET /api/admin-certificates/requests/:id/lightning-invoice`, `GET /api/admin-certificates/requests/:id/lightning-invoices/status`
- `POST /api/admin-certificates/dev/requests/:id/mark-paid` (dev only, `PAYMENT_SIMULATION`)
- `GET /api/admin-certificates/requests/:id/file-link`, then `GET /api/admin-certificates/:certificateId/file` with the signed `exp` and `sig`
- `POST /api/admin-certificates/:certificateId/verify`
