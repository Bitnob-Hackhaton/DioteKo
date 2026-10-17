/**
 * Jest globalSetup for the E2E suite. Runs once, before any spec.
 *
 *  1. Hard-guard the target database — NODE_ENV must be "test" AND the
 *     resolved DB_NAME must be the test DB. A missing `.env.test` makes
 *     dotenv a silent no-op and DB_NAME would fall back to `dioteko_dev`;
 *     without this check `globalSetup` + every `beforeEach` TRUNCATE would
 *     then wipe the dev database. This is the single worst E2E pitfall.
 *  2. Apply migrations to the test DB (idempotent — TypeORM skips already-run
 *     ones). Done here as well as in the `pretest:e2e` npm script so
 *     `jest --config test/jest-e2e.js --watch` also works.
 *
 * The per-test data reset lives in `test/utils/reset-database.ts`.
 */
import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import { envFilePathForNodeEnv } from '../src/config/env-files';

const EXPECTED_DB = 'dioteko_test';

export default function globalSetup(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      `[e2e] NODE_ENV must be "test" (got "${process.env.NODE_ENV ?? 'undefined'}"). ` +
        'Run via `npm run test:e2e`.',
    );
  }

  const envFile = envFilePathForNodeEnv();
  dotenv.config({ path: envFile });

  if (process.env.DB_NAME !== EXPECTED_DB) {
    throw new Error(
      `[e2e] refusing to run: resolved DB_NAME="${process.env.DB_NAME ?? 'undefined'}" ` +
        `but the E2E suite must target "${EXPECTED_DB}". ` +
        `Copy backend-nest/.env.test.example to backend-nest/.env.test (loaded from "${envFile}").`,
    );
  }

  // eslint-disable-next-line no-console
  console.log(`[e2e][global-setup] applying migrations to ${process.env.DB_NAME}`);
  execSync('npm run migration:run', {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' },
  });
}
