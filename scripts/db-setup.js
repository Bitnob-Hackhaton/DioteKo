"use strict";
const { execSync } = require("child_process");
const { ensureDevDb } = require("./docker-dev-up.js");

// execSync (not spawnSync): on Windows, spawning npm.cmd directly without a
// shell loses the child's exit code (status === null on failure).
function npmRun(prefix, script, extraEnv = {}) {
  const label = Object.keys(extraEnv).length
    ? `${prefix}: ${Object.entries(extraEnv).map(([k, v]) => `${k}=${v}`).join(" ")} npm run ${script}`
    : `${prefix}: npm run ${script}`;
  console.log(`[START] ${label}`);
  const cmd = `npm --prefix ${prefix} run ${script}`;
  console.log(`[CALL] ${cmd}`);
  try {
    execSync(cmd, { stdio: "inherit", env: { ...process.env, ...extraEnv } });
  } catch (err) {
    console.error(`[RESULT] FAILED ${label} (exit ${err.status ?? "?"})`);
    process.exit(err.status || 1);
  }
  console.log(`[RESULT] OK ${label}`);
}

// Best-effort: create the Appwrite E2E test user if Appwrite is configured.
// Never fails the caller — it just prints [SKIP] until the one-time console
// setup is done (docs/DEV_WORKFLOW.md "Appwrite first-run").
function seedAppwriteBestEffort() {
  console.log("[START] backend-nest: npm run seed:appwrite (best-effort)");
  try {
    execSync("npm --prefix backend-nest run seed:appwrite", { stdio: "inherit", env: process.env });
  } catch (err) {
    console.warn(`[RESULT] seed:appwrite skipped/failed (non-fatal, exit ${err.status ?? "?"})`);
  }
}

function runSchemaSteps() {
  // backend-nest only (the legacy Express backend/ was removed; tag legacy-express-backend keeps it).
  // DEV database (dioteko_dev): NODE_ENV unset => backend-nest/.env.
  npmRun("backend-nest", "migration:run");
  npmRun("backend-nest", "seed");
  // TEST database (dioteko_test): NODE_ENV=test => backend-nest/.env.test.
  npmRun("backend-nest", "migration:run", { NODE_ENV: "test" });
  npmRun("backend-nest", "seed", { NODE_ENV: "test" });
  // Appwrite E2E user (no-op until Appwrite is configured). In runSchemaSteps
  // so both db:setup and db:reset keep it in sync.
  seedAppwriteBestEffort();
}

if (require.main === module) {
  console.log("[START] db:setup");
  ensureDevDb(); // stack up, Postgres healthy, missing databases created
  runSchemaSteps();
  console.log("[RESULT] db:setup complete");
}

module.exports = { runSchemaSteps, npmRun };
