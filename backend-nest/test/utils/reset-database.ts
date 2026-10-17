/**
 * Per-test database reset for the E2E suite.
 *
 * `resetDatabase` truncates every mapped table in one statement
 * (`TRUNCATE ... RESTART IDENTITY CASCADE`) — fast, FK-safe, and it also
 * resets any identity/serial sequences. `resetAndSeed` then re-applies the
 * shared baseline (`seedBaseline`) so each test starts from the same known
 * state regardless of run order.
 *
 * Call `resetAndSeed` in `beforeEach` (chosen over `afterEach`: a failing test
 * leaves its data inspectable, and the next test still gets a clean slate).
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { seedBaseline } from '../../src/database/seeds/seed-baseline';

export async function resetDatabase(dataSource: DataSource): Promise<void> {
  const tables = dataSource.entityMetadatas
    .filter((m) => m.tableType === 'regular')
    .map((m) => `"${m.schema ?? 'public'}"."${m.tableName}"`);

  if (tables.length === 0) return;

  // migrations bookkeeping table is not a mapped entity, so it survives —
  // globalSetup already ran migrations and we don't want to re-run them.
  await dataSource.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}

export async function resetAndSeed(app: INestApplication, dataSource: DataSource): Promise<void> {
  await resetDatabase(dataSource);
  await seedBaseline(app);
}
