import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VerifiableCredential, VerifiableCredentialStatus } from '../entities/verifiable-credential.entity';

/**
 * Revokes a `verifiable_credentials` row. Only a valid state transition from
 * `active` — attempting to revoke an already-revoked or expired credential
 * is rejected (400) rather than silently no-op'd, so callers get an explicit
 * signal instead of assuming their revoke call had an effect.
 */
@Injectable()
export class RevocationService {
  private readonly logger = new Logger(RevocationService.name);

  constructor(
    @InjectRepository(VerifiableCredential)
    private readonly credentialsRepository: Repository<VerifiableCredential>,
  ) {}

  async revoke(credentialId: string): Promise<VerifiableCredential> {
    this.logger.log(`[START] revoke credentialId=${credentialId}`);

    const credential = await this.credentialsRepository.findOne({ where: { id: credentialId } });
    if (!credential) {
      throw new NotFoundException('Verifiable credential not found');
    }

    if (credential.status !== VerifiableCredentialStatus.ACTIVE) {
      this.logger.warn(`[RESULT] revoke rejected credentialId=${credentialId} reason=already_${credential.status}`);
      throw new BadRequestException(`Credential is already ${credential.status}, cannot revoke`);
    }

    credential.status = VerifiableCredentialStatus.REVOKED;
    const saved = await this.credentialsRepository.save(credential);

    this.logger.log(`[STATE] credential revoked credentialId=${credentialId}`);
    return saved;
  }

  /**
   * Revokes every still-active credential whose `metadata[key]` equals `value`, and returns how many it closed.
   * Used to retire the leftovers of an issuance attempt that was interrupted (crash, failed PDF) before the
   * owning record could be linked to it. Idempotent: nothing active means 0.
   */
  async revokeActiveByMetadata(key: string, value: string): Promise<number> {
    this.logger.log(`[START] revokeActiveByMetadata key=${key} value=${value}`);
    const result = await this.credentialsRepository
      .createQueryBuilder()
      .update(VerifiableCredential)
      .set({ status: VerifiableCredentialStatus.REVOKED })
      .where('status = :active AND metadata ->> :key = :value', {
        active: VerifiableCredentialStatus.ACTIVE,
        key,
        value,
      })
      .execute();
    const count = result.affected ?? 0;
    this.logger.log(`[STATE] revokeActiveByMetadata revoked=${count} key=${key} value=${value}`);
    return count;
  }
}
