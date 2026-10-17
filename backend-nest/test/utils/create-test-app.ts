/**
 * Boots the real `AppModule` as an in-memory HTTP app for E2E specs, wired
 * exactly like `main.ts` (same global prefix / ValidationPipe / filter via
 * `applyGlobalAppConfig`, same `rawBody: true`).
 *
 * Connects to whatever `AppModule`'s TypeOrmModule resolves — which, under
 * NODE_ENV=test, is `dioteko_test` (see src/config/env-files.ts). `globalSetup`
 * has already migrated it; call `resetAndSeed` in a `beforeEach`.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { applyGlobalAppConfig } from '../../src/common/apply-global-app-config';

export interface TestAppContext {
  app: INestApplication;
  dataSource: DataSource;
}

export async function createTestApp(): Promise<TestAppContext> {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('[e2e] createTestApp called without NODE_ENV=test');
  }
  if (process.env.DB_NAME !== 'dioteko_test') {
    throw new Error(
      `[e2e] createTestApp: DB_NAME="${process.env.DB_NAME ?? 'undefined'}" is not the test DB ("dioteko_test"). ` +
        'Copy backend-nest/.env.test.example to backend-nest/.env.test.',
    );
  }

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  applyGlobalAppConfig(app);
  await app.init();

  const dataSource = app.get(DataSource);
  return { app, dataSource };
}
