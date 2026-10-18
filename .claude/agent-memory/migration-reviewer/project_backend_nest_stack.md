---
name: backend-nest-migration-stack
description: backend-nest/ uses TypeORM 0.3.x two-way migrations; fresh DB, no data migration
metadata:
  type: project
---

`backend-nest/` is the DioteKo backend on NestJS + TypeORM 0.3.x + PostgreSQL. Not in production.

- Migrations: `backend-nest/src/database/migrations/`, run via `npm run migration:run` / `migration:revert` / `migration:generate` (scripts in `backend-nest/package.json`; data source `backend-nest/src/database/data-source.ts`, `synchronize: false`).
- Files are hand-editable TS classes with `up()` + `down()` (genuinely two-way). Timestamp-prefixed. Convention: class name and `name` property are both `<PascalName><timestamp>`; file is `<timestamp>-<PascalName>.ts`. `down()` style so far: no `IF EXISTS` on DROP INDEX/CONSTRAINT/COLUMN (see `1786832813470-InitSchema.ts`, `1786839271278-AddAppwriteUserId.ts`).
- Decision (`docs/DECISIONS.md`): "Fresh database, no data migration" — dev DBs are seeded/reset freely; old data has no durability guarantee.
- TypeORM wraps pending migrations in a single transaction by default (`migrationsTransactionMode` unset), so a `TRUNCATE` + later `CREATE INDEX` failure rolls the truncate back.
- DB topology: tooling manages `dioteko_dev_bitnob` (NODE_ENV unset -> `.env`) + `dioteko_test_bitnob` (NODE_ENV=test -> `.env.test`, E2E only) on DioteKo's own `dioteko-postgres` container from the root `docker-compose.dev.yml`, host port 5435 (`DIOTEKO_PG_HOST_PORT`); `dioteko_prod` is a placeholder (`.env.prod`, never created locally). Old `dioteko_nest` is orphaned — not dropped by `scripts/db-reset.js` (its `DATABASES` list is `["dioteko_dev_bitnob","dioteko_test_bitnob"]`), needs one-time manual `dropdb`.
- `.env` / `.env.test` / `.env.prod` are gitignored (only `*.example` committed). `src/database/data-source.ts` requires `DB_NAME` (no default, it throws if unset) and defaults `DB_PORT` to 5435, so a missing `.env.test` cannot silently point the E2E suite (migrate + per-test `TRUNCATE` + seed) at `dioteko_dev_bitnob`. `test/global-setup.ts` guards `NODE_ENV==='test'` but NOT the resolved DB name. Flag any tooling change that widens this.
- E2E per-test reset: `test/utils/reset-database.ts` `resetDatabase()` = `TRUNCATE <every entityMetadatas table where tableType==='regular'> RESTART IDENTITY CASCADE`, then `resetAndSeed()` calls `seedBaseline`. All 29 entity tables are plain tables (no `@ViewEntity`), all-uuid PKs (no serial/identity), no self-FK, so `CASCADE`/`RESTART IDENTITY` are safety no-ops and the non-entity `migrations` table is correctly preserved.
- Seed: `src/database/seeds/seed-baseline.ts` `seedBaseline(app)` is the shared idempotent baseline (check-then-insert); `seed.ts` is a thin CLI wrapper that boots a full `AppModule` context. `scripts/db-setup.js` `runSchemaSteps()` runs `migration:run`+`seed` for dev then again with `NODE_ENV=test` — separate `execSync` child processes, so no pool/singleton leak. Demo users: `issuer-demo`/`admin-demo` (linked to demo org), `holder-demo` (null org), all `@dioteko.local`, shared throwaway password.

**Why:** the schema is managed only by TypeORM migrations (the `@migration-reviewer` agent file is written for TypeORM).
**How to apply:** For `backend-nest/` reviews: verify `down()` reverses `up()` (two-way), and mentally run `migration:generate` after `migration:run` — it should produce an EMPTY migration; if not, entity↔migration drift exists. Known TypeORM footgun: partial-index `where` predicates (`@Index(..., { where })`) often re-generate forever because Postgres normalizes `"status" <> 'failed'` to `(status)::text <> 'failed'::text`. Destructive steps against a `backend-nest/` dev DB are lower-stakes given the fresh-DB decision, but still flag them for any shared/persistent environment and recommend a mirrored destructive step in `down()` for symmetry. See [[schema-rationale-docs]].
