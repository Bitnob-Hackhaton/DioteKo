"use strict";
const readline = require("readline");
const { ensureDevDb, ensureDatabases, dropDatabase, DATABASES, POSTGRES_CONTAINER } = require("./docker-dev-up.js");
const { runSchemaSteps } = require("./db-setup.js");

function confirm(msg) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(msg + " [y/N] ", (a) => { rl.close(); resolve(/^y(es)?$/i.test(a.trim())); });
  });
}

async function main() {
  const yes = process.argv.includes("--yes") || process.argv.includes("-y") || process.env.npm_config_yes === "true";
  console.log("[START] db:reset (DESTRUCTIVE)");
  console.log(`[ENTITY] databases to drop: ${DATABASES.join(", ")}`);
  console.log(`[ENTITY] container ${POSTGRES_CONTAINER} (DioteKo's own Postgres — no other project is touched)`);
  if (!yes) {
    const ok = await confirm(`Drop and recreate DioteKo's database(s): ${DATABASES.join(", ")}?`);
    if (!ok) { console.log("[RESULT] aborted by user"); process.exit(0); }
  }
  ensureDevDb();                                  // stack up first (sets DEV_UP_GUARD in process.env)
  for (const db of DATABASES) dropDatabase(db);   // WITH (FORCE) terminates app connections
  ensureDatabases();                              // recreate dioteko_dev + dioteko_test
  runSchemaSteps();                               // migration:run + seed for dioteko_dev AND dioteko_test
  console.log("[STATE] db:reset complete — restart your dev servers if they were running");
}

main().catch((err) => { console.error(`[RESULT] db:reset FAILED: ${err.message}`); process.exit(1); });
