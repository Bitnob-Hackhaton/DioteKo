import { decryptDocument, encryptDocument } from './kyc-document-crypto.util';

const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);

describe('kyc document crypto', () => {
  const plain = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3, 4]);

  it('round-trips a photo', () => {
    const encrypted = encryptDocument(KEY, 'v1', 'front', plain);
    expect(encrypted.ciphertext.equals(plain)).toBe(false);
    expect(decryptDocument(KEY, 'v1', 'front', encrypted).equals(plain)).toBe(true);
  });

  it('uses a fresh iv each time', () => {
    expect(encryptDocument(KEY, 'v1', 'front', plain).iv.equals(encryptDocument(KEY, 'v1', 'front', plain).iv)).toBe(false);
  });

  it('refuses a wrong key', () => {
    expect(() => decryptDocument(OTHER_KEY, 'v1', 'front', encryptDocument(KEY, 'v1', 'front', plain))).toThrow();
  });

  it('refuses a ciphertext moved to another dossier or another side', () => {
    const encrypted = encryptDocument(KEY, 'v1', 'front', plain);
    expect(() => decryptDocument(KEY, 'v2', 'front', encrypted)).toThrow();
    expect(() => decryptDocument(KEY, 'v1', 'selfie', encrypted)).toThrow();
  });

  it('refuses a tampered ciphertext', () => {
    const encrypted = encryptDocument(KEY, 'v1', 'front', plain);
    encrypted.ciphertext[0] ^= 0xff;
    expect(() => decryptDocument(KEY, 'v1', 'front', encrypted)).toThrow();
  });
});
