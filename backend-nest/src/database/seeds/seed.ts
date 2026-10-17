/**
 * Seed CLI — `npm run seed` (dev DB) / `cross-env NODE_ENV=test npm run seed`
 * (test DB). The root tooling calls both via `npm run db:setup` / `db:reset`.
 *
 * Dev/test only — NEVER run against a real database. The baseline it inserts
 * (roles, one demo org + DID, three demo email+password users) lives in
 * `seed-baseline.ts`, shared with the E2E suite's per-test reset.
 *
 * Bootstraps a full Nest application context so `seedBaseline` can call the
 * real `DidService.createDid`. `AppModule`'s `TypeOrmModule.forRootAsync`
 * resolves its connection from the same NODE_ENV-selected env file as the
 * standalone CLI data source (`src/database/data-source.ts`) — so this runs
 * against the same database `migration:run` just applied.
 */
import 'reflect-metadata';
// FIRST — populates process.env from the NODE_ENV-selected file before
// AppModule (and anything it imports) is evaluated.
import '../../config/load-env';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { seedBaseline } from './seed-baseline';

const logger = new Logger('Seed');

async function seed(): Promise<void> {
  // Dev/test only. A blank `.env.prod` would otherwise let this connect to a
  // real DB and insert the demo admin (`admin-demo@dioteko.local` /
  // `demo-password-change-me`) — a public-repo credential.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[seed] refusing to run with NODE_ENV=production — seed is dev/test only');
  }

  logger.log(`[START] seed (NODE_ENV=${process.env.NODE_ENV ?? 'development'}, DB_NAME=${process.env.DB_NAME ?? 'dioteko_dev'})`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    await seedBaseline(app);
    logger.log('[STATE] seed complete');
  } finally {
    await app.close();
  }
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    logger.error(`[RESULT] seed failed: ${message}`, stack);
    process.exit(1);
  });
