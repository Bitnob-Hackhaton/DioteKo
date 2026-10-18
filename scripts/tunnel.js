#!/usr/bin/env node
"use strict";
// HTTPS tunnels for this stack, run as Docker containers (ngrok/ngrok image, compose profile
// "tunnel") so their logs are viewable like any other service (`npm run tunnel:logs`, Docker
// Desktop). Appwrite (-> appwrite:80) and backend-nest (-> backend-nest:3003) each use their
// OWN ngrok authtoken + static domain from .env.dev (free plan: one agent session per account).
//   npm run tunnel                  asks which tunnels to start
//   npm run tunnel -- --appwrite    / --backend / --all   skip the questions
//   npm run tunnel:logs | tunnel:ps | tunnel:down
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");

const COMPOSE_FILE = "docker-compose.dev.yml";
const ENV_FILE = ".env.dev";
const BACKEND_ENV_FILE = path.join("backend-nest", ".env");

function parseEnvFile(rel) {
  const abs = path.join(process.cwd(), rel);
  const out = {};
  if (!fs.existsSync(abs)) return out;
  for (const line of fs.readFileSync(abs, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...parseEnvFile(ENV_FILE), ...process.env };
const projectId = parseEnvFile(BACKEND_ENV_FILE).APPWRITE_PROJECT_ID || "<APPWRITE_PROJECT_ID>";
const cleanDomain = (d) => (d || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");

// Authtokens only reach compose through .env.dev / the environment, and are never logged.
const SERVICES = {
  appwrite: {
    label: "Appwrite",
    service: "ngrok-appwrite",
    inspector: "http://localhost:4041",
    target: `http://localhost:${env.APPWRITE_HTTP_PORT || "9000"}`,
    tokenVar: "NGROK_APPWRITE_AUTHTOKEN",
    domainVar: "NGROK_APPWRITE_DOMAIN",
    token: env.NGROK_APPWRITE_AUTHTOKEN,
    domain: cleanDomain(env.NGROK_APPWRITE_DOMAIN),
    defaultYes: true,
    steps: (host) => [
      `frontmobile/.env      -> EXPO_PUBLIC_APPWRITE_ENDPOINT=https://${host}/v1  (then: npx expo start --clear)`,
      `Google redirect URI   -> https://${host}/v1/account/sessions/oauth2/callback/google/${projectId}`,
    ],
  },
  backend: {
    label: "backend-nest",
    service: "ngrok-backend",
    inspector: "http://localhost:4042",
    target: "http://localhost:3003",
    tokenVar: "NGROK_BACKEND_AUTHTOKEN",
    domainVar: "NGROK_BACKEND_DOMAIN",
    token: env.NGROK_BACKEND_AUTHTOKEN,
    domain: cleanDomain(env.NGROK_BACKEND_DOMAIN),
    defaultYes: false,
    steps: (host) => [
      `Bitnob webhook URL    -> https://${host}/api/bitnob/webhooks`,
      `frontmobile/.env      -> EXPO_PUBLIC_API_BASE_URL=https://${host}/api  (optional, instead of the LAN IP)`,
    ],
  },
};

function fail(msg) {
  console.error(`[RESULT] FAILED ${msg}`);
  process.exit(1);
}

// Same compose invocation as docker-dev-up.js (guard var + .env.dev), plus the tunnel profile.
function compose(args) {
  const envArgs = fs.existsSync(path.join(process.cwd(), ENV_FILE)) ? ["--env-file", ENV_FILE] : [];
  const full = ["compose", ...envArgs, "-f", COMPOSE_FILE, "--profile", "tunnel", ...args];
  console.log(`[CALL] docker ${full.join(" ")}`);
  const r = spawnSync("docker", full, { stdio: "inherit", env: { ...process.env, DEV_UP_GUARD: "1" } });
  if (r.error) fail(`cannot run docker: ${r.error.message}`);
  return r.status ?? 1;
}

async function chooseServices() {
  const flags = process.argv.slice(2);
  if (flags.includes("--all")) return Object.keys(SERVICES);
  const picked = Object.keys(SERVICES).filter((k) => flags.includes(`--${k}`));
  if (picked.length) return picked;
  if (!process.stdin.isTTY) fail("no TTY to ask on: pass --appwrite, --backend or --all.");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const chosen = [];
  for (const [key, s] of Object.entries(SERVICES)) {
    const hint = s.defaultYes ? "Y/n" : "y/N";
    const answer = (await rl.question(`Tunnel ${s.label} (${s.target} -> ${s.domain || "NO DOMAIN SET"})? [${hint}] `)).trim().toLowerCase();
    if (answer === "" ? s.defaultYes : ["y", "yes", "o", "oui"].includes(answer)) chosen.push(key);
  }
  rl.close();
  return chosen;
}

async function up() {
  console.log("[START] tunnels (ngrok in Docker)");
  const keys = await chooseServices();
  if (!keys.length) return console.log("[STATE] nothing selected, bye.");
  for (const k of keys) {
    const s = SERVICES[k];
    if (!s.token || !s.domain) {
      fail(`${s.label}: ${!s.token ? s.tokenVar : s.domainVar} is empty in ${ENV_FILE} (authtoken: dashboard.ngrok.com > Your Authtoken; domain: Universe > Domains).`);
    }
  }
  const tokens = keys.map((k) => SERVICES[k].token);
  if (new Set(tokens).size < tokens.length) {
    console.warn("[STATE] WARNING: both tunnels use the same ngrok authtoken; the free plan allows ONE agent session per account, so the second will be refused. Give each its own token.");
  }
  // --no-deps: only the tunnels; the stack itself must already be up (npm run dev:up).
  const code = compose(["up", "-d", "--no-deps", "--force-recreate", ...keys.map((k) => SERVICES[k].service)]);
  if (code !== 0) fail(`docker compose exited with ${code} (is the stack up? run npm run dev:up first).`);
  for (const k of keys) {
    const s = SERVICES[k];
    console.log(`[RESULT] ${s.label}: ${s.target} -> https://${s.domain}  (live requests: ${s.inspector})`);
    for (const step of s.steps(s.domain)) console.log(`[STATE] ${step}`);
  }
  console.log("[STATE] logs: npm run tunnel:logs   stop: npm run tunnel:down");
}

const sub = process.argv[2];
const services = Object.values(SERVICES).map((s) => s.service);
if (sub === "logs") process.exit(compose(["logs", "-f", "--tail", "50", ...services]));
else if (sub === "ps") process.exit(compose(["ps", ...services]));
else if (sub === "down") process.exit(compose(["rm", "-s", "-f", ...services]));
else up();
