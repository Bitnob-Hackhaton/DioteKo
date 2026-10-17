#!/usr/bin/env node
"use strict";
const { execSync, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const COMPOSE_FILE = "docker-compose.dev.yml";
const ENV_FILE = ".env.dev";
// DioteKo's OWN Postgres (service `postgres` in docker-compose.dev.yml). Nothing
// here looks for, reuses or connects to a Postgres container or network owned by
// another project.
const POSTGRES_CONTAINER = "dioteko-postgres";
// Names are fixed: the E2E guards in backend-nest/test/ assert `dioteko_test` literally.
const DATABASES = ["dioteko_dev", "dioteko_test"];

// `docker compose --env-file .env.dev` supplies the values interpolated in
// docker-compose.dev.yml / docker-compose.appwrite.yml. Every var also has a
// `${VAR:-default}` fallback, so a fresh clone with no .env.dev still works —
// only pass the flag when the file is actually there (a missing --env-file is
// a hard error in compose).
function envFileArgs() {
  const abs = path.join(process.cwd(), ENV_FILE);
  if (fs.existsSync(abs)) return ["--env-file", ENV_FILE];
  console.log(`[STATE] ${ENV_FILE} not found — using docker-compose defaults. Copy ${ENV_FILE}.example to customise.`);
  return [];
}

// Load .env.dev into process.env (without overriding already-set vars) so the
// db-setup / db-reset scripts resolve POSTGRES_USER etc. the SAME way compose
// does — no drift between `--env-file .env.dev` and the scripts' own psql calls.
function loadEnvFile() {
  const abs = path.join(process.cwd(), ENV_FILE);
  if (!fs.existsSync(abs)) return;
  for (const line of fs.readFileSync(abs, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#") && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnvFile();

const POSTGRES_USER = process.env.POSTGRES_USER || "postgres_user";
const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD || "postgres_password";
const DEFAULT_HOST_PORT = process.env.DIOTEKO_PG_HOST_PORT || "5435";

function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Runs psql inside DioteKo's Postgres container. No shell involved (execFileSync),
// so SQL quoting is identical on Windows, macOS and Linux.
function psql(sql, database = "postgres") {
  return execFileSync(
    "docker",
    ["exec", "-e", `PGPASSWORD=${POSTGRES_PASSWORD}`, POSTGRES_CONTAINER, "psql", "-U", POSTGRES_USER, "-d", database, "-Atc", sql],
    { stdio: ["ignore", "pipe", "pipe"] },
  ).toString().trim();
}

function waitForPostgres(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  console.log(`[CALL] waiting for ${POSTGRES_CONTAINER} to be healthy`);
  while (Date.now() < deadline) {
    try {
      const status = execSync(`docker inspect -f "{{.State.Health.Status}}" ${POSTGRES_CONTAINER}`, {
        stdio: ["ignore", "pipe", "ignore"],
      }).toString().trim();
      if (status === "healthy") {
        console.log(`[RESULT] ${POSTGRES_CONTAINER} is healthy`);
        return;
      }
    } catch { /* container not created yet */ }
    sleepSync(1000);
  }
  throw new Error(`${POSTGRES_CONTAINER} did not become healthy within ${timeoutMs / 1000}s — see: docker logs ${POSTGRES_CONTAINER}`);
}

function databaseExists(name) {
  return psql(`SELECT 1 FROM pg_database WHERE datname='${name}'`) === "1";
}

// Creates the DioteKo databases that are missing (idempotent). `dioteko_dev` is
// normally created by POSTGRES_DB on first boot; `dioteko_test` never is.
function ensureDatabases() {
  for (const name of DATABASES) {
    if (databaseExists(name)) {
      console.log(`[STATE] database ${name} already exists`);
    } else {
      psql(`CREATE DATABASE ${name}`);
      console.log(`[RESULT] database ${name} created`);
    }
  }
}

function dropDatabase(name) {
  console.log(`[ENTITY] drop database: ${name}`);
  psql(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  console.log(`[RESULT] dropped: ${name}`);
}

function hostPort() {
  try {
    return execSync(`docker port ${POSTGRES_CONTAINER} 5432`, { stdio: ["ignore", "pipe", "pipe"] })
      .toString().trim().split(/\r?\n/)[0];
  } catch {
    return null;
  }
}

function ensureDevDb({ extraArgs = [] } = {}) {
  process.env.DEV_UP_GUARD = "1"; // unlocks x-dev-up-guard for all compose calls
  const sub = extraArgs.length ? extraArgs : ["up", "-d"];
  if (sub[0] === "up") sub.push("--build"); // build the backend-nest app image
  const args = ["docker", "compose", ...envFileArgs(), "-f", COMPOSE_FILE, ...sub];
  console.log(`[CALL] ${args.join(" ")}`);
  run(args.join(" "));
  if (sub[0] === "up") {
    waitForPostgres();
    ensureDatabases();
  }
  return { sub };
}

if (require.main === module) {
  const sub = process.argv.slice(2);
  console.log(`[START] dev tooling: docker compose ${(sub.length ? sub : ["up", "-d"]).join(" ")}`);
  ensureDevDb({ extraArgs: sub });
  if ((sub[0] || "up") === "up") {
    const port = hostPort();
    const portNum = port ? port.replace(/^[^:]+:/, "") : DEFAULT_HOST_PORT;
    console.log(`[RESULT] DioteKo Postgres: container ${POSTGRES_CONTAINER}, host port ${portNum}.`);
    console.log(`[STATE] backend-nest started (http://localhost:3001/api-docs). Host-run apps: DB_PORT=${portNum} (backend-nest/.env, .env.test).`);
  }
}

module.exports = {
  ensureDevDb,
  ensureDatabases,
  dropDatabase,
  envFileArgs,
  COMPOSE_FILE,
  POSTGRES_CONTAINER,
  DATABASES,
  POSTGRES_USER,
  POSTGRES_PASSWORD,
};
