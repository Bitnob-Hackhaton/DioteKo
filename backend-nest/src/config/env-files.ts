/**
 * Single source of truth for which dotenv file each NODE_ENV loads.
 *
 * Consumed by:
 *  - `src/app.module.ts` — `ConfigModule.forRoot({ envFilePath })` (the Nest app),
 *  - `src/database/data-source.ts` — the standalone TypeORM CLI data source
 *    (migration:run / migration:generate / migration:revert),
 *  - `src/database/seeds/seed.ts` — the seed CLI.
 *
 * All three run with cwd = `backend-nest/`, so the returned path is resolved
 * relative to that directory.
 *
 *   NODE_ENV=test         -> .env.test   (E2E suite, `dioteko_test`)
 *   NODE_ENV=production    -> .env.prod   (deploy only — not used locally)
 *   development / unset    -> .env        (day-to-day dev, `dioteko_dev`)
 */
export function envFilePathForNodeEnv(nodeEnv: string | undefined = process.env.NODE_ENV): string {
  switch (nodeEnv) {
    case 'test':
      return '.env.test';
    case 'production':
      return '.env.prod';
    default:
      return '.env';
  }
}
