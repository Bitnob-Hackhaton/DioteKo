import * as crypto from 'crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { SignJWT } from 'jose';
import { Repository } from 'typeorm';
import { sha256Hex } from '../../../common/utils/sha256.util';
import { stableStringify } from '../../../common/utils/stable-stringify.util';
import { Organization } from '../../identity/entities/organization.entity';
import { Did } from '../entities/did.entity';
import { VerifiableCredential, VerifiableCredentialStatus } from '../entities/verifiable-credential.entity';
import { IssuancePolicyService } from './issuance-policy.service';

export interface IssueCredentialParams {
  /** VC type string, e.g. `AdminCertificate` — see `IssuancePolicyService`. */
  type: string;
  /**
   * The organization issuing this credential. Required (not optional) so
   * that `issue()` cannot run without `IssuancePolicyService.assertCanIssue`
   * checking it first — see the call at the top of `issue()` below.
   */
  organization: Organization;
  issuerDidId: string;
  subjectDidId: string;
  /** Domain-specific claims merged into `vc.credentialSubject`. */
  credentialSubject: Record<string, unknown>;
  /** Defaults to `vc.validityDays` config (old `CERTIFICATE_VALIDITY_DAYS`). */
  validityDays?: number;
  /**
   * Stored on the row, NOT inside the signed payload. Lets a domain module find the credentials one of its own
   * records produced (e.g. `{ requestId }`) so an interrupted attempt can be retired on retry.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Generalized from `backend/src/services/certificateService.js`'s
 * `buildVcDocument` + `signVcDocument` — same JWT-based VC-signing approach
 * (compact JWT, HS256, shared secret via `VC_SIGNING_SECRET`/`VC_ISSUER`),
 * but domain-agnostic: any `type` string, not just certificates. Domain
 * modules (e.g. `modules/admin-certificates`) call this after their own
 * business validation/payment checks — this service does no domain-specific
 * business logic (no PDF, no QR code, no payment linkage).
 *
 * `hash` is a SHA-256 digest of the exact payload object that gets signed
 * (via `stableStringify` so key order never drifts the hash — see that
 * util's doc comment). This is a generalization of the old
 * `bitcoinService.createDocumentHash`, which hashed the raw certificate
 * fields directly; hashing the signed JWT payload instead keeps the hash
 * reproducible from nothing but the JWT itself (see
 * `CredentialVerificationService`), without needing the original
 * domain-specific input object around at verify time.
 *
 * `issue()` requires the issuing `Organization` in its params and calls
 * `IssuancePolicyService.assertCanIssue` as the first thing it does — this
 * is structural, not a convention callers have to remember: there is no way
 * to reach the signing step without the org-type/VC-type policy check
 * passing first.
 */
@Injectable()
export class CredentialIssuanceService {
  private readonly logger = new Logger(CredentialIssuanceService.name);

  constructor(
    @InjectRepository(VerifiableCredential)
    private readonly credentialsRepository: Repository<VerifiableCredential>,
    @InjectRepository(Did) private readonly didsRepository: Repository<Did>,
    private readonly configService: ConfigService,
    private readonly issuancePolicyService: IssuancePolicyService,
  ) {}

  async issue(params: IssueCredentialParams): Promise<VerifiableCredential> {
    const { type, organization, issuerDidId, subjectDidId, credentialSubject, validityDays, metadata } = params;

    this.logger.log(`[START] issue type=${type} issuerDidId=${issuerDidId} subjectDidId=${subjectDidId}`);

    // Must run before anything else: throws ForbiddenException if this
    // organization isn't allowed to issue this VC type. See class doc.
    this.issuancePolicyService.assertCanIssue(organization, type);

    const issuerDid = await this.didsRepository.findOne({ where: { id: issuerDidId } });
    if (!issuerDid) {
      throw new NotFoundException('Issuer DID not found');
    }

    const subjectDid = await this.didsRepository.findOne({ where: { id: subjectDidId } });
    if (!subjectDid) {
      throw new NotFoundException('Subject DID not found');
    }

    const credentialId = crypto.randomUUID();
    const issuedAt = new Date();
    const days = validityDays ?? this.configService.get<number>('vc.validityDays', 365);
    const expiresAt = new Date(issuedAt.getTime() + days * 24 * 60 * 60 * 1000);
    const vcIssuer = this.configService.get<string>('vc.issuer', '');

    const payload = {
      iss: vcIssuer,
      sub: subjectDid.did,
      jti: credentialId,
      iat: Math.floor(issuedAt.getTime() / 1000),
      nbf: Math.floor(issuedAt.getTime() / 1000),
      exp: Math.floor(expiresAt.getTime() / 1000),
      vc: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential', type],
        issuer: issuerDid.did,
        credentialSubject: {
          ...credentialSubject,
          id: subjectDid.did,
        },
      },
    };

    const hash = sha256Hex(stableStringify(payload));

    const secret = new TextEncoder().encode(this.configService.get<string>('vc.signingSecret', ''));
    const jwt = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(payload.iss)
      .setSubject(payload.sub)
      .setIssuedAt(payload.iat)
      .setNotBefore(payload.nbf)
      .setExpirationTime(payload.exp)
      .setJti(payload.jti)
      .sign(secret);

    const credential = await this.credentialsRepository.save(
      this.credentialsRepository.create({
        id: credentialId,
        type,
        issuerDidId,
        subjectDidId,
        jwt,
        hash,
        status: VerifiableCredentialStatus.ACTIVE,
        issuedAt,
        expiresAt,
        metadata: metadata ?? {},
      }),
    );

    this.logger.log(`[RESULT] issued credential id=${credential.id} type=${type} hash=${hash}`);
    return credential;
  }
}
