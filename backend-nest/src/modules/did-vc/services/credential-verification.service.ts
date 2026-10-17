import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { jwtVerify } from 'jose';
import { Repository } from 'typeorm';
import { sha256Hex } from '../../../common/utils/sha256.util';
import { stableStringify } from '../../../common/utils/stable-stringify.util';
import { VerifiableCredential, VerifiableCredentialStatus } from '../entities/verifiable-credential.entity';

export type CredentialVerificationReason = 'revoked' | 'expired' | 'signature_invalid' | 'hash_mismatch';

export interface VerifyCredentialOptions {
  /**
   * An externally-supplied hash (e.g. embedded in a PDF/QR code by a domain
   * module) to compare against the hash recomputed from the VC's own signed
   * payload. Only checked when provided — omit it to verify signature +
   * status + expiry alone.
   */
  comparisonHash?: string;
}

export interface VerifyCredentialResult {
  valid: boolean;
  reason?: CredentialVerificationReason;
  credential: VerifiableCredential;
}

/**
 * Generalized from `certificateService.verifyCertificate` — same core
 * checks (JWT signature/expiry via `jwtVerify`, then an optional hash
 * recompute-and-compare), but works against ANY `verifiable_credentials`
 * row, not just certificates. Used directly by `credentials.controller.ts`'s
 * `GET /credentials/:id` (internal/debug) and available for domain modules
 * (e.g. `modules/admin-certificates`) to call from their own verify flows.
 */
@Injectable()
export class CredentialVerificationService {
  private readonly logger = new Logger(CredentialVerificationService.name);

  constructor(
    @InjectRepository(VerifiableCredential)
    private readonly credentialsRepository: Repository<VerifiableCredential>,
    private readonly configService: ConfigService,
  ) {}

  async verify(credentialId: string, opts: VerifyCredentialOptions = {}): Promise<VerifyCredentialResult> {
    this.logger.log(`[START] verify credentialId=${credentialId}`);

    const credential = await this.credentialsRepository.findOne({ where: { id: credentialId } });
    if (!credential) {
      throw new NotFoundException('Verifiable credential not found');
    }

    if (credential.status === VerifiableCredentialStatus.REVOKED) {
      return this.fail(credential, 'revoked');
    }

    if (credential.status === VerifiableCredentialStatus.EXPIRED) {
      return this.fail(credential, 'expired');
    }

    const secret = new TextEncoder().encode(this.configService.get<string>('vc.signingSecret', ''));

    let payload: Record<string, unknown>;
    try {
      const result = await jwtVerify(credential.jwt, secret, { algorithms: ['HS256'] });
      payload = result.payload;
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === 'ERR_JWT_EXPIRED') {
        return this.fail(credential, 'expired');
      }
      const message = error instanceof Error ? error.message : 'Unknown JWT verification error';
      this.logger.warn(`[RESULT] verify failed credentialId=${credentialId} reason=signature_invalid detail=${message}`);
      return this.fail(credential, 'signature_invalid');
    }

    // Defense in depth: the DB's expiresAt should always match the JWT's own
    // `exp` claim (both are set from the same value at issuance), but check
    // it independently in case they ever diverge.
    if (credential.expiresAt && credential.expiresAt.getTime() < Date.now()) {
      return this.fail(credential, 'expired');
    }

    if (opts.comparisonHash) {
      const recomputedHash = sha256Hex(stableStringify(payload));
      if (recomputedHash !== opts.comparisonHash) {
        return this.fail(credential, 'hash_mismatch');
      }
    }

    this.logger.log(`[RESULT] verify success credentialId=${credentialId}`);
    return { valid: true, credential };
  }

  private fail(credential: VerifiableCredential, reason: CredentialVerificationReason): VerifyCredentialResult {
    this.logger.warn(`[RESULT] verify failed credentialId=${credential.id} reason=${reason}`);
    return { valid: false, reason, credential };
  }
}
