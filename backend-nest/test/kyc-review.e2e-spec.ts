/**
 * KYC manual review (docs/PLAN_KYC_MANUAL_REVIEW.md) end to end against the real AppModule and dioteko_test, in
 * `manual_only` mode so Idswyft is never reached: the holder sends the photos, an agent decides, the gate follows.
 * The flags are set before the app boots (the config is read once).
 */
process.env.KYC_PROVIDER_MODE = 'manual_only';
process.env.KYC_MRZ_PRECHECK = 'warn';
process.env.KYC_DOC_ENCRYPTION_KEY = 'cd'.repeat(32);

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './utils/create-test-app';
import { resetAndSeed } from './utils/reset-database';
import { DEMO_LOGINS, loginAs } from './utils/auth';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]);

describe('KYC manual review (e2e)', () => {
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
  const bearer = async (creds: { email: string; password: string }) => ({ Authorization: `Bearer ${await loginAs(app, creds)}` });

  /** The holder files a national id dossier: three photos, no provider. Returns the dossier id. */
  async function holderSendsDossier(): Promise<string> {
    const headers = await bearer(DEMO_LOGINS.holder);
    const started = await request(server()).post('/api/kyc/sessions').set(headers).send({ documentType: 'national_id' });
    expect(started.status).toBe(200);
    expect(started.body.kyc).toMatchObject({ status: 'pending', reviewMode: 'agent', mrzPrecheck: 'warn' });
    const sessionId = started.body.kyc.sessionId as string;

    for (const step of ['front', 'back', 'selfie']) {
      const res = await request(server())
        .post(`/api/kyc/sessions/${sessionId}/${step}`)
        .set(headers)
        .attach('file', PNG, { filename: `${step}.png`, contentType: 'image/png' });
      expect(res.status).toBe(200);
    }
    return sessionId;
  }

  it('takes the three photos without any provider and waits for an agent', async () => {
    const sessionId = await holderSendsDossier();

    const status = await request(server()).get('/api/kyc/status').set(await bearer(DEMO_LOGINS.holder));
    expect(status.body.kyc).toMatchObject({ status: 'manual_review', sessionId, reviewMode: 'agent' });

    const [row] = await dataSource.query(`SELECT provider, provider_verification_id, review_origin FROM kyc_verifications`);
    expect(row).toMatchObject({ provider: 'manual', review_origin: 'manual_only' });
    expect(row.provider_verification_id).toMatch(/^manual_/);

    // The copies are encrypted at rest: the PNG bytes never appear in the table.
    const docs: { ciphertext: Buffer }[] = await dataSource.query(`SELECT ciphertext FROM kyc_documents`);
    expect(docs).toHaveLength(3);
    for (const doc of docs) expect(doc.ciphertext.includes(PNG)).toBe(false);
  });

  it('keeps the gate closed while the dossier waits for an agent', async () => {
    await holderSendsDossier();
    const res = await request(server())
      .post('/api/admin-certificates/requests')
      .set(await bearer(DEMO_LOGINS.holder))
      .send({ certificateType: 'residence', submittedData: { fullName: 'Awa Ndiaye' } });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'KYC_REQUIRED' });
  });

  it('shows the queue and the documents to an agent only, and audits the read', async () => {
    const sessionId = await holderSendsDossier();

    expect((await request(server()).get('/api/kyc/review')).status).toBe(401);
    expect((await request(server()).get('/api/kyc/review').set(await bearer(DEMO_LOGINS.holder))).status).toBe(403);

    const agent = await bearer(DEMO_LOGINS.issuer);
    const list = await request(server()).get('/api/kyc/review').set(agent);
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(list.body.items[0]).toMatchObject({
      id: sessionId,
      origin: 'manual_only',
      status: 'manual_review',
      availableDocuments: ['front', 'back', 'selfie'],
    });

    const doc = await request(server()).get(`/api/kyc/review/${sessionId}/documents/front`).set(agent).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(doc.status).toBe(200);
    expect(doc.headers['content-type']).toContain('image/png');
    expect(doc.headers['cache-control']).toBe('no-store');
    expect((doc.body as Buffer).equals(PNG)).toBe(true);

    const [{ count }] = await dataSource.query(`SELECT count(*)::int AS count FROM access_logs WHERE resource_type = 'kyc_verification' AND action = 'read'`);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('lets an agent approve: the holder is verified, the copies are deleted, the gate opens', async () => {
    const sessionId = await holderSendsDossier();
    const agent = await bearer(DEMO_LOGINS.issuer);

    const short = await request(server()).post(`/api/kyc/review/${sessionId}/decision`).set(agent).send({ decision: 'approve', note: 'court' });
    expect(short.status).toBe(400);

    const decided = await request(server())
      .post(`/api/kyc/review/${sessionId}/decision`)
      .set(agent)
      .send({ decision: 'approve', note: 'Nom et selfie concordants avec la pièce.' });
    expect(decided.status).toBe(200);
    expect(decided.body).toEqual({ id: sessionId, status: 'verified' });

    const [row] = await dataSource.query(`SELECT status, reviewed_by, review_note, verified_at FROM kyc_verifications`);
    expect(row.status).toBe('verified');
    expect(row.reviewed_by).not.toBeNull();
    expect(row.verified_at).not.toBeNull();
    expect(await dataSource.query(`SELECT 1 FROM kyc_documents`)).toHaveLength(0);

    const again = await request(server()).post(`/api/kyc/review/${sessionId}/decision`).set(agent).send({ decision: 'reject', note: 'Déjà traité, doublon.' });
    expect(again.status).toBe(409);

    const filed = await request(server())
      .post('/api/admin-certificates/requests')
      .set(await bearer(DEMO_LOGINS.holder))
      .send({ certificateType: 'residence', submittedData: { fullName: 'Awa Ndiaye' } });
    expect(filed.status).toBe(201);
  });

  it('lets an agent reject: the holder may start over', async () => {
    const sessionId = await holderSendsDossier();
    const decided = await request(server())
      .post(`/api/kyc/review/${sessionId}/decision`)
      .set(await bearer(DEMO_LOGINS.issuer))
      .send({ decision: 'reject', note: 'Selfie sans rapport avec la pièce.' });
    expect(decided.body.status).toBe('rejected');

    const status = await request(server()).get('/api/kyc/status').set(await bearer(DEMO_LOGINS.holder));
    expect(status.body.kyc).toMatchObject({ status: 'rejected', failureReason: 'rejected', canRestart: true });
  });

  it('refuses an unknown key and a dossier outside the review circuit', async () => {
    const agent = await bearer(DEMO_LOGINS.issuer);
    expect((await request(server()).get('/api/kyc/review?userId=x').set(agent)).status).toBe(400);
    expect((await request(server()).get('/api/kyc/review/00000000-0000-4000-8000-000000000000').set(agent)).status).toBe(404);
  });
});
