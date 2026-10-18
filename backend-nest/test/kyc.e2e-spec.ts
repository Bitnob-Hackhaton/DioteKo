/**
 * KYC (Idswyft) end to end against the real AppModule and dioteko_test_bitnob. No Idswyft instance is needed: the
 * provider is never reached by these cases (gate, ownership, upload checks, unsigned webhook).
 *
 * `KYC_ENFORCEMENT` is left at its default (on) by the test environment; the cases below depend on it.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './utils/create-test-app';
import { resetAndSeed } from './utils/reset-database';
import { DEMO_LOGINS, loginAs } from './utils/auth';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

describe('KYC (e2e)', () => {
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

  const server = () => app.getHttpServer();
  const holderToken = () => loginAs(app, DEMO_LOGINS.holder);
  const fileRequest = (data: { certificateType: string }) => ({
    certificateType: data.certificateType,
    submittedData: { fullName: 'Awa Ndiaye' },
  });

  it('requires a JWT on the holder routes', async () => {
    expect((await request(server()).get('/api/kyc/status')).status).toBe(401);
    expect((await request(server()).post('/api/kyc/sessions').send({ documentType: 'passport' })).status).toBe(401);
  });

  it('reports not_started for a holder without dossier', async () => {
    const res = await request(server()).get('/api/kyc/status').set('Authorization', `Bearer ${await holderToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.kyc).toMatchObject({ status: 'not_started', sessionId: null });
  });

  it('exposes the KYC policy of each type on the public catalog', async () => {
    const res = await request(server()).get('/api/admin-certificates/types');
    const byId = Object.fromEntries((res.body.types as { id: string; kyc: string }[]).map((t) => [t.id, t.kyc]));
    expect(byId).toMatchObject({ residence: 'required', identity: 'required', birth: 'planned', marriage: 'planned', death: 'planned' });
  });

  it('refuses a residence request without KYC with a 403 carrying the KYC_REQUIRED code', async () => {
    const res = await request(server())
      .post('/api/admin-certificates/requests')
      .set('Authorization', `Bearer ${await holderToken()}`)
      .send(fileRequest({ certificateType: 'residence' }));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, code: 'KYC_REQUIRED' });
  });

  it('does not block a birth request (policy planned)', async () => {
    const res = await request(server())
      .post('/api/admin-certificates/requests')
      .set('Authorization', `Bearer ${await holderToken()}`)
      .send(fileRequest({ certificateType: 'birth' }));
    expect(res.status).toBe(201);
  });

  it('accepts a residence request once the holder has a verified dossier', async () => {
    const [{ id: userId }] = await dataSource.query(`SELECT id FROM users WHERE email = $1`, [DEMO_LOGINS.holder.email]);
    await dataSource.query(
      `INSERT INTO kyc_verifications (user_id, provider_verification_id, status, document_type, verified_at) VALUES ($1, 'e2e-prov-1', 'verified', 'passport', now())`,
      [userId],
    );
    const res = await request(server())
      .post('/api/admin-certificates/requests')
      .set('Authorization', `Bearer ${await holderToken()}`)
      .send(fileRequest({ certificateType: 'residence' }));
    expect(res.status).toBe(201);
  });

  it("answers 404 for another user's session and 400 for a non-image upload", async () => {
    const [{ id: userId }] = await dataSource.query(`SELECT id FROM users WHERE email = $1`, [DEMO_LOGINS.admin.email]);
    const [{ id: sessionId }] = await dataSource.query(
      `INSERT INTO kyc_verifications (user_id, provider_verification_id, status, document_type) VALUES ($1, 'e2e-prov-2', 'pending', 'passport') RETURNING id`,
      [userId],
    );
    const token = await holderToken();

    const notMine = await request(server())
      .post(`/api/kyc/sessions/${sessionId}/front`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(notMine.status).toBe(404);

    const notAnImage = await request(server())
      .post(`/api/kyc/sessions/${sessionId}/front`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(notAnImage.status).toBe(400);
  });

  it('stores an unsigned webhook delivery (no secret in test) without acting on it, and recognises a redelivery', async () => {
    const body = { event: 'verification.completed', verification_id: 'e2e-prov-9', data: { ocr_data: { name: 'Awa Ndiaye' } } };
    const first = await request(server()).post('/api/kyc/webhook/idswyft').set('X-Idswyft-Webhook-Id', 'd-1').send(body);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ received: true });

    const again = await request(server()).post('/api/kyc/webhook/idswyft').set('X-Idswyft-Webhook-Id', 'd-1').send(body);
    expect(again.body).toEqual({ received: true, duplicate: true });

    const rows = await dataSource.query(`SELECT processed, signature_valid, processing_error, payload FROM kyc_webhook_events`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ processed: true, signature_valid: false, processing_error: 'unsigned' });
    expect(JSON.stringify(rows[0].payload)).not.toContain('Ndiaye');
  });
});
