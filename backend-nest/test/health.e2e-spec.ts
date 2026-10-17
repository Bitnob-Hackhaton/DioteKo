/**
 * Reference E2E pattern — copy this for Bitnob / certificates / verification
 * suites.
 *
 *   beforeAll   boot the real AppModule against dioteko_test (migrations already
 *               applied by test/global-setup.ts)
 *   beforeEach  resetAndSeed — TRUNCATE every table + re-apply the shared
 *               baseline, so tests are order-independent
 *   afterAll    close the app (drops the pool)
 *
 * Run: `npm run test:e2e` (sets NODE_ENV=test, migrates, seeds, --runInBand).
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './utils/create-test-app';
import { resetAndSeed } from './utils/reset-database';
import { DEMO_LOGINS, loginAs } from './utils/auth';

describe('Healthz + baseline (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetAndSeed(app, dataSource);
  });

  it('GET /api/healthz → 200 { status: "ok", db: "up" }', async () => {
    const res = await request(app.getHttpServer()).get('/api/healthz');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  it('is public — no Authorization header required', async () => {
    const res = await request(app.getHttpServer()).get('/api/healthz');
    expect(res.status).not.toBe(401);
  });

  it('baseline seed is restored after each reset — demo users can log in', async () => {
    const token = await loginAs(app, DEMO_LOGINS.issuer);
    expect(token).toEqual(expect.any(String));

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ email: DEMO_LOGINS.issuer.email });
  });

  it('resetDatabase wipes rows written by a previous test', async () => {
    // This test only passes if the previous test's session row was truncated.
    const sessions = await dataSource.query('SELECT COUNT(*)::int AS n FROM sessions');
    expect(sessions[0].n).toBe(0);
  });
});
