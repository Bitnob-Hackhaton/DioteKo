#!/usr/bin/env node
"use strict";
/**
 * Creates the Idswyft API key that backend-nest needs (IDSWYFT_API_KEY), with no dashboard click.
 *
 *   npm run kyc:bootstrap                         # creates (or logs in) the dev developer + a key
 *   npm run kyc:bootstrap -- --email me@x.com     # same, with your own developer e-mail
 *   npm run kyc:bootstrap -- --force              # replace a non-empty IDSWYFT_API_KEY in backend-nest/.env
 *
 * How (Idswyft community v1.12.19, checked against its sources on 2026-10-16):
 *  - if GET /api/setup/status says `needs_setup`, POST /api/setup/initialize creates the first developer and a
 *    key in one unauthenticated call. NOTE: v1.12.19 seeds two internal "service" developers in its migrations, so
 *    on that release `needs_setup` is already false and this path is skipped;
 *  - otherwise: POST /api/auth/developer/otp/send returns the one-time code in its JSON answer when the instance
 *    has no e-mail provider (the case for this dev stack), then otp/verify gives a token (existing developer) or a
 *    registration token (new e-mail), and an API key is minted. Nothing here works against an instance that sends
 *    real e-mails.
 *
 * The key is written to backend-nest/.env (git-ignored) and NEVER printed. A development Idswyft issues sandbox keys.
 * Webhook registration is not done here: Idswyft only accepts a public HTTPS URL (see docs/KYC.md).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BACKEND_ENV = path.join(ROOT, "backend-nest", ".env");
const KEY_VAR = "IDSWYFT_API_KEY";
const DEFAULT_EMAIL = "kyc-dev@dioteko.dev";

function parseArgs(argv) {
  const out = { email: null, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--force") out.force = true;
    else if (argv[i] === "--email") out.email = argv[(i += 1)] ?? null;
  }
  return out;
}

// Same source of truth as the compose file: .env.dev, then the default port.
function apiBase() {
  let port = process.env.IDSWYFT_API_HOST_PORT || "8000";
  const envDev = path.join(ROOT, ".env.dev");
  if (!process.env.IDSWYFT_API_HOST_PORT && fs.existsSync(envDev)) {
    const m = /^\s*IDSWYFT_API_HOST_PORT\s*=\s*(\d+)\s*$/m.exec(fs.readFileSync(envDev, "utf8"));
    if (m) port = m[1];
  }
  return process.env.IDSWYFT_BASE_URL || `http://localhost:${port}`;
}

async function call(base, method, route, { body, token } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    /* empty or non-JSON answer */
  }
  return { status: response.status, data };
}

function keyFrom(data) {
  const candidate = data?.api_key;
  if (typeof candidate === "string") return candidate;
  if (candidate && typeof candidate.key === "string") return candidate.key;
  return null;
}

async function viaSetup(base) {
  const status = await call(base, "GET", "/api/setup/status");
  if (status.status !== 200) throw new Error(`GET /api/setup/status answered ${status.status} — is Idswyft up? (npm run dev:ps)`);
  if (!status.data?.needs_setup) return { needsSetup: false, key: null };
  console.log("[CALL] fresh Idswyft: POST /api/setup/initialize");
  const created = await call(base, "POST", "/api/setup/initialize", {
    body: { name: "DioteKo Dev", email: DEFAULT_EMAIL },
  });
  const key = keyFrom(created.data);
  if (created.status !== 201 || !key) throw new Error(`setup/initialize answered ${created.status} without an API key`);
  return { needsSetup: true, key };
}

async function viaOtp(base, email) {
  console.log("[CALL] existing developer: OTP flow");
  const sent = await call(base, "POST", "/api/auth/developer/otp/send", { body: { email } });
  const code = sent.data?.code;
  if (sent.status !== 200 || typeof code !== "string") {
    throw new Error(
      `otp/send answered ${sent.status} without a code. The instance may send real e-mails, or the hourly limit is reached: ` +
        "use the dashboard (http://localhost:8086, code in `docker logs dioteko-idswyft-api`) to create the key.",
    );
  }
  const verified = await call(base, "POST", "/api/auth/developer/otp/verify", { body: { email, code } });
  if (verified.status !== 200) throw new Error(`otp/verify answered ${verified.status}`);
  if (verified.data?.is_new) {
    const done = await call(base, "POST", "/api/auth/developer/otp/complete-registration", {
      body: { registration_token: verified.data.registration_token, name: "DioteKo Dev" },
    });
    const key = keyFrom(done.data);
    if (!key) throw new Error(`complete-registration answered ${done.status} without an API key`);
    return key;
  }
  const minted = await call(base, "POST", "/api/developer/api-key", {
    token: verified.data?.token,
    body: { name: "dioteko-backend", is_sandbox: true },
  });
  const key = keyFrom(minted.data);
  if (!key) throw new Error(`api-key answered ${minted.status} without an API key`);
  return key;
}

// Writes KEY_VAR=<key> into backend-nest/.env (created from .env.example if missing). Never logs the value.
function storeKey(key, force) {
  if (!fs.existsSync(BACKEND_ENV)) {
    const example = path.join(ROOT, "backend-nest", ".env.example");
    if (!fs.existsSync(example)) throw new Error("backend-nest/.env and .env.example are both missing");
    fs.copyFileSync(example, BACKEND_ENV);
    console.log("[STATE] backend-nest/.env created from .env.example");
  }
  const text = fs.readFileSync(BACKEND_ENV, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(`${KEY_VAR}=`));
  if (index >= 0 && lines[index].slice(KEY_VAR.length + 1).trim() !== "" && !force) {
    console.log(`[RESULT] ${KEY_VAR} already set in backend-nest/.env — left untouched (use --force to replace it).`);
    return false;
  }
  if (index >= 0) lines[index] = `${KEY_VAR}=${key}`;
  else lines.push(`${KEY_VAR}=${key}`);
  fs.writeFileSync(BACKEND_ENV, lines.join(eol));
  return true;
}

async function main() {
  const { email, force } = parseArgs(process.argv.slice(2));
  const base = apiBase();
  console.log(`[START] idswyft bootstrap against ${base}`);

  let key = null;
  const setup = await viaSetup(base);
  if (setup.needsSetup) {
    key = setup.key;
  } else {
    key = await viaOtp(base, email || DEFAULT_EMAIL);
  }

  if (storeKey(key, force)) {
    console.log(`[RESULT] ${KEY_VAR} written to backend-nest/.env (value not displayed).`);
    console.log("[STATE] apply it: npm run dev:up   (recreates the backend container with the new .env)");
  }
}

main().catch((error) => {
  console.error(`[RESULT] bootstrap failed: ${error.message}`);
  process.exit(1);
});
