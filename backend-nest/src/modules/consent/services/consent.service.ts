import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Consent, ConsentStatus } from '../entities/consent.entity';

export interface GrantConsentParams {
  holderDidId: string;
  verifierOrganizationId: string;
  resourceType: string;
  scope: Record<string, unknown>;
  expiresAt?: Date;
}

/**
 * CRUD-shaped consent grants (`consents`). Kept deliberately minimal per the
 * plan's "audit/consent built minimally-but-real" scope decision — no
 * consent-matching/enforcement logic here (e.g. nothing checks `consents`
 * before a verifier reads a credential); this is future work once a real
 * verifier-facing read flow exists. See `Consent`'s doc comment.
 */
@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(
    @InjectRepository(Consent)
    private readonly consentsRepository: Repository<Consent>,
  ) {}

  async grant(params: GrantConsentParams): Promise<Consent> {
    this.logger.log(
      `[START] grant holderDidId=${params.holderDidId} verifierOrganizationId=${params.verifierOrganizationId} resourceType=${params.resourceType}`,
    );

    const consent = await this.consentsRepository.save(
      this.consentsRepository.create({
        holderDidId: params.holderDidId,
        verifierOrganizationId: params.verifierOrganizationId,
        resourceType: params.resourceType,
        scope: params.scope,
        status: ConsentStatus.GRANTED,
        grantedAt: new Date(),
        revokedAt: null,
        expiresAt: params.expiresAt ?? null,
      }),
    );

    this.logger.log(`[RESULT] grant success consentId=${consent.id} holderDidId=${params.holderDidId}`);
    return consent;
  }

  async revoke(consentId: string): Promise<Consent> {
    this.logger.log(`[START] revoke consentId=${consentId}`);

    const consent = await this.consentsRepository.findOne({ where: { id: consentId } });
    if (!consent) {
      throw new NotFoundException('Consent not found');
    }

    if (consent.status === ConsentStatus.REVOKED) {
      this.logger.warn(`[RESULT] revoke rejected consentId=${consentId} reason=already_revoked`);
      throw new BadRequestException('Consent is already revoked');
    }

    consent.status = ConsentStatus.REVOKED;
    consent.revokedAt = new Date();
    await this.consentsRepository.save(consent);

    this.logger.log(`[RESULT] revoke success consentId=${consentId}`);
    return consent;
  }

  async findForHolder(holderDidId: string): Promise<Consent[]> {
    return this.consentsRepository.find({
      where: { holderDidId },
      order: { createdAt: 'DESC' },
    });
  }
}
