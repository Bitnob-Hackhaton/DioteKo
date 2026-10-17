---
name: idswyft-community-v1-12-19-headless-bootstrap
description: Idswyft community v1.12.19 source-verified facts - headless dev account/API key, OTP, webhooks, env vars, compose gaps in our docker-compose.idswyft.yml
metadata:
  type: reference
---

Source: raw.githubusercontent.com/team-idswyft/idswyft-community/v1.12.19/... (WebFetch summaries of files, not a clone; no GitHub releases exist, only tags).

- Headless bootstrap: `POST /api/setup/initialize` {name,email,company?} (no auth, first developer only, 5/15min) returns `token` + `api_key.key` (ik_ + 64 hex, shown once). `GET /api/setup/status` -> {needs_setup}.
- OTP path: `/api/auth/developer/otp/send|verify|complete-registration`. When RESEND_API_KEY is unset the send response contains `code` + `self_hosted:true` AND emailService logs `[DEV] Text body` (info). No SMTP path (Resend only). No env to disable/fix OTP found.
- `POST /api/developer/api-key` needs Bearer developer JWT (or idswyft_token cookie); NODE_ENV!=production forces is_sandbox:true unless IDSWYFT_ALLOW_SANDBOX=true. Response field `api_key`.
- Webhooks `POST /api/developer/webhooks`: `authenticateDashboard` accepts x-api-key ONLY for service keys (isk_), so a normal ik_ key cannot register; use JWT. Body field is `secret` (not secret_token), auto `whsec_`+48 hex if omitted. URL must be https AND not private/localhost (SSRF guard, no env bypass) -> local dev needs a public HTTPS tunnel. Signature header `X-Idswyft-Signature: sha256=<hmac of JSON.stringify(payload)>`, no timestamp.
- Engine env is `ENGINE_URL` (port 3002), NOT ML_ENGINE_URL; STORAGE_PROVIDER defaults to supabase (set local); migrations are not baked in the image (bind-mount supabase/migrations to /app/backend/migrations); DATABASE_SSL auto-on unless host contains `@postgres:`; frontend nginx hardcodes `proxy_pass http://api:3001/api/`.
- Retention: config reads DATA_RETENTION_DAYS (README says RETENTION_DAYS); cron only when NODE_ENV=production.
