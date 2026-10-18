/**
 * Appwrite Google-OAuth login path — E2E TEMPLATE, skipped by default.
 *
 * `AppwriteService.verifyClientJwt` makes a real `account.get()` round-trip
 * against a live Appwrite instance (deliberate — see docs/DECISIONS.md), so
 * this needs the local dev Appwrite up + a project + API key + the seeded
 * test user. It stays skipped until `APPWRITE_API_KEY` + `APPWRITE_PROJECT_ID`
 * are set in .env.test.
 *
 * To enable:
 *   1. `npm run dev:up` (starts local Appwrite on host port 9000)
 *   2. one-time console setup (docs/DEV_WORKFLOW.md "Appwrite first-run")
 *   3. fill APPWRITE_PROJECT_ID / APPWRITE_API_KEY / APPWRITE_TEST_USER_* in .env.test
 *   4. `npm run seed:appwrite`
 *   5. `npm run test:e2e`
 *
 * The client session + JWT are minted with raw REST calls (no client SDK dep) —
 * the same two calls the mobile app makes after Google OAuth.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './utils/create-test-app';
import { resetAndSeed } from './utils/reset-database';

const enabled = Boolean(process.env.APPWRITE_API_KEY && process.env.APPWRITE_PROJECT_ID);
const describeMaybe = enabled ? describe : describe.skip;

const APPWRITE_ENDPOINT = (process.env.APPWRITE_ENDPOINT ?? 'http://localhost:9000/v1').replace(/\/$/, '');
const PROJECT_ID = process.env.APPWRITE_PROJECT_ID ?? '';

async function mintClientJwt(email: string, password: string): Promise<string> {
  const headers = { 'content-type': 'application/json', 'x-appwrite-project': PROJECT_ID };

  const sessionRes = await fetch(`${APPWRITE_ENDPOINT}/account/sessions/email`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password }),
  });
  if (!sessionRes.ok) {
    throw new Error(`[e2e] Appwrite email session failed: ${sessionRes.status} ${await sessionRes.text()}`);
  }
  const session = (await sessionRes.json()) as { secret?: string };
  if (!session.secret) throw new Error('[e2e] Appwrite session response had no secret');

  const jwtRes = await fetch(`${APPWRITE_ENDPOINT}/account/jwt`, {
    method: 'POST',
    headers: { ...headers, 'x-appwrite-session': session.secret },
  });
  if (!jwtRes.ok) {
    throw new Error(`[e2e] Appwrite JWT mint failed: ${jwtRes.status} ${await jwtRes.text()}`);
  }
  return ((await jwtRes.json()) as { jwt: string }).jwt;
}

describeMaybe('Appwrite login (e2e)', () => {
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

  it('POST /api/auth/appwrite/login exchanges an Appwrite JWT for app tokens', async () => {
    const jwt = await mintClientJwt(
      process.env.APPWRITE_TEST_USER_EMAIL as string,
      process.env.APPWRITE_TEST_USER_PASSWORD as string,
    );

    const res = await request(app.getHttpServer())
      .post('/api/auth/appwrite/login')
      .send({ appwriteJwt: jwt });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));

    // The seeded user is marked email-verified by `seed:appwrite`; the backend
    // refuses unverified accounts, and the response carries a safe user DTO.
    expect(res.body.user).toMatchObject({
      emailVerified: true,
      accountStatus: 'active',
      // The seeded user is email+password (no Google identity linked).
      googleLinked: false,
      roles: expect.arrayContaining(['holder']),
    });
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.body.user).not.toHaveProperty('appwriteUserId');
    expect(res.body.user).not.toHaveProperty('googleId');
  });
});
