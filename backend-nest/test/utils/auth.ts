/**
 * E2E auth helpers. `loginAs` drives the real `POST /api/auth/login` and
 * returns the bearer token, so authed specs (Bitnob, certificates, …) can do:
 *
 *   const token = await loginAs(app, DEMO_LOGINS.admin);
 *   await request(app.getHttpServer())
 *     .get('/api/some/protected')
 *     .set('Authorization', `Bearer ${token}`);
 *
 * The demo users come from the shared baseline (`seed-baseline.ts`), so they
 * exist after every `resetAndSeed`.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DEMO_USERS } from '../../src/database/seeds/seed-baseline';

// Derived from the single source of truth in seed-baseline.ts — no drift.
export const DEMO_LOGINS = Object.fromEntries(
  DEMO_USERS.map((u) => [u.role, { email: u.email, password: u.password }]),
) as Record<(typeof DEMO_USERS)[number]['role'], { email: string; password: string }>;

export async function loginAs(
  app: INestApplication,
  creds: { email: string; password: string },
): Promise<string> {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send(creds);
  if (res.status !== 200 || !res.body?.accessToken) {
    throw new Error(`[e2e] loginAs(${creds.email}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}
