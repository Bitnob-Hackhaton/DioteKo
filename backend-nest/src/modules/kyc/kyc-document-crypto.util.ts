import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export interface EncryptedDocument {
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * AES-256-GCM with the dossier id and the side bound as additional authenticated data: a ciphertext copied to another
 * row (another holder's dossier, or front <-> selfie) fails authentication instead of being shown to an agent.
 */
const aad = (verificationId: string, kind: string): Buffer => Buffer.from(`${verificationId}:${kind}`, 'utf8');

export function encryptDocument(keyHex: string, verificationId: string, kind: string, plain: Buffer): EncryptedDocument {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, Buffer.from(keyHex, 'hex'), iv);
  cipher.setAAD(aad(verificationId, kind));
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { iv, authTag: cipher.getAuthTag(), ciphertext };
}

export function decryptDocument(keyHex: string, verificationId: string, kind: string, encrypted: EncryptedDocument): Buffer {
  const decipher = createDecipheriv(ALGORITHM, Buffer.from(keyHex, 'hex'), encrypted.iv);
  decipher.setAAD(aad(verificationId, kind));
  decipher.setAuthTag(encrypted.authTag);
  return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]);
}
