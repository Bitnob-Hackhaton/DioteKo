import { Logger } from '@nestjs/common';
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
});
