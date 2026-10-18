import { Logger } from '@nestjs/common';
import { KycAssessment } from '../kyc-assessment.util';
import { KycAutoAudit } from '../kyc-auto-audit.util';
import { KycDocumentVaultService } from './kyc-document-vault.service';

const KEY = 'ab'.repeat(32);
const photo = { buffer: Buffer.from([0xff, 0xd8, 0xff, 9, 9, 9]), mimetype: 'image/jpeg' };

describe('KycDocumentVaultService', () => {
  let repo: { query: jest.Mock; find: jest.Mock; findOne: jest.Mock; delete: jest.Mock };
  let configValues: Record<string, unknown>;
  let vault: KycDocumentVaultService;

  beforeEach(() => {
    repo = {
      query: jest.fn().mockResolvedValue([{ id: 'doc-1' }]),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    configValues = { 'kyc.docEncryptionKey': KEY, 'kyc.docRetentionDays': 30, 'kyc.fallbackManualReview': true };
    const config = { get: jest.fn((key: string, fallback?: unknown) => (key in configValues ? configValues[key] : fallback)) };
    vault = new KycDocumentVaultService(repo as never, config as never);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  /** The row the vault wrote, as a repository would hand it back. */
  async function storedRow(verificationId: string, kind: string) {
    await vault.store(verificationId, kind as never, photo);
    const [, params] = repo.query.mock.calls.at(-1) as [string, unknown[]];
    const [, , mime, iv, authTag, ciphertext] = params as [string, string, string, Buffer, Buffer, Buffer];
    return { verificationId, kind, mime, iv, authTag, ciphertext };
  }

  it('keeps an encrypted copy that is not the photo, with the retention applied', async () => {
    await expect(vault.store('v1', 'front', photo)).resolves.toBe(true);

    const [sql, params] = repo.query.mock.calls[0] as [string, unknown[]];
    const [verificationId, kind, mime, , , ciphertext, expiresAt] = params as [string, string, string, Buffer, Buffer, Buffer, Date];
    expect([verificationId, kind, mime]).toEqual(['v1', 'front', 'image/jpeg']);
    expect(ciphertext.equals(photo.buffer)).toBe(false);
    const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    // One statement: a retake replaces the side, and nothing is written once the dossier is not pending any more.
    expect(sql).toContain("\"status\" = 'pending'");
    expect(sql).toContain('ON CONFLICT');
  });

  it('reports false, and keeps nothing, when the dossier is no longer pending', async () => {
    repo.query.mockResolvedValue([]);
    await expect(vault.store('v1', 'front', photo)).resolves.toBe(false);
  });

  it('keeps nothing when no flag asks for copies', async () => {
    configValues['kyc.fallbackManualReview'] = false;
    await expect(vault.store('v1', 'front', photo)).resolves.toBe(false);
    expect(repo.query).not.toHaveBeenCalled();
  });

  it('keeps nothing without a valid key, and never reads', async () => {
    configValues['kyc.docEncryptionKey'] = '';
    expect(vault.canStore).toBe(false);
    await expect(vault.store('v1', 'front', photo)).resolves.toBe(false);
    await expect(vault.read('v1', 'front')).resolves.toBeNull();
    expect(repo.query).not.toHaveBeenCalled();
    expect(repo.findOne).not.toHaveBeenCalled();
  });

  it('wants copies in manual_only mode as well', () => {
    configValues['kyc.fallbackManualReview'] = false;
    configValues['kyc.providerMode'] = 'manual_only';
    expect(vault.wanted).toBe(true);
  });

  it('reads back the exact photo it stored', async () => {
    const stored = await storedRow('v1', 'selfie');
    repo.findOne.mockResolvedValue({ ...stored, expiresAt: new Date(Date.now() + 1000) });

    const read = await vault.read('v1', 'selfie');

    expect(read?.buffer.equals(photo.buffer)).toBe(true);
    expect(read?.mimetype).toBe('image/jpeg');
  });

  it('refuses an expired copy', async () => {
    const stored = await storedRow('v1', 'front');
    repo.findOne.mockResolvedValue({ ...stored, expiresAt: new Date(Date.now() - 1000) });
    await expect(vault.read('v1', 'front')).resolves.toBeNull();
  });

  it('returns null, without throwing, when the copy no longer opens (rotated key or moved row)', async () => {
    const stored = await storedRow('v1', 'front');
    repo.findOne.mockResolvedValue({ ...stored, expiresAt: new Date(Date.now() + 1000) });
    await expect(vault.read('another-dossier', 'front')).resolves.toBeNull();
  });

  it('lists the kept sides in a fixed order, without reading any content', async () => {
    repo.find.mockResolvedValue([{ kind: 'selfie' }, { kind: 'front' }]);
    await expect(vault.kindsFor('v1')).resolves.toEqual(['front', 'selfie']);
    expect(repo.find).toHaveBeenCalledWith({ where: { verificationId: 'v1' }, select: { kind: true } });
  });

  it('deletes a dossier copies and purges the expired ones', async () => {
    await vault.deleteFor('v1');
    expect(repo.delete).toHaveBeenCalledWith({ verificationId: 'v1' });
    await expect(vault.purgeExpired()).resolves.toBe(1);
  });

  describe('assessment of the automatic check', () => {
    const assessment: KycAssessment = {
      version: 1,
      readAt: '2026-10-18T09:00:00.000Z',
      providerStep: 'COMPLETE',
      finalResult: 'manual_review',
      rejectionCode: null,
      rejectionDetail: null,
      ocr: { fields: [{ key: 'full_name', value: 'Awa Diallo', confidence: 0.9 }], confidence: 0.8 },
      crossValidation: null,
      faceMatch: { score: 0.87, passed: true, verdict: null },
      liveness: null,
      riskScore: 0.2,
    };

    /** The row the vault wrote, as a repository would hand it back. */
    async function storedAssessmentRow(verificationId: string) {
      await vault.storeAssessment(verificationId, assessment);
      const [, params] = repo.query.mock.calls.at(-1) as [string, unknown[]];
      const [, kind, mime, iv, authTag, ciphertext, expiresAt] = params as [string, string, string, Buffer, Buffer, Buffer, Date];
      return { verificationId, kind, mime, iv, authTag, ciphertext, expiresAt };
    }

    it('keeps it encrypted under the kind "assessment", for an open dossier only, with the retention applied', async () => {
      await expect(vault.storeAssessment('v1', assessment)).resolves.toBe(true);

      const [sql, params] = repo.query.mock.calls[0] as [string, unknown[]];
      const [verificationId, kind, mime, , , ciphertext, expiresAt] = params as [string, string, string, Buffer, Buffer, Buffer, Date];
      expect([verificationId, kind, mime]).toEqual(['v1', 'assessment', 'application/json']);
      // Not readable without the key: neither the name nor the JSON keys appear in the stored bytes.
      expect(ciphertext.toString('utf8')).not.toContain('Awa Diallo');
      expect(ciphertext.toString('latin1')).not.toContain('full_name');
      expect((expiresAt.getTime() - Date.now()) / 86_400_000).toBeGreaterThan(29.9);
      // One statement, and only while the dossier is still open (pending or waiting for the agent).
      expect(sql).toContain("\"status\" IN ('pending', 'manual_review')");
      expect(sql).toContain('ON CONFLICT');
    });

    it('round-trips: reads back exactly what it stored', async () => {
      const stored = await storedAssessmentRow('v1');
      repo.findOne.mockResolvedValue({ ...stored, expiresAt: new Date(Date.now() + 1000) });
      await expect(vault.readAssessment('v1')).resolves.toEqual(assessment);
      expect(repo.findOne).toHaveBeenCalledWith({ where: { verificationId: 'v1', kind: 'assessment' } });
    });

    it('does not open for another dossier, nor with another kind (AAD binding), and never throws', async () => {
      const stored = await storedAssessmentRow('v1');
      repo.findOne.mockResolvedValue({ ...stored, expiresAt: new Date(Date.now() + 1000) });
      await expect(vault.readAssessment('another-dossier')).resolves.toBeNull();
      // A photo ciphertext moved into the assessment row (or the reverse) fails authentication too.
      const photoRow = await storedRow('v1', 'front');
      repo.findOne.mockResolvedValue({ ...photoRow, kind: 'assessment', expiresAt: new Date(Date.now() + 1000) });
      await expect(vault.readAssessment('v1')).resolves.toBeNull();
    });

    it('refuses an expired assessment and an absent one', async () => {
      const stored = await storedAssessmentRow('v1');
      repo.findOne.mockResolvedValue({ ...stored, expiresAt: new Date(Date.now() - 1000) });
      await expect(vault.readAssessment('v1')).resolves.toBeNull();
      repo.findOne.mockResolvedValue(null);
      await expect(vault.readAssessment('v1')).resolves.toBeNull();
    });

    it('keeps nothing when no flag asks for copies or without a valid key, and never reads', async () => {
      configValues['kyc.fallbackManualReview'] = false;
      await expect(vault.storeAssessment('v1', assessment)).resolves.toBe(false);
      configValues['kyc.fallbackManualReview'] = true;
      configValues['kyc.docEncryptionKey'] = '';
      await expect(vault.storeAssessment('v1', assessment)).resolves.toBe(false);
      await expect(vault.readAssessment('v1')).resolves.toBeNull();
      expect(repo.query).not.toHaveBeenCalled();
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it('reports false when the dossier is not open any more (decided or closed)', async () => {
      repo.query.mockResolvedValue([]);
      await expect(vault.storeAssessment('v1', assessment)).resolves.toBe(false);
    });

    it('is never listed as a photo side: it cannot be mistaken for one an agent needs', async () => {
      repo.find.mockResolvedValue([{ kind: 'assessment' }, { kind: 'front' }]);
      await expect(vault.kindsFor('v1')).resolves.toEqual(['front']);
    });

    it('never writes its content to a log', async () => {
      const spy = jest.spyOn(Logger.prototype, 'log');
      await vault.storeAssessment('v1', assessment);
      const logged = spy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).toContain('kyc assessment kept');
      expect(logged).not.toContain('Awa');
    });
  });

  describe('auto audit of a dossier the provider verified by itself', () => {
    const audit: KycAutoAudit = {
      version: 1,
      readAt: '2026-10-18T10:00:00.000Z',
      providerVerdict: 'verified',
      isSandbox: true,
      faceMatch: { score: 0.905, threshold: 0.55, passed: true },
      liveness: { score: 0.91, threshold: null, passed: true },
      crossValidation: { verdict: 'PASS', passed: null, score: 0.88, checks: [{ name: 'date_of_birth', passed: true, score: 1 }] },
      documentExpired: false,
    };

    async function storedAuditRow(verificationId: string) {
      await vault.storeAutoAudit(verificationId, audit);
      const [, params] = repo.query.mock.calls.at(-1) as [string, unknown[]];
      const [, kind, mime, iv, authTag, ciphertext, expiresAt] = params as [string, string, string, Buffer, Buffer, Buffer, Date];
      return { verificationId, kind, mime, iv, authTag, ciphertext, expiresAt };
    }

    it('keeps it encrypted under the kind "auto_audit", for a verified dossier only, with the retention applied', async () => {
      await expect(vault.storeAutoAudit('v1', audit)).resolves.toBe(true);

      const [sql, params] = repo.query.mock.calls[0] as [string, unknown[]];
      const [verificationId, kind, mime, , , ciphertext, expiresAt] = params as [string, string, string, Buffer, Buffer, Buffer, Date];
      expect([verificationId, kind, mime]).toEqual(['v1', 'auto_audit', 'application/json']);
      expect(ciphertext.toString('latin1')).not.toContain('faceMatch');
      // Retention: the same KYC_DOC_RETENTION_DAYS as the photos (30 here), after which the purge removes it.
      expect((expiresAt.getTime() - Date.now()) / 86_400_000).toBeGreaterThan(29.9);
      expect(sql).toContain("\"status\" = 'verified'");
      expect(sql).toContain('ON CONFLICT');
    });

    it('is kept even when no flag asks for photo copies (the audit is not a photo)', async () => {
      configValues['kyc.fallbackManualReview'] = false;
      await expect(vault.storeAutoAudit('v1', audit)).resolves.toBe(true);
    });

    it('keeps nothing without a valid key, and never reads', async () => {
      configValues['kyc.docEncryptionKey'] = '';
      await expect(vault.storeAutoAudit('v1', audit)).resolves.toBe(false);
      await expect(vault.readAutoAudit('v1')).resolves.toBeNull();
      expect(repo.query).not.toHaveBeenCalled();
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it('reports false when the dossier is not verified', async () => {
      repo.query.mockResolvedValue([]);
      await expect(vault.storeAutoAudit('v1', audit)).resolves.toBe(false);
    });

    it('round-trips, and does not open for another dossier or as another kind (AAD binding)', async () => {
      const stored = await storedAuditRow('v1');
      repo.findOne.mockResolvedValue({ ...stored, expiresAt: new Date(Date.now() + 1000) });
      await expect(vault.readAutoAudit('v1')).resolves.toEqual(audit);
      expect(repo.findOne).toHaveBeenCalledWith({ where: { verificationId: 'v1', kind: 'auto_audit' } });
      await expect(vault.readAutoAudit('another-dossier')).resolves.toBeNull();
    });

    it('is not readable past its retention date', async () => {
      const stored = await storedAuditRow('v1');
      repo.findOne.mockResolvedValue({ ...stored, expiresAt: new Date(Date.now() - 1000) });
      await expect(vault.readAutoAudit('v1')).resolves.toBeNull();
    });

    it('is purged with the other expired rows (one delete on expires_at, whatever the kind) and never listed as a photo', async () => {
      await vault.purgeExpired();
      const filter = repo.delete.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(Object.keys(filter)).toEqual(['expiresAt']);
      repo.find.mockResolvedValue([{ kind: 'auto_audit' }]);
      await expect(vault.kindsFor('v1')).resolves.toEqual([]);
    });

    it('writes flags and counts to the log, never a score value read on a person', async () => {
      const spy = jest.spyOn(Logger.prototype, 'log');
      await vault.storeAutoAudit('v1', audit);
      const logged = spy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).toContain('kyc auto audit kept');
      expect(logged).not.toContain('0.905');
    });
  });
});
