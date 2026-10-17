import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, In, IsNull, LessThan, Not, QueryFailedError, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AccessLogAction, AccessLogActorType, AccessLogResult } from '../../consent/entities/access-log.entity';
import { AccessLogService } from '../../consent/services/access-log.service';
import { CredentialIssuanceService } from '../../did-vc/services/credential-issuance.service';
import { CredentialVerificationService } from '../../did-vc/services/credential-verification.service';
import { DidService } from '../../did-vc/services/did.service';
import { RevocationService } from '../../did-vc/services/revocation.service';
import { Organization, OrganizationType } from '../../identity/entities/organization.entity';
import { AccountStatus, User } from '../../identity/entities/user.entity';
import { RoleCode } from '../../identity/entities/role.entity';
import { BitnobPayout } from '../../bitnob/entities/bitnob-payout.entity';
import {
  isTerminalPayoutStatus,
  reconcilePayoutStatus,
  stripPayoutPii,
  summarizePayoutError,
} from '../../bitnob/payouts.util';
import { PAYOUT_DEFAULT_FROM_ASSET } from '../../bitnob/payouts.constants';
import { BitnobApiError } from '../../bitnob/services/bitnob-http-client.service';
import { BitnobInvoiceSettlementService } from '../../bitnob/services/bitnob-invoice-settlement.service';
import { BitnobLightningService } from '../../bitnob/services/bitnob-lightning.service';
import {
  BankBeneficiaryInput,
  BitnobPayoutRecord,
  BitnobPayoutsService,
} from '../../bitnob/services/bitnob-payouts.service';
import { Payment, PaymentStatus } from '../../lightning/entities/payment.entity';
import { LightningInvoice, LightningInvoiceStatus, LightningProvider } from '../../lightning/entities/lightning-invoice.entity';
import { LightningInvoicesService } from '../../lightning/services/lightning-invoices.service';
import { CreateBitnobPayoutForCertificateDto } from '../dto/create-bitnob-payout-for-certificate.dto';
import {
  ADMIN_CERTIFICATE_BITNOB_PAYOUT_PURPOSE_TYPE,
  ADMIN_CERTIFICATE_REQUEST_PURPOSE_TYPE,
  ADMIN_CERTIFICATE_TYPES,
  ADMIN_CERTIFICATE_VC_TYPE,
  CERTIFICATE_VALIDITIES,
  CertificateValidity,
  getCertificateTypeDefinition,
  SUBMITTED_DATA_ALLOWED_KEYS,
  SUBMITTED_DATA_MAX_VALUE_LENGTH,
  SUBMITTED_DATA_REQUIRED_KEYS,
} from '../admin-certificates.constants';
import { buildValidityWhere, computeValidity } from '../request-validity.util';
import { AdminCertificateRef } from '../entities/admin-certificate-ref.entity';
import { AdminCertificateRequest, AdminCertificateRequestStatus } from '../entities/admin-certificate-request.entity';
import { KycService } from '../../kyc/services/kyc.service';
import { CertificateAnchorService } from './certificate-anchor.service';
import { CertificatePdfService } from './certificate-pdf.service';

/**
 * `bitnob_payouts.status` -> linked `payments.status` mapping. Non-terminal
 * payout states (`quote`/`initiated`/`finalizing`/`pending`/`processing`)
 * leave the ledger row `pending`; `completed` -> `paid`; anything else
 * terminal (`failed`/`expired`) -> `failed`. Anything not listed falls back
 * to `pending` at the call site.
 */
const PAYOUT_STATUS_TO_PAYMENT_STATUS: Record<string, PaymentStatus> = {
  quote: PaymentStatus.PENDING,
  initiated: PaymentStatus.PENDING,
  finalizing: PaymentStatus.PENDING,
  pending: PaymentStatus.PENDING,
  processing: PaymentStatus.PENDING,
  completed: PaymentStatus.PAID,
  failed: PaymentStatus.FAILED,
  expired: PaymentStatus.FAILED,
};

/** A request stuck in `issuing` for longer than this is considered abandoned (a normal issuance takes seconds). */
const ISSUING_STALE_MS = 5 * 60 * 1000;
const RESUME_MIN_INTERVAL_MS = 5000;
const RESUME_BATCH_LIMIT = 20;

export interface CreateInvoiceForRequestResult {
  /** Rail that issued the invoice (always Bitnob). */
  provider: LightningProvider;
  paymentHash: string;
  paymentRequest: string;
  amountSats: number;
  expiresAt: Date | null;
}

/** The invoice a holder is currently expected to pay (read back after leaving the payment screen). */
export interface OpenInvoiceView {
  provider: LightningProvider;
  /** BOLT11 payment request. Not a secret: it is the holder's own invoice. */
  paymentRequest: string;
  amountSats: number;
  expiresAt: Date | null;
}

export interface CheckRequestPaymentStatusResult {
  requestId: string;
  status: AdminCertificateRequestStatus;
  invoiceStatus: LightningInvoiceStatus;
  provider: LightningProvider;
}

/** Who is calling a request-scoped route: the JWT subject and its roles. */
export interface RequestActor {
  userId: string;
  roles: string[];
}

export interface IssueForRequestResult {
  certificateId: string;
  documentHash: string;
  blockchainAnchor: { txId: string; network: string; timestamp: string; blockHeight: number | null };
  validUntil: string;
  qrCodeData: string;
}

export interface VerifyCertificateResult {
  certificateId: string;
  valid: boolean;
  reason?: string;
  certificateType: string;
  issuedAt: Date;
  expiresAt: Date | null;
}

/**
 * Holder-facing view of an `admin_certificate_requests` row. Built field by field (never a spread of the
 * entity) so no `holderUserId`, `organizationId`, DID/VC ids, `paymentHash` or BOLT11 reaches the client.
 * `submittedData` is present on the detail view only.
 */
export interface AdminCertificateRequestView {
  id: string;
  certificateType: string;
  status: AdminCertificateRequestStatus;
  /** From the type catalog; `null` for a legacy type no longer in the catalog. */
  priceSats: number | null;
  paymentId: string | null;
  /** Agent's rejection reason or request for more information; `null` otherwise. */
  decisionReason: string | null;
  /** Public certificate id (`externalReference`), set once the request is issued. */
  certificateId: string | null;
  /** Credential expiry; `null` before issuance (or for a credential without expiry). */
  expiresAt: Date | null;
  /** Derived live from the credential; `null` before issuance. */
  validity: CertificateValidity | null;
  createdAt: Date;
  updatedAt: Date;
  submittedData?: Record<string, unknown>;
}

/** Staff-facing view: the holder view without the internal payment id. */
export type OrganizationRequestView = Omit<AdminCertificateRequestView, 'paymentId'>;

export interface ListMyRequestsFilter {
  limit: number;
  offset: number;
  status?: AdminCertificateRequestStatus[];
  validity?: CertificateValidity;
}

export interface AdminCertificateRequestStats {
  total: number;
  byStatus: Record<AdminCertificateRequestStatus, number>;
  byValidity: Record<CertificateValidity, number>;
}

/** PII-free view of a `bitnob_payouts` row for certificate payout responses. */
export interface CertificatePayoutView {
  id: string;
  status: string;
  reference: string | null;
  settlementAmount: string | null;
  toCurrency: string;
  country: string | null;
  bitnobPayoutId: string | null;
  quoteId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Orchestration service for the whole admin-certificate lifecycle:
 * request -> Lightning invoice -> paid -> issue (VC + PDF) -> download/verify.
 * The only service in `domains/admin-certificates` that touches the DB — the
 * two ported helpers (`CertificateAnchorService`, `CertificatePdfService`)
 * are both pure/stateless by design (see their own doc comments), so all
 * persistence and cross-module orchestration lives here.
 *
 * Two hashes are involved in issuance and it matters which one ends up in
 * which field — see `issueForRequest`'s inline comment for the full
 * reasoning: `CertificateAnchorService.createDocumentHash` (ported verbatim
 * from the old `bitcoinService`) produces a fingerprint of the raw submitted
 * data, used only to feed the SIMULATED anchor call; the `documentHash`
 * actually returned to API callers / printed on the PDF / accepted back by
 * `verifyCertificate` is `VerifiableCredential.hash` (computed by
 * `CredentialIssuanceService`), because that is the one
 * `CredentialVerificationService.verify`'s `comparisonHash` option actually
 * checks against. Returning the anchor fingerprint instead would make the
 * optional `documentHash` on `POST /:certificateId/verify` fail for every
 * honest caller.
 */
@Injectable()
export class AdminCertificatesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdminCertificatesService.name);
  private readonly storageDir: string;
  private resumeTimer: NodeJS.Timeout | null = null;
  private resuming = false;

  constructor(
    @InjectRepository(AdminCertificateRequest)
    private readonly requestsRepository: Repository<AdminCertificateRequest>,
    @InjectRepository(AdminCertificateRef)
    private readonly refsRepository: Repository<AdminCertificateRef>,
    @InjectRepository(Organization)
    private readonly organizationsRepository: Repository<Organization>,
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    @InjectRepository(BitnobPayout)
    private readonly bitnobPayoutsRepository: Repository<BitnobPayout>,
    private readonly dataSource: DataSource,
    private readonly lightningInvoicesService: LightningInvoicesService,
    private readonly didService: DidService,
    private readonly credentialIssuanceService: CredentialIssuanceService,
    private readonly credentialVerificationService: CredentialVerificationService,
    private readonly certificateAnchorService: CertificateAnchorService,
    private readonly certificatePdfService: CertificatePdfService,
    private readonly configService: ConfigService,
    private readonly accessLogService: AccessLogService,
    private readonly bitnobPayoutsService: BitnobPayoutsService,
    private readonly bitnobLightningService: BitnobLightningService,
    private readonly bitnobInvoiceSettlementService: BitnobInvoiceSettlementService,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly revocationService: RevocationService,
    private readonly kycService: KycService,
  ) {
    // Design call: PDFs are rendered once at issuance time and persisted to
    // disk here (not re-derived on every download) — see `issueForRequest`
    // and `getCertificateFile`. No new global config surface was added for
    // this (configuration.ts/env.validation.ts untouched); the directory is
    // read directly from an optional env var with a sane default, scoped
    // entirely to this module.
    this.storageDir = process.env.ADMIN_CERTIFICATES_STORAGE_DIR || path.join(process.cwd(), 'storage', 'admin-certificates');
    fs.mkdirSync(this.storageDir, { recursive: true });
  }

  getTypes(): typeof ADMIN_CERTIFICATE_TYPES {
    return ADMIN_CERTIFICATE_TYPES;
  }

  /** Dev-only payment simulation (`PAYMENT_SIMULATION`); refused at boot in production by `env.validation.ts`. */
  isPaymentSimulationEnabled(): boolean {
    // Re-checked on every call (not only at boot): the flag AND a dev-like environment AND the Bitnob sandbox.
    return (
      this.configService.get<boolean>('payments.simulation', false) === true &&
      ['development', 'test'].includes(this.configService.get<string>('nodeEnv', 'production')) &&
      this.configService.get<string>('bitnob.environment', 'production') === 'sandbox'
    );
  }

  /**
   * Subscribes to "invoice just paid" (every settlement path goes through `LightningInvoicesService.markPaid`)
   * and starts the background pass that resumes what the in-memory callback could not finish (process killed
   * between the payment and the end of the generation). Same shape as `BitnobInvoiceReconcilerService`: plain
   * `setInterval`, `unref()`-ed, off in `NODE_ENV=test` or with an interval of 0, floored at 5 s.
   */
  onModuleInit(): void {
    this.lightningInvoicesService.onInvoicePaid((invoice) => this.handleInvoicePaid(invoice));
    if (this.isPaymentSimulationEnabled()) {
      this.logger.warn('[ENV][WARN] PAYMENT_SIMULATION is ON: any holder can mark their own invoice paid. Dev only.');
    }

    const nodeEnv = this.configService.get<string>('nodeEnv', 'development');
    const configured = Number(this.configService.get<string | number>('ADMIN_CERTIFICATES_RESUME_INTERVAL_MS', 60000));
    if (nodeEnv === 'test' || !(configured > 0)) {
      this.logger.log(`[STATE] issuance resume disabled nodeEnv=${nodeEnv} intervalMs=${configured}`);
      return;
    }
    const intervalMs = Math.max(configured, RESUME_MIN_INTERVAL_MS);
    this.resumeTimer = setInterval(() => {
      void this.resumeStuckRequests();
    }, intervalMs);
    this.resumeTimer.unref();
    this.logger.log(`[STATE] issuance resume enabled intervalMs=${intervalMs}`);
  }

  onModuleDestroy(): void {
    if (this.resumeTimer) {
      clearInterval(this.resumeTimer);
      this.resumeTimer = null;
    }
  }

  /**
   * The issuing organization is the one the holder chose (`dto.organizationId`, which must be an existing
   * municipality/ministry), or else the oldest one (stable order, so the same request never lands on a
   * different organization from one call to the next). If none is seeded yet, this fails with a clear 404
   * rather than fabricating one — seed data lands in `database/seeds/seed.ts`.
   *
   * Initial status: `accepted` for a type that does not require review (the holder can pay right away),
   * `pending` for one that does (an agent of the organization must accept it first).
   */
  async createRequest(
    holderUserId: string,
    dto: { certificateType: string; submittedData: Record<string, unknown>; organizationId?: string },
  ): Promise<AdminCertificateRequestView> {
    this.logger.log(`[START] createRequest holderUserId=${holderUserId}`);

    const typeDefinition = getCertificateTypeDefinition(dto.certificateType);
    if (!typeDefinition) {
      throw new BadRequestException(`Unknown certificate type "${dto.certificateType}"`);
    }
    this.assertSubmittedDataValid(dto.submittedData);
    this.logger.log(`[ENTITY] createRequest certificateType=${dto.certificateType}`);
    await this.kycService.assertVerifiedFor(holderUserId, typeDefinition);

    const issuingTypes = In([OrganizationType.MUNICIPALITY, OrganizationType.MINISTRY]);
    const organization = dto.organizationId
      ? await this.organizationsRepository.findOne({ where: { id: dto.organizationId, type: issuingTypes } })
      : await this.organizationsRepository.findOne({ where: { type: issuingTypes }, order: { createdAt: 'ASC', id: 'ASC' } });

    if (!organization) {
      if (dto.organizationId) {
        this.logger.warn(`[RESULT] createRequest failed reason=unknown_organization organizationId=${dto.organizationId}`);
        throw new BadRequestException('Unknown issuing organization');
      }
      this.logger.warn('[RESULT] createRequest failed reason=no_issuing_organization_seeded');
      throw new NotFoundException(
        'No municipality/ministry organization exists yet to issue admin certificates — seed one before creating requests',
      );
    }

    // A type that needs no review still goes through an agent when automatic issuance is switched off (CERT_AUTO_ISSUE).
    const autoIssue = this.configService.get<boolean>('certificates.autoIssue', false) === true;
    const needsReview = typeDefinition.requiresReview || !autoIssue;
    const status = needsReview
      ? AdminCertificateRequestStatus.PENDING
      : AdminCertificateRequestStatus.ACCEPTED;
    const request = await this.requestsRepository.save(
      this.requestsRepository.create({
        holderUserId,
        organizationId: organization.id,
        certificateType: dto.certificateType,
        submittedData: dto.submittedData,
        status,
      }),
    );

    this.logger.log(
      `[STATE] request ${status} requestId=${request.id} organizationId=${organization.id} requiresReview=${typeDefinition.requiresReview} autoIssue=${autoIssue}`,
    );
    this.startFreeIssuanceIfNeeded(request.id, request.certificateType, status);
    return this.toRequestView(request, true, new Date());
  }

  /**
   * A type priced at 0 skips the payment step: once `accepted` (automatically or by an agent) the certificate is
   * generated right away, in the background. The resume pass covers a crash before it finishes.
   */
  private startFreeIssuanceIfNeeded(
    requestId: string,
    certificateType: string,
    status: AdminCertificateRequestStatus,
  ): void {
    if (status === AdminCertificateRequestStatus.ACCEPTED && getCertificateTypeDefinition(certificateType)?.priceSats === 0) {
      void this.startIssuance(requestId, AdminCertificateRequestStatus.ACCEPTED);
    }
  }

  /**
   * `submittedData` becomes the credential subject verbatim, and a type that does not require review is accepted
   * without a human, so the server only signs what it recognises: a plain object, only the allowed keys, the
   * required keys present, every value a non-empty string of bounded length. Values are never logged (personal data).
   */
  private assertSubmittedDataValid(submittedData: Record<string, unknown>): void {
    if (!submittedData || typeof submittedData !== 'object' || Array.isArray(submittedData)) {
      throw new BadRequestException('submittedData must be an object');
    }
    const allowed: readonly string[] = SUBMITTED_DATA_ALLOWED_KEYS;
    const keys = Object.keys(submittedData);
    const unknownKeys = keys.filter((key) => !allowed.includes(key));
    if (unknownKeys.length > 0) {
      this.logger.warn(`[RESULT] submittedData refused reason=unknown_keys keys=${unknownKeys.join(',')}`);
      throw new BadRequestException(`submittedData has unsupported field(s): ${unknownKeys.join(', ')}`);
    }
    const isValidValue = (value: unknown): boolean =>
      typeof value === 'string' && value.trim().length > 0 && value.length <= SUBMITTED_DATA_MAX_VALUE_LENGTH;
    const missing = SUBMITTED_DATA_REQUIRED_KEYS.filter((key) => !isValidValue(submittedData[key]));
    if (missing.length > 0) {
      throw new BadRequestException(`submittedData is missing required field(s): ${missing.join(', ')}`);
    }
    const invalid = keys.filter((key) => !isValidValue(submittedData[key]));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `submittedData field(s) must be non-empty text of at most ${SUBMITTED_DATA_MAX_VALUE_LENGTH} characters: ${invalid.join(', ')}`,
      );
    }
  }

  /**
   * The caller's own requests, newest first. The filter is always `holderUserId = caller` — including for
   * issuer/admin (they use the `organization/requests` routes instead) — and `submittedData` (personal data) is
   * never part of a list item.
   */
  async listMyRequests(
    holderUserId: string,
    { limit, offset, status, validity }: ListMyRequestsFilter,
  ): Promise<{ requests: AdminCertificateRequestView[]; total: number }> {
    this.logger.log(
      `[START] listMyRequests holderUserId=${holderUserId} limit=${limit} offset=${offset} status=${status ?? '-'} validity=${validity ?? '-'}`,
    );
    const now = new Date();

    const [requests, total] = await this.requestsRepository.findAndCount({
      where: this.buildRequestsWhere({ holderUserId }, { status, validity }, now),
      relations: { adminCertificateRef: { vc: true } },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
      skip: offset,
    });

    this.logger.log(
      `[RESULT] listMyRequests success holderUserId=${holderUserId} count=${requests.length} total=${total}`,
    );
    return { requests: requests.map((request) => this.toRequestView(request, false, now)), total };
  }

  /**
   * Counts of all the caller's requests by workflow status and, for issued ones, by certificate validity.
   * Same `holderUserId` scope as the list; counts are exact (not capped by the list page size).
   */
  async getMyRequestStats(holderUserId: string): Promise<AdminCertificateRequestStats> {
    this.logger.log(`[START] getMyRequestStats holderUserId=${holderUserId}`);
    const now = new Date();
    const statuses = Object.values(AdminCertificateRequestStatus);

    const [statusCounts, validityCounts] = await Promise.all([
      Promise.all(statuses.map((status) => this.requestsRepository.count({ where: { holderUserId, status } }))),
      Promise.all(
        CERTIFICATE_VALIDITIES.map((validity) =>
          this.requestsRepository.count({ where: this.buildRequestsWhere({ holderUserId }, { validity }, now) }),
        ),
      ),
    ]);

    const byStatus = Object.fromEntries(statuses.map((status, i) => [status, statusCounts[i]])) as Record<
      AdminCertificateRequestStatus,
      number
    >;
    const byValidity = Object.fromEntries(CERTIFICATE_VALIDITIES.map((v, i) => [v, validityCounts[i]])) as Record<
      CertificateValidity,
      number
    >;
    const total = statusCounts.reduce((sum, count) => sum + count, 0);

    this.logger.log(`[RESULT] getMyRequestStats success holderUserId=${holderUserId} total=${total}`);
    return { total, byStatus, byValidity };
  }

  /**
   * `scope` is the mandatory ownership filter (`{ holderUserId }` for the citizen routes, `{ organizationId }`
   * for the organization routes); `status` and `validity` only narrow it (validity fragments are OR-ed, each
   * one merged with the scope).
   */
  private buildRequestsWhere(
    scope: FindOptionsWhere<AdminCertificateRequest>,
    { status, validity }: { status?: AdminCertificateRequestStatus[]; validity?: CertificateValidity },
    now: Date,
  ): FindOptionsWhere<AdminCertificateRequest>[] {
    // TypeORM silently drops undefined/null where-values: refuse an empty scope instead of widening the query.
    if (Object.values(scope).some((value) => typeof value !== 'string' || value.length === 0)) {
      throw new ForbiddenException('Missing ownership scope');
    }
    const base: FindOptionsWhere<AdminCertificateRequest> = {
      ...scope,
      ...(status && status.length > 0 ? { status: In(status) } : {}),
    };
    if (!validity) {
      return [base];
    }
    return buildValidityWhere(validity, now).map((fragment) => ({ ...base, ...fragment }));
  }

  /**
   * Requests addressed to the caller's organization (staff side: `issuer`/`admin` roles, enforced by the
   * controller). The organization is read from the DB (`users.organization_id`), never from the JWT or the
   * client. Minimal projection: no payment id and no `submittedData` (personal data) in the list.
   */
  async listOrganizationRequests(
    actorUserId: string,
    { limit, offset, status, validity }: ListMyRequestsFilter,
  ): Promise<{ requests: OrganizationRequestView[]; total: number }> {
    this.logger.log(
      `[START] listOrganizationRequests actorUserId=${actorUserId} limit=${limit} offset=${offset} status=${status ?? '-'} validity=${validity ?? '-'}`,
    );
    const organizationId = await this.resolveActorOrganizationId(actorUserId);
    const now = new Date();

    const [requests, total] = await this.requestsRepository.findAndCount({
      where: this.buildRequestsWhere({ organizationId }, { status, validity }, now),
      relations: { adminCertificateRef: { vc: true } },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
      skip: offset,
    });

    this.logger.log(
      `[RESULT] listOrganizationRequests success organizationId=${organizationId} count=${requests.length} total=${total}`,
    );
    return { requests: requests.map((request) => this.toOrganizationRequestView(request, false, now)), total };
  }

  /**
   * One request of the caller's organization, with the data the citizen submitted (needed to review and issue
   * it). A request of another organization answers 404, same as an unknown id. Every read is written to
   * `access_logs` (who read which request's personal data).
   */
  async getOrganizationRequest(requestId: string, actorUserId: string): Promise<OrganizationRequestView> {
    this.logger.log(`[START] getOrganizationRequest requestId=${requestId} actorUserId=${actorUserId}`);
    const organizationId = await this.resolveActorOrganizationId(actorUserId);

    const request = await this.requestsRepository.findOne({
      where: { id: requestId, organizationId },
      relations: { adminCertificateRef: { vc: true } },
    });

    if (!request) {
      this.logger.warn(
        `[RESULT] getOrganizationRequest not_found requestId=${requestId} organizationId=${organizationId}`,
      );
      throw new NotFoundException('Admin certificate request not found');
    }

    await this.accessLogService.record({
      actorType: AccessLogActorType.ISSUER_ORGANIZATION,
      actorOrganizationId: organizationId,
      actorUserId,
      resourceType: 'admin_certificate_request',
      resourceId: request.id,
      action: AccessLogAction.READ,
      result: AccessLogResult.VALID,
      // Ids only (no personal data): lets an audit report answer "who read this holder's request".
      metadata: { holderUserId: request.holderUserId, certificateType: request.certificateType },
    });

    this.logger.log(`[RESULT] getOrganizationRequest success requestId=${request.id} status=${request.status}`);
    return this.toOrganizationRequestView(request, true, new Date());
  }

  /** Agent accepts a `pending` request: the holder can now pay. */
  acceptRequest(requestId: string, actorUserId: string): Promise<OrganizationRequestView> {
    return this.reviewRequest(requestId, actorUserId, 'accept');
  }

  /** Agent rejects a `pending` request. The reason is mandatory (validated by the DTO) and shown to the holder. */
  rejectRequest(requestId: string, actorUserId: string, reason: string): Promise<OrganizationRequestView> {
    return this.reviewRequest(requestId, actorUserId, 'reject', reason);
  }

  /** Agent asks the holder for a correction or a missing piece instead of rejecting. */
  requestInfo(requestId: string, actorUserId: string, message: string): Promise<OrganizationRequestView> {
    return this.reviewRequest(requestId, actorUserId, 'request_info', message);
  }

  /**
   * One agent decision on a `pending` request of the actor's organization. Organization scope sits in the WHERE
   * (404 for another organization's request, same as an unknown id) and the transition is a conditional UPDATE
   * on `status = 'pending'`, so two agents deciding at once cannot both win (the loser gets 409). Nobody
   * reviews a request they filed themselves. Every decision is written to `access_logs`.
   */
  private async reviewRequest(
    requestId: string,
    actorUserId: string,
    decision: 'accept' | 'reject' | 'request_info',
    text?: string,
  ): Promise<OrganizationRequestView> {
    this.logger.log(`[START] reviewRequest decision=${decision} requestId=${requestId} actorUserId=${actorUserId}`);
    const organizationId = await this.resolveActorOrganizationId(actorUserId);

    const request = await this.requestsRepository.findOne({
      where: { id: requestId, organizationId },
      relations: { adminCertificateRef: { vc: true } },
    });
    if (!request) {
      this.logger.warn(`[RESULT] reviewRequest not_found requestId=${requestId} organizationId=${organizationId}`);
      throw new NotFoundException('Admin certificate request not found');
    }
    if (request.holderUserId === actorUserId) {
      // Four-eyes rule: nobody decides on the request they filed themselves.
      this.logger.warn(`[RESULT] reviewRequest refused: own request requestId=${requestId} actorUserId=${actorUserId}`);
      throw new ForbiddenException('You cannot review your own certificate request');
    }
    if (request.status !== AdminCertificateRequestStatus.PENDING) {
      this.logger.warn(`[RESULT] reviewRequest rejected requestId=${requestId} reason=wrong_status status=${request.status}`);
      throw new ConflictException(`Only a pending request can be reviewed (current status: "${request.status}")`);
    }

    const nextStatus = {
      accept: AdminCertificateRequestStatus.ACCEPTED,
      reject: AdminCertificateRequestStatus.REJECTED,
      request_info: AdminCertificateRequestStatus.NEEDS_INFO,
    }[decision];
    const reviewedAt = new Date();

    const claimed = await this.requestsRepository.update(
      { id: request.id, organizationId, status: AdminCertificateRequestStatus.PENDING },
      { status: nextStatus, decisionReason: text ?? null, reviewedByUserId: actorUserId, reviewedAt },
    );
    if (!claimed.affected) {
      this.logger.warn(`[RESULT] reviewRequest lost the claim requestId=${requestId}`);
      throw new ConflictException('This request was just reviewed by someone else');
    }
    request.status = nextStatus;
    request.decisionReason = text ?? null;
    request.reviewedByUserId = actorUserId;
    request.reviewedAt = reviewedAt;
    request.updatedAt = reviewedAt;

    // The decision is already committed: an audit failure must not turn it into a 500 (a retry would only get
    // a 409), but it must be impossible to miss in the logs.
    try {
      await this.accessLogService.record({
        actorType: AccessLogActorType.ISSUER_ORGANIZATION,
        actorOrganizationId: organizationId,
        actorUserId,
        resourceType: 'admin_certificate_request',
        resourceId: request.id,
        action: AccessLogAction.REVIEW,
        // Only a rejection is "invalid"; the exact decision is in `metadata`.
        result: decision === 'reject' ? AccessLogResult.INVALID : AccessLogResult.VALID,
        // The decision only: the free-text reason stays on the request row, not in the audit metadata.
        metadata: { decision, holderUserId: request.holderUserId, certificateType: request.certificateType },
      });
    } catch (error) {
      this.logger.error(
        `[RESULT] AUDIT_MISSING reviewRequest decision=${decision} requestId=${request.id} reviewer=${actorUserId} detail=${error instanceof Error ? error.name : 'unknown'}`,
      );
    }

    this.logger.log(`[STATE] request ${nextStatus} requestId=${request.id} organizationId=${organizationId} reviewer=${actorUserId}`);
    this.startFreeIssuanceIfNeeded(request.id, request.certificateType, nextStatus);
    return this.toOrganizationRequestView(request, false, reviewedAt);
  }

  /**
   * The holder answers a `needs_info` request with corrected data: it replaces `submittedData` and the request
   * goes back to `pending` for a new review. Holder-only (404 for anyone else) and only from `needs_info`; the
   * transition is a conditional UPDATE so a double submit cannot apply twice.
   */
  async resubmitRequest(
    requestId: string,
    holderUserId: string,
    submittedData: Record<string, unknown>,
  ): Promise<AdminCertificateRequestView> {
    this.logger.log(`[START] resubmitRequest requestId=${requestId} holderUserId=${holderUserId}`);

    this.assertSubmittedDataValid(submittedData);

    const request = await this.requestsRepository.findOne({
      where: { id: requestId, holderUserId },
      relations: { adminCertificateRef: { vc: true } },
    });
    if (!request) {
      this.logger.warn(`[RESULT] resubmitRequest not_found requestId=${requestId} holderUserId=${holderUserId}`);
      throw new NotFoundException('Admin certificate request not found');
    }
    if (request.status !== AdminCertificateRequestStatus.NEEDS_INFO) {
      this.logger.warn(`[RESULT] resubmitRequest rejected requestId=${requestId} reason=wrong_status status=${request.status}`);
      throw new ConflictException(`Only a request waiting for more information can be resubmitted (current status: "${request.status}")`);
    }

    await this.assertKycForRequest(request);

    const claimed = await this.requestsRepository.update(
      { id: request.id, holderUserId, status: AdminCertificateRequestStatus.NEEDS_INFO },
      { submittedData, status: AdminCertificateRequestStatus.PENDING, decisionReason: null } as QueryDeepPartialEntity<AdminCertificateRequest>,
    );
    if (!claimed.affected) {
      this.logger.warn(`[RESULT] resubmitRequest lost the claim requestId=${requestId}`);
      throw new ConflictException('This request was already resubmitted');
    }
    request.submittedData = submittedData;
    request.status = AdminCertificateRequestStatus.PENDING;
    request.decisionReason = null; // answered; the question stays traceable through access_logs
    request.updatedAt = new Date();

    this.logger.log(`[STATE] request pending (resubmitted) requestId=${request.id}`);
    return this.toRequestView(request, true, request.updatedAt);
  }

  private async resolveActorOrganizationId(userId: string): Promise<string> {
    const user = await this.loadActorUser(userId);
    // The JWT is trusted without a DB lookup (roles included), so a suspended account must be refused here.
    if (user && user.accountStatus !== AccountStatus.ACTIVE) {
      this.logger.warn(`[RESULT] organization scope denied: account not active userId=${userId}`);
      throw new ForbiddenException('Your account is not active');
    }
    if (!user?.organizationId) {
      this.logger.warn(`[RESULT] organization scope denied: user not attached to an organization userId=${userId}`);
      throw new ForbiddenException('Your account is not attached to an organization');
    }
    return user.organizationId;
  }

  private toOrganizationRequestView(
    request: AdminCertificateRequest,
    includeSubmittedData: boolean,
    now: Date,
  ): OrganizationRequestView {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { paymentId, ...view } = this.toRequestView(request, includeSubmittedData, now);
    return view;
  }

  /**
   * One of the caller's own requests, with the data they submitted. Holder-only: a request that belongs to
   * someone else (issuers and admins included) answers 404, the same as an unknown id, so the route never
   * confirms that a request exists nor exposes personal data across organizations.
   */
  async getMyRequest(requestId: string, holderUserId: string): Promise<AdminCertificateRequestView> {
    this.logger.log(`[START] getMyRequest requestId=${requestId} holderUserId=${holderUserId}`);

    const request = await this.requestsRepository.findOne({
      where: { id: requestId, holderUserId },
      relations: { adminCertificateRef: { vc: true } },
    });

    if (!request) {
      this.logger.warn(`[RESULT] getMyRequest not_found requestId=${requestId} holderUserId=${holderUserId}`);
      throw new NotFoundException('Admin certificate request not found');
    }

    this.logger.log(`[RESULT] getMyRequest success requestId=${request.id} status=${request.status}`);
    return this.toRequestView(request, true, new Date());
  }

  private toRequestView(
    request: AdminCertificateRequest,
    includeSubmittedData: boolean,
    now: Date,
  ): AdminCertificateRequestView {
    const vc = request.adminCertificateRef?.vc ?? null;
    const view: AdminCertificateRequestView = {
      id: request.id,
      certificateType: request.certificateType,
      status: request.status,
      priceSats: getCertificateTypeDefinition(request.certificateType)?.priceSats ?? null,
      paymentId: request.paymentId,
      decisionReason: request.decisionReason ?? null,
      certificateId: request.adminCertificateRef?.externalReference ?? null,
      expiresAt: vc?.expiresAt ?? null,
      validity: computeValidity(vc, now),
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
    if (includeSubmittedData) {
      view.submittedData = request.submittedData;
    }
    return view;
  }

  /**
   * Loads a request the actor may act on, or answers 404 — the same 404 for an unknown id, a request of
   * another citizen and a request of another organization, so the route never confirms that an id exists.
   * The scope sits in the WHERE of a single query (no second SELECT whose outcome could differ) and is
   * checked BEFORE any provider call or write, so nobody can trigger side effects on a request that is not theirs.
   *  - `holderOrOrgStaff`: the holder (`holderUserId = JWT subject`, whatever the roles), OR issuer/admin staff
   *    attached to the request's organization (read from the DB: the JWT is not trusted for it);
   *  - `holderOnly`: only the holder (staff never creates a payment on a citizen's behalf);
   *  - `orgStaffOnly`: only that staff. A staff member without an active organization matches nothing.
   */
  private async loadAccessibleRequestOrThrow(
    requestId: string,
    actor: RequestActor,
    mode: 'holderOnly' | 'holderOrOrgStaff' | 'orgStaffOnly',
  ): Promise<AdminCertificateRequest> {
    // TypeORM silently drops an `undefined` WHERE value, which would widen the query: fail closed instead.
    if (!requestId || !actor.userId) {
      throw new NotFoundException('Admin certificate request not found');
    }
    const roles = actor.roles ?? [];
    const where: FindOptionsWhere<AdminCertificateRequest>[] = [];
    if (mode !== 'orgStaffOnly') {
      where.push({ id: requestId, holderUserId: actor.userId });
    }
    if (mode !== 'holderOnly' && (roles.includes(RoleCode.ISSUER) || roles.includes(RoleCode.ADMIN))) {
      const organizationId = await this.findActiveActorOrganizationId(actor.userId);
      if (organizationId) {
        where.push({ id: requestId, organizationId });
      }
    }

    const request = where.length ? await this.requestsRepository.findOne({ where }) : null;
    if (!request) {
      this.logger.warn(`[RESULT] request not accessible requestId=${requestId} actorUserId=${actor.userId} mode=${mode}`);
      throw new NotFoundException('Admin certificate request not found');
    }
    return request;
  }

  /** The actor's organization when their account is ACTIVE and attached to one; `null` otherwise (never throws). */
  private async findActiveActorOrganizationId(userId: string): Promise<string | null> {
    const user = await this.loadActorUser(userId);
    return user && user.accountStatus === AccountStatus.ACTIVE ? user.organizationId ?? null : null;
  }

  private loadActorUser(userId: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { id: userId },
      select: { id: true, organizationId: true, accountStatus: true },
    });
  }

  /**
   * Promotes a request to `paid` when its linked `payments` row is already paid (marked by the Bitnob
   * webhook or by a status read). The webhook only touches the payment ledger, so
   * without this a request could stay `awaiting_payment` until someone happened to ask for its status,
   * and `issue` would refuse it.
   */
  private async syncRequestPaymentFromLedger(request: AdminCertificateRequest): Promise<void> {
    if (request.status !== AdminCertificateRequestStatus.AWAITING_PAYMENT || !request.paymentId) {
      return;
    }
    const payment = await this.paymentsRepository.findOne({
      where: { id: request.paymentId },
      relations: ['lightningInvoice'],
    });
    if (payment?.status === PaymentStatus.PAID && payment.lightningInvoice) {
      // Same checks as the automatic path (linkage, rail, price), then a conditional promotion: never `save(request)`.
      await this.verifyPaidPayment(request, payment, payment.lightningInvoice);
    }
  }

  /**
   * Closes the loop for a request whose invoice can no longer be paid: when Bitnob reports the linked
   * invoice expired or failed (or the payment is already failed), the request goes back to `accepted` and
   * loses its `payment_id`, so a new invoice can be created. Conditional on the request still pointing at
   * that payment, so a concurrent call cannot reopen a request that was just re-invoiced. Bitnob only.
   */
  private async reopenRequestIfInvoiceClosed(request: AdminCertificateRequest): Promise<void> {
    if (request.status !== AdminCertificateRequestStatus.AWAITING_PAYMENT || !request.paymentId) {
      return;
    }
    const invoice = await this.refreshRequestPayment(request);
    const payment = invoice
      ? await this.paymentsRepository.findOne({ where: { id: request.paymentId } })
      : null;
    const closed =
      invoice?.provider === LightningProvider.BITNOB &&
      (invoice.status === LightningInvoiceStatus.EXPIRED || invoice.status === LightningInvoiceStatus.FAILED) &&
      payment?.status !== PaymentStatus.PAID;
    if (!closed) {
      return;
    }
    const reopened = await this.requestsRepository.update(
      { id: request.id, status: AdminCertificateRequestStatus.AWAITING_PAYMENT, paymentId: request.paymentId },
      { status: AdminCertificateRequestStatus.ACCEPTED, paymentId: null },
    );
    if (reopened.affected) {
      request.status = AdminCertificateRequestStatus.ACCEPTED;
      request.paymentId = null;
      this.logger.log(`[STATE] request reopened (invoice ${invoice.status}) requestId=${request.id}`);
    }
  }

  /**
   * Reads the provider so the ledger reflects reality: asks Bitnob (the webhook is only a signal and can be
   * lost), and a failed read leaves the invoice as it was instead of failing the caller. Returns the invoice,
   * or `null` when the request has no linked invoice.
   */
  private async refreshRequestPayment(request: AdminCertificateRequest): Promise<LightningInvoice | null> {
    if (!request.paymentId) {
      return null;
    }
    const payment = await this.paymentsRepository.findOne({
      where: { id: request.paymentId },
      relations: ['lightningInvoice'],
    });
    const invoice = payment?.lightningInvoice ?? null;
    if (!invoice) {
      return null;
    }

    if (invoice.provider === LightningProvider.BITNOB) {
      try {
        const settlement = await this.bitnobInvoiceSettlementService.settleIfPaid(invoice);
        this.logger.log(`[RESULT] refreshRequestPayment requestId=${request.id} outcome=${settlement.outcome}`);
      } catch (error) {
        if (!(error instanceof BitnobApiError)) {
          throw error;
        }
        this.logger.warn(
          `[RESULT] refreshRequestPayment Bitnob read failed requestId=${request.id} status=${error.status ?? 'n/a'} — left unchanged`,
        );
      }
    }
    return invoice;
  }

  /**
   * An invoice still open for this request that was created by an earlier attempt but never linked to it.
   * Only reused when it asks for exactly the catalog price: an invoice created elsewhere for this request id
   * with another amount (e.g. 1 sat) must never be accepted as the payment of the certificate.
   */
  private async findOpenInvoiceForRequest(
    requestId: string,
    expectedAmountSats: number,
  ): Promise<{ invoice: LightningInvoice; payment: Payment } | null> {
    const payment = await this.paymentsRepository.findOne({
      where: {
        purposeType: ADMIN_CERTIFICATE_REQUEST_PURPOSE_TYPE,
        purposeId: requestId,
        status: PaymentStatus.PENDING,
      },
      relations: ['lightningInvoice'],
      order: { createdAt: 'DESC' },
    });
    if (payment?.lightningInvoice?.status === LightningInvoiceStatus.PENDING) {
      if (payment.lightningInvoice.amountSats !== expectedAmountSats) {
        this.logger.error(
          `[RESULT] findOpenInvoiceForRequest ignored invoice with unexpected amount requestId=${requestId} ` +
            `invoiceId=${payment.lightningInvoice.id} expected=${expectedAmountSats} got=${payment.lightningInvoice.amountSats}`,
        );
        return null;
      }
      return { invoice: payment.lightningInvoice, payment };
    }
    return null;
  }

  async createInvoiceForRequest(requestId: string, actor: RequestActor): Promise<CreateInvoiceForRequestResult> {
    this.logger.log(`[START] createInvoiceForRequest requestId=${requestId} actorUserId=${actor.userId}`);

    const request = await this.loadAccessibleRequestOrThrow(requestId, actor, 'holderOnly');

    const typeDefinition = getCertificateTypeDefinition(request.certificateType);
    if (!typeDefinition) {
      throw new BadRequestException(`Unknown certificate type "${request.certificateType}" recorded on this request`);
    }

    // An expired or failed Bitnob invoice must not strand the request: reopen it for a new invoice.
    await this.reopenRequestIfInvoiceClosed(request);

    if (request.status !== AdminCertificateRequestStatus.ACCEPTED) {
      this.logger.warn(
        `[RESULT] createInvoiceForRequest rejected requestId=${requestId} reason=wrong_status status=${request.status}`,
      );
      throw new BadRequestException(
        `Request must be accepted by the organization before it can be paid (current status: "${request.status}")`,
      );
    }

    if (typeDefinition.priceSats <= 0) {
      throw new BadRequestException('This certificate is free: it is generated without a payment');
    }

    // Before the claim and before any money moves: a holder without the required identity check cannot pay.
    // (Not re-checked at issuance: a request already paid must not be stranded.)
    await this.kycService.assertVerifiedFor(request.holderUserId, typeDefinition);

    // Claim the request atomically BEFORE any provider call: two concurrent calls (a double tap) cannot both
    // create an invoice, so a payer can never pay one that the request does not point at.
    const claimed = await this.requestsRepository.update(
      { id: request.id, status: AdminCertificateRequestStatus.ACCEPTED },
      { status: AdminCertificateRequestStatus.AWAITING_PAYMENT },
    );
    if (!claimed.affected) {
      this.logger.warn(`[RESULT] createInvoiceForRequest lost the claim requestId=${requestId}`);
      throw new ConflictException('An invoice is already being created for this request');
    }
    request.status = AdminCertificateRequestStatus.AWAITING_PAYMENT;

    try {
      const { invoice, payment } = await this.issueInvoiceForClaimedRequest(request, typeDefinition);

      request.paymentId = payment.id;
      await this.requestsRepository.update(
        { id: request.id, status: AdminCertificateRequestStatus.AWAITING_PAYMENT },
        { paymentId: payment.id },
      );
      this.logger.log(
        `[STATE] request awaiting_payment requestId=${request.id} paymentId=${payment.id} provider=${invoice.provider}`,
      );

      return {
        provider: invoice.provider,
        paymentHash: invoice.paymentHash,
        paymentRequest: invoice.paymentRequest,
        amountSats: invoice.amountSats,
        expiresAt: invoice.expiresAt,
      };
    } catch (error) {
      // Give the claim back so the holder can retry. An invoice created at the provider but not recorded is
      // logged by `issueInvoiceForClaimedRequest` (orphan); a retry reuses it or issues a fresh attempt.
      await this.requestsRepository.update(
        { id: request.id, status: AdminCertificateRequestStatus.AWAITING_PAYMENT, paymentId: IsNull() },
        { status: AdminCertificateRequestStatus.ACCEPTED },
      );
      request.status = AdminCertificateRequestStatus.ACCEPTED;
      throw error;
    }
  }

  private async issueInvoiceForClaimedRequest(
    request: AdminCertificateRequest,
    typeDefinition: { name: string; priceSats: number },
  ): Promise<{ invoice: LightningInvoice; payment: Payment }> {
    const requestId = request.id;

    // A previous attempt may have created the invoice and failed before linking it: reuse it.
    const open = await this.findOpenInvoiceForRequest(requestId, typeDefinition.priceSats);
    if (open) {
      this.logger.log(`[STATE] reusing open invoice requestId=${requestId} invoiceId=${open.invoice.id}`);
      return open;
    }

    const memo = `${typeDefinition.name} - request ${requestId}`;

    // `dkinv_<request id>` is Bitnob's idempotency key; a later attempt (after an expired or failed invoice)
    // gets an attempt suffix so Bitnob does not treat it as a duplicate of the closed one.
    const previousAttempts = await this.paymentsRepository.count({
      where: { purposeType: ADMIN_CERTIFICATE_REQUEST_PURPOSE_TYPE, purposeId: requestId },
    });
    const reference = previousAttempts === 0 ? `dkinv_${requestId}` : `dkinv_${requestId}_${previousAttempts}`;

    this.logger.log(`[CALL] BitnobLightningService.createInvoice requestId=${requestId} amountSats=${typeDefinition.priceSats}`);
    let bitnobInvoice;
    try {
      bitnobInvoice = await this.bitnobLightningService.createInvoice({
        amountSats: typeDefinition.priceSats,
        description: memo,
        reference,
      });
    } catch (error) {
      if (error instanceof BitnobApiError) {
        this.logger.error(`[RESULT] createInvoiceForRequest Bitnob failed requestId=${requestId} status=${error.status ?? 'n/a'}`);
        throw new BadGatewayException('The payment provider could not create the invoice');
      }
      this.logger.error(`[RESULT] createInvoiceForRequest unexpected provider answer requestId=${requestId}`);
      throw new BadGatewayException('The payment provider returned an unexpected answer');
    }

    // Fail closed on a unit or amount surprise rather than showing a payer the wrong price. The invoice
    // already exists at Bitnob and is never shown or recorded: log it so it can be found.
    if (bitnobInvoice.amountSats !== typeDefinition.priceSats) {
      this.logger.error(
        `[RESULT] createInvoiceForRequest amount mismatch ORPHAN externalId=${bitnobInvoice.externalId} requestId=${requestId} ` +
          `expected=${typeDefinition.priceSats} got=${bitnobInvoice.amountSats}`,
      );
      throw new BadGatewayException('The payment provider returned an unexpected invoice amount');
    }

    try {
      return await this.lightningInvoicesService.recordInvoice({
        provider: LightningProvider.BITNOB,
        externalId: bitnobInvoice.externalId,
        paymentRequest: bitnobInvoice.paymentRequest,
        paymentHash: bitnobInvoice.paymentHash,
        amountSats: bitnobInvoice.amountSats,
        expiresAt: bitnobInvoice.expiresAt,
        memo,
        purposeType: ADMIN_CERTIFICATE_REQUEST_PURPOSE_TYPE,
        purposeId: requestId,
        organizationId: request.organizationId,
      });
    } catch (error) {
      this.logger.error(
        `[RESULT] createInvoiceForRequest recordInvoice failed ORPHAN externalId=${bitnobInvoice.externalId} ` +
          `paymentHash=${bitnobInvoice.paymentHash} requestId=${requestId}`,
      );
      throw error;
    }
  }

  /**
   * The still-payable invoice of the holder's own request, so the payment screen can be reopened: the BOLT11 is
   * only returned once, at creation. 404 (same message) when the request is not the caller's, has no invoice, or
   * the invoice is no longer payable (expired, failed, paid) — never another request's invoice.
   */
  async getOpenInvoice(requestId: string, actor: RequestActor): Promise<OpenInvoiceView> {
    this.logger.log(`[START] getOpenInvoice requestId=${requestId} actorUserId=${actor.userId}`);
    const request = await this.loadAccessibleRequestOrThrow(requestId, actor, 'holderOnly');
    const notFound = () => new NotFoundException('No open invoice for this request');

    if (request.status !== AdminCertificateRequestStatus.AWAITING_PAYMENT || !request.paymentId) {
      throw notFound();
    }
    const payment = await this.paymentsRepository.findOne({
      where: { id: request.paymentId },
      relations: ['lightningInvoice'],
    });
    const invoice = payment?.lightningInvoice ?? null;
    if (
      !payment ||
      payment.purposeId !== request.id ||
      payment.status !== PaymentStatus.PENDING ||
      !invoice ||
      invoice.status !== LightningInvoiceStatus.PENDING ||
      (invoice.expiresAt && invoice.expiresAt.getTime() <= Date.now())
    ) {
      this.logger.log(`[RESULT] getOpenInvoice none open requestId=${requestId}`);
      throw notFound();
    }
    this.logger.log(`[RESULT] getOpenInvoice success requestId=${requestId} invoiceId=${invoice.id}`);
    return {
      provider: invoice.provider,
      paymentRequest: invoice.paymentRequest,
      amountSats: invoice.amountSats,
      expiresAt: invoice.expiresAt ?? null,
    };
  }

  async checkRequestPaymentStatus(requestId: string, actor: RequestActor): Promise<CheckRequestPaymentStatusResult> {
    this.logger.log(`[START] checkRequestPaymentStatus requestId=${requestId} actorUserId=${actor.userId}`);

    const request = await this.loadAccessibleRequestOrThrow(requestId, actor, 'holderOrOrgStaff');

    if (!request.paymentId) {
      throw new BadRequestException('Request has no associated payment yet — create a Lightning invoice first');
    }

    const invoice = await this.refreshRequestPayment(request);
    if (!invoice) {
      throw new NotFoundException('Linked Lightning invoice not found for this request payment');
    }

    await this.syncRequestPaymentFromLedger(request);

    return {
      requestId: request.id,
      status: request.status,
      invoiceStatus: invoice.status,
      provider: invoice.provider,
    };
  }

  async issueForRequest(requestId: string, actor: RequestActor): Promise<IssueForRequestResult> {
    this.logger.log(`[START] issueForRequest requestId=${requestId} issuerUserId=${actor.userId}`);

    // Scope first: another organization's request answers 404 before any Bitnob call or write.
    const request = await this.loadAccessibleRequestOrThrow(requestId, actor, 'orgStaffOnly');
    if (request.holderUserId === actor.userId) {
      // Four-eyes rule: nobody issues the certificate they asked for themselves.
      this.logger.warn(`[RESULT] issueForRequest refused: self-issue requestId=${requestId} actorUserId=${actor.userId}`);
      throw new ForbiddenException('You cannot issue your own certificate request');
    }
    if (request.status === AdminCertificateRequestStatus.AWAITING_PAYMENT) {
      // The Bitnob webhook may have failed or never arrived: ask Bitnob before refusing a paid request.
      await this.refreshRequestPayment(request);
    }
    await this.syncRequestPaymentFromLedger(request);

    if (request.status !== AdminCertificateRequestStatus.PAID) {
      this.logger.warn(`[RESULT] issueForRequest rejected requestId=${requestId} reason=not_paid status=${request.status}`);
      throw new BadRequestException(`Request must be in "paid" status to issue (current: "${request.status}")`);
    }

    // Same atomic claim as the automatic path: a manual call racing the automatic generation (or another agent)
    // cannot issue a second certificate.
    const token = await this.claimForIssuance(request.id, AdminCertificateRequestStatus.PAID);
    if (!token) {
      this.logger.warn(`[RESULT] issueForRequest lost the claim requestId=${requestId}`);
      throw new ConflictException('This certificate is already being generated');
    }
    try {
      // Re-read after the claim (as the automatic path does): a stale entity could miss `paymentSimulated`.
      const claimed = await this.requestsRepository.findOne({ where: { id: request.id } });
      if (!claimed) {
        throw new NotFoundException('Admin certificate request not found');
      }
      return await this.performIssuance(claimed, token);
    } catch (error) {
      await this.releaseIssuanceClaim(request.id, AdminCertificateRequestStatus.PAID, token);
      throw error;
    }
  }

  /** Atomic `from -> issuing`: exactly one concurrent caller gets a token, the others get `null`. */
  private async claimForIssuance(
    requestId: string,
    from: AdminCertificateRequestStatus.PAID | AdminCertificateRequestStatus.ACCEPTED,
  ): Promise<string | null> {
    const token = crypto.randomUUID();
    const claimed = await this.requestsRepository.update(
      { id: requestId, status: from },
      { status: AdminCertificateRequestStatus.ISSUING, issuingToken: token },
    );
    return claimed.affected ? token : null;
  }

  /**
   * Gives the claim back after a failed generation so it can be retried (manual call or resume pass). Conditional
   * on the worker's own token: a worker that lost its claim to the resume pass cannot reset the winner.
   */
  private async releaseIssuanceClaim(
    requestId: string,
    to: AdminCertificateRequestStatus.PAID | AdminCertificateRequestStatus.ACCEPTED,
    token: string,
  ): Promise<void> {
    const released = await this.requestsRepository.update(
      { id: requestId, status: AdminCertificateRequestStatus.ISSUING, issuingToken: token },
      { status: to, issuingToken: null },
    );
    if (released.affected) {
      this.logger.log(`[STATE] request back to ${to} after a failed generation requestId=${requestId}`);
    }
  }

  /** KYC gate for an existing request (resubmit, free generation): looks up the type and the holder. */
  private async assertKycForRequest(request: AdminCertificateRequest): Promise<void> {
    const typeDefinition = getCertificateTypeDefinition(request.certificateType);
    if (typeDefinition) {
      await this.kycService.assertVerifiedFor(request.holderUserId, typeDefinition);
    }
  }

  /**
   * Automatic generation, never throws: claims `from -> issuing`, generates, ends `issued`. A failure releases the
   * claim (the request stays retryable: manual `issue` or the next resume pass) and is logged with the request id.
   */
  private async startIssuance(
    requestId: string,
    from: AdminCertificateRequestStatus.PAID | AdminCertificateRequestStatus.ACCEPTED,
  ): Promise<void> {
    this.logger.log(`[START] startIssuance requestId=${requestId} from=${from}`);
    try {
      const token = await this.claimForIssuance(requestId, from);
      if (!token) {
        this.logger.log(`[STATE] startIssuance lost the claim (already issuing or issued) requestId=${requestId}`);
        return;
      }
      const request = await this.requestsRepository.findOne({ where: { id: requestId } });
      if (!request) {
        this.logger.error(`[RESULT] startIssuance FAILED request vanished after claim requestId=${requestId}`);
        return;
      }
      try {
        if (from === AdminCertificateRequestStatus.ACCEPTED) {
          // Free type: no payment step, so the identity check is the last gate before generation.
          await this.assertKycForRequest(request);
        }
        await this.performIssuance(request, token);
      } catch (error) {
        if (error instanceof ForbiddenException) {
          // Identity check not met (free type): an expected wait, not a failure. The claim is released; the resume
          // pass tries again once the holder is verified.
          this.logger.warn(`[RESULT] startIssuance waiting requestId=${requestId} reason=kyc_required`);
        } else {
          this.logger.error(
            `[RESULT] startIssuance FAILED requestId=${requestId} detail=${error instanceof Error ? error.name : 'unknown'} — will be retried`,
          );
        }
        await this.releaseIssuanceClaim(requestId, from, token);
      }
    } catch (error) {
      this.logger.error(
        `[RESULT] startIssuance FAILED requestId=${requestId} detail=${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }

  /**
   * Reaction to "this invoice just became paid". Ignores invoices that do not belong to a certificate request.
   * A paid invoice that its request does not point at (the request was reopened or re-invoiced meanwhile) is real
   * money without a certificate: nothing is issued and `PAID_UNLINKED` is logged for a human.
   */
  async handleInvoicePaid(invoice: LightningInvoice): Promise<void> {
    const payment = await this.paymentsRepository.findOne({
      where: { lightningInvoiceId: invoice.id, purposeType: ADMIN_CERTIFICATE_REQUEST_PURPOSE_TYPE },
    });
    if (!payment) {
      return;
    }
    this.logger.log(`[START] handleInvoicePaid invoiceId=${invoice.id} requestId=${payment.purposeId}`);

    const request = await this.requestsRepository.findOne({ where: { id: payment.purposeId } });
    await this.confirmPaidAndIssue(request, payment, invoice);
  }

  /**
   * Shared by the paid-callback, the resume pass and the ledger sync, so none of them can bypass a check. True only
   * when the paid invoice really is THE payment of THIS request, in a payable state, issued by Bitnob, for
   * at least the catalog price; an `awaiting_payment` request is then promoted to `paid` (conditional UPDATE).
   * Anything else is logged for a human (money received, nothing issued) and returns false.
   */
  private async verifyPaidPayment(
    request: AdminCertificateRequest | null,
    payment: Payment,
    invoice: LightningInvoice,
  ): Promise<boolean> {
    const price = request ? getCertificateTypeDefinition(request.certificateType)?.priceSats : undefined;
    if (
      !request ||
      request.paymentId !== payment.id ||
      payment.purposeType !== ADMIN_CERTIFICATE_REQUEST_PURPOSE_TYPE ||
      payment.purposeId !== request.id
    ) {
      this.logger.error(
        `[RESULT] PAID_UNLINKED invoiceId=${invoice.id} paymentId=${payment.id} requestId=${payment.purposeId} — paid invoice not linked to its request, nothing issued`,
      );
      return false;
    }
    if (request.status !== AdminCertificateRequestStatus.AWAITING_PAYMENT && request.status !== AdminCertificateRequestStatus.PAID) {
      this.logger.log(`[STATE] paid invoice, nothing to do requestId=${request.id} status=${request.status}`);
      return false;
    }
    if (invoice.provider !== LightningProvider.BITNOB) {
      this.logger.error(
        `[RESULT] PROVIDER_MISMATCH invoiceId=${invoice.id} requestId=${request.id} provider=${invoice.provider} expected=${LightningProvider.BITNOB} — nothing issued`,
      );
      return false;
    }
    if (price === undefined || !this.paymentCoversPrice(price, payment, invoice)) {
      this.logger.error(
        `[RESULT] AMOUNT_MISMATCH invoiceId=${invoice.id} requestId=${request.id} expected=${price ?? 'unknown type'} invoice=${invoice.amountSats} payment=${payment.amountSats ?? 'n/a'} — nothing issued`,
      );
      return false;
    }

    if (request.status === AdminCertificateRequestStatus.AWAITING_PAYMENT) {
      const promoted = await this.requestsRepository.update(
        { id: request.id, status: AdminCertificateRequestStatus.AWAITING_PAYMENT, paymentId: payment.id },
        { status: AdminCertificateRequestStatus.PAID },
      );
      if (promoted.affected) {
        request.status = AdminCertificateRequestStatus.PAID;
        this.logger.log(`[STATE] request paid requestId=${request.id}`);
      }
    }
    return true;
  }

  private async confirmPaidAndIssue(
    request: AdminCertificateRequest | null,
    payment: Payment,
    invoice: LightningInvoice,
  ): Promise<void> {
    const verified = await this.verifyPaidPayment(request, payment, invoice);
    if (verified && request) {
      await this.startIssuance(request.id, AdminCertificateRequestStatus.PAID);
    }
  }

  private paymentCoversPrice(price: number, payment: Payment, invoice: LightningInvoice): boolean {
    return invoice.amountSats >= price && (payment.amountSats === null || payment.amountSats >= price);
  }

  /**
   * Safety net for what the in-memory paid-callback could not finish. Resumes (bounded batch, one failure never
   * stops the others): requests still `awaiting_payment` whose payment is already paid, requests `paid`, requests
   * stuck in `issuing` past `ISSUING_STALE_MS` (re-claimed with a conditional update on the stale `updated_at`, so a
   * slow-but-alive generation is not doubled), and free requests left `accepted`.
   */
  async resumeStuckRequests(): Promise<{ resumed: number }> {
    if (this.resuming) {
      return { resumed: 0 };
    }
    this.resuming = true;
    let resumed = 0;
    try {
      // Oldest first, and one failing row never stops the others (nor starves the later passes).
      const guarded = async (requestId: string, work: () => Promise<void>) => {
        try {
          await work();
        } catch (error) {
          this.logger.error(
            `[RESULT] resume FAILED requestId=${requestId} detail=${error instanceof Error ? error.name : 'unknown'}`,
          );
        }
        resumed++;
      };

      const unpaid = await this.requestsRepository.find({
        where: { status: AdminCertificateRequestStatus.AWAITING_PAYMENT, payment: { status: PaymentStatus.PAID } },
        relations: { payment: { lightningInvoice: true } },
        order: { updatedAt: 'ASC' },
        take: RESUME_BATCH_LIMIT,
      });
      for (const request of unpaid) {
        const payment = request.payment;
        if (payment?.lightningInvoice) {
          await guarded(request.id, () => this.confirmPaidAndIssue(request, payment, payment.lightningInvoice!));
        }
      }

      // `paid` rows get the SAME verification as the callback before any generation (they may have been promoted
      // by an older code path, or released after a failure).
      const paid = await this.requestsRepository.find({
        where: { status: AdminCertificateRequestStatus.PAID },
        relations: { payment: { lightningInvoice: true } },
        order: { updatedAt: 'ASC' },
        take: RESUME_BATCH_LIMIT,
      });
      for (const request of paid) {
        const payment = request.payment;
        if (!payment?.lightningInvoice) {
          this.logger.error(`[RESULT] PAID_UNLINKED request is paid but has no invoice requestId=${request.id} — not generated`);
          resumed++;
          continue;
        }
        await guarded(request.id, () => this.confirmPaidAndIssue(request, payment, payment.lightningInvoice!));
      }

      const staleBefore = new Date(Date.now() - ISSUING_STALE_MS);
      const stale = await this.requestsRepository.find({
        where: { status: AdminCertificateRequestStatus.ISSUING, updatedAt: LessThan(staleBefore) },
        order: { updatedAt: 'ASC' },
        take: RESUME_BATCH_LIMIT,
      });
      for (const request of stale) {
        await guarded(request.id, async () => {
          // The new token also fences off the slow worker: its final write and its rollback no longer match.
          const token = crypto.randomUUID();
          const reclaimed = await this.requestsRepository.update(
            { id: request.id, status: AdminCertificateRequestStatus.ISSUING, updatedAt: LessThan(staleBefore) },
            { status: AdminCertificateRequestStatus.ISSUING, issuingToken: token },
          );
          if (!reclaimed.affected) {
            resumed--;
            return;
          }
          this.logger.warn(`[STATE] resuming abandoned issuance requestId=${request.id}`);
          // Re-read: the row may have changed since the listing (e.g. `paymentSimulated`).
          const fresh = await this.requestsRepository.findOne({ where: { id: request.id } });
          const free = getCertificateTypeDefinition(request.certificateType)?.priceSats === 0;
          const back = free ? AdminCertificateRequestStatus.ACCEPTED : AdminCertificateRequestStatus.PAID;
          try {
            await this.performIssuance(fresh ?? request, token);
          } catch (error) {
            this.logger.error(
              `[RESULT] resume issuance FAILED requestId=${request.id} detail=${error instanceof Error ? error.name : 'unknown'}`,
            );
            await this.releaseIssuanceClaim(request.id, back, token);
          }
        });
      }

      const freeTypeIds = ADMIN_CERTIFICATE_TYPES.filter((t) => t.priceSats === 0).map((t) => t.id);
      if (freeTypeIds.length > 0) {
        const free = await this.requestsRepository.find({
          where: { status: AdminCertificateRequestStatus.ACCEPTED, certificateType: In(freeTypeIds) },
          order: { updatedAt: 'ASC' },
          take: RESUME_BATCH_LIMIT,
        });
        for (const request of free) {
          await guarded(request.id, () => this.startIssuance(request.id, AdminCertificateRequestStatus.ACCEPTED));
        }
      }
      if (resumed > 0) {
        this.logger.log(`[RESULT] resumeStuckRequests resumed=${resumed}`);
      }
    } catch (error) {
      this.logger.error(
        `[RESULT] resumeStuckRequests FAILED detail=${error instanceof Error ? error.name : 'unknown'}`,
      );
    } finally {
      this.resuming = false;
    }
    return { resumed };
  }

  /**
   * Dev-only (`PAYMENT_SIMULATION`): marks the request's REAL invoice paid through `markPaid`, the single place where
   * an invoice becomes paid, so the automatic generation that follows is exactly the production path. Answers 404
   * when the flag is off. Holder-only: staff never pay on a citizen's behalf.
   */
  async simulatePayment(requestId: string, actor: RequestActor): Promise<CheckRequestPaymentStatusResult> {
    if (!this.isPaymentSimulationEnabled()) {
      throw new NotFoundException('Not found');
    }
    this.logger.warn(`[START] SIMULATED payment requestId=${requestId} actorUserId=${actor.userId}`);

    // Holder only: staff never pays on a citizen's behalf, simulated or not.
    const request = await this.loadAccessibleRequestOrThrow(requestId, actor, 'holderOnly');
    if (request.status !== AdminCertificateRequestStatus.AWAITING_PAYMENT || !request.paymentId) {
      throw new BadRequestException(`Request has no open invoice to pay (current status: "${request.status}")`);
    }
    const payment = await this.paymentsRepository.findOne({
      where: { id: request.paymentId },
      relations: ['lightningInvoice'],
    });
    const invoice = payment?.lightningInvoice ?? null;
    if (!invoice) {
      throw new NotFoundException('Linked Lightning invoice not found for this request payment');
    }
    // `markPaid` flips anything not yet paid, expired and failed invoices included: only an open one may be "paid".
    if (
      payment?.status !== PaymentStatus.PENDING ||
      invoice.status !== LightningInvoiceStatus.PENDING ||
      invoice.provider !== LightningProvider.BITNOB
    ) {
      this.logger.warn(`[RESULT] SIMULATED payment refused: invoice not open requestId=${request.id} invoiceStatus=${invoice.status}`);
      throw new BadRequestException('The invoice of this request is not open');
    }

    // Marked BEFORE the payment is applied, so the generation that follows always sees it.
    const marked = await this.requestsRepository.update(
      { id: request.id, status: AdminCertificateRequestStatus.AWAITING_PAYMENT },
      { paymentSimulated: true },
    );
    if (!marked.affected) {
      throw new ConflictException('The request changed state, nothing was simulated');
    }
    try {
      await this.lightningInvoicesService.markPaid(invoice);
    } catch (error) {
      // Not paid after all: do not leave the request flagged (it would block its payout and mislabel it).
      await this.requestsRepository.update(
        { id: request.id, status: AdminCertificateRequestStatus.AWAITING_PAYMENT },
        { paymentSimulated: false },
      );
      throw error;
    }
    this.logger.warn(`[STATE] SIMULATED payment applied requestId=${request.id} invoiceId=${invoice.id} actorUserId=${actor.userId}`);
    const current = await this.requestsRepository.findOne({ where: { id: request.id } });
    return {
      requestId: request.id,
      status: current?.status ?? request.status,
      invoiceStatus: invoice.status,
      provider: invoice.provider,
    };
  }

  /**
   * Generates the certificate (DID, anchor, credential, PDF, reference) for a request already claimed as
   * `issuing`, and ends it `issued`. Callers own the claim and release it on failure.
   */
  private async performIssuance(request: AdminCertificateRequest, token: string): Promise<IssueForRequestResult> {
    const requestId = request.id;
    const typeDefinition = getCertificateTypeDefinition(request.certificateType);
    if (!typeDefinition) {
      throw new BadRequestException(`Unknown certificate type "${request.certificateType}" recorded on this request`);
    }

    const organization = await this.organizationsRepository.findOne({ where: { id: request.organizationId } });
    if (!organization) {
      throw new NotFoundException('Issuing organization not found');
    }

    // Subject DID: should already exist from the holder's Google login
    // (AuthService.completeAppwriteLogin creates one at first login) — but
    // handle the not-yet-existing case defensively rather than assuming.
    let subjectDid = await this.didService.findByController(request.holderUserId);
    if (!subjectDid) {
      subjectDid = await this.didService.createDid(request.holderUserId);
      this.logger.log(`[RESULT] created missing subject DID holderUserId=${request.holderUserId} did=${subjectDid.did}`);
    }

    // Issuer DID: one-time bootstrap per organization.
    let issuerDid = await this.didService.findByController(undefined, organization.id);
    if (!issuerDid) {
      issuerDid = await this.didService.createDid(undefined, organization.id);
      this.logger.log(`[RESULT] created missing issuer DID organizationId=${organization.id} did=${issuerDid.did}`);
    }

    const declaredNotVerified = !request.reviewedByUserId;
    const externalReference = crypto.randomUUID();
    const issuedAt = new Date();
    const validityDays = this.configService.get<number>('vc.validityDays', 365);
    const validUntil = new Date(issuedAt.getTime() + validityDays * 24 * 60 * 60 * 1000);

    // Ported flow order from certificateService.generateCertificate: hash +
    // (simulated) anchor the raw submitted data BEFORE the VC exists. This
    // fingerprint feeds the SIMULATED anchor call only — see the class doc
    // comment for why it is NOT the `documentHash` returned below.
    const anchorFingerprint = this.certificateAnchorService.createDocumentHash({
      ...request.submittedData,
      certificateId: externalReference,
      certificateType: request.certificateType,
      issuedAt: issuedAt.toISOString(),
      validUntil: validUntil.toISOString(),
    });

    this.logger.log(`[CALL] CertificateAnchorService.anchorDocumentHash requestId=${requestId}`);
    const anchorResult = await this.certificateAnchorService.anchorDocumentHash(anchorFingerprint, {
      certificateId: externalReference,
      certificateType: request.certificateType,
    });

    // A previous attempt for THIS request that never reached `issued` (crash, failed PDF, lost claim) may have left
    // an active credential behind: the request is only ever finished once, so any active credential tagged with
    // this requestId is an orphan. Retire it before signing a new one, so one request never owns two valid VCs.
    const retired = await this.revocationService.revokeActiveByMetadata('requestId', requestId);
    if (retired > 0) {
      this.logger.warn(`[STATE] performIssuance retired orphan credentials requestId=${requestId} count=${retired}`);
    }

    this.logger.log(`[CALL] CredentialIssuanceService.issue requestId=${requestId} type=${ADMIN_CERTIFICATE_VC_TYPE}`);
    const credential = await this.credentialIssuanceService.issue({
      metadata: { requestId },
      type: ADMIN_CERTIFICATE_VC_TYPE,
      organization,
      issuerDidId: issuerDid.id,
      subjectDidId: subjectDid.id,
      // A certificate obtained through the dev-only payment simulation says so, inside the signed credential.
      // No agent reviewed it (automatic issuance): the data is the holder's declaration, and the credential says so.
      credentialSubject: {
        ...request.submittedData,
        ...(request.paymentSimulated ? { simulatedPayment: true } : {}),
        ...(declaredNotVerified ? { declaredNotVerified: true } : {}),
      },
      validityDays,
    });

    // The value handed back to the client / embedded in the PDF / expected
    // back on verify — see class doc comment.
    const documentHash = credential.hash;
    const qrPayload = `dioteko://verify?certificateId=${externalReference}`;

    // Everything this attempt created is discarded together if the request cannot be finished: a leftover VC
    // would stay verifiable, i.e. a second valid certificate for one request. The credential already exists here,
    // so the PDF rendering below is inside the same protection as the final writes.
    let refId: string | null = null;
    const discardAttempt = async (): Promise<void> => {
      await fs.promises.rm(this.pdfFilePath(externalReference), { force: true });
      if (refId) {
        await this.refsRepository.delete({ id: refId });
      }
      try {
        await this.revocationService.revoke(credential.id);
      } catch {
        this.logger.error(`[RESULT] performIssuance could not revoke the discarded credential vcId=${credential.id} requestId=${request.id} ORPHAN`);
      }
    };

    let pdfBuffer: Buffer;
    try {
      ({ pdfBuffer } = await this.certificatePdfService.generatePdf({
        certificateType: request.certificateType,
        holderData: request.submittedData,
        externalReference,
        qrPayload,
        issuedAt,
        validUntil,
        documentHash,
        declaredNotVerified,
        blockchainAnchor: { txId: anchorResult.txId, network: anchorResult.network, timestamp: anchorResult.timestamp },
      }));
      if (!pdfBuffer?.length) {
        throw new Error('Certificate PDF generation returned an empty buffer');
      }
    } catch (error) {
      await discardAttempt();
      throw error;
    }

    let finished;
    try {
      await fs.promises.writeFile(this.pdfFilePath(externalReference), pdfBuffer);
      const ref = await this.refsRepository.save(
        this.refsRepository.create({
          subjectDidId: subjectDid.id,
          organizationId: organization.id,
          certificateType: request.certificateType,
          externalReference,
          vcId: credential.id,
        }),
      );
      refId = ref.id;
      finished = await this.requestsRepository.update(
        { id: request.id, status: AdminCertificateRequestStatus.ISSUING, issuingToken: token },
        { status: AdminCertificateRequestStatus.ISSUED, adminCertificateRefId: ref.id, issuingToken: null },
      );
    } catch (error) {
      await discardAttempt();
      throw error;
    }

    if (!finished.affected) {
      // Another worker took the request over (stale takeover): its certificate wins, this attempt is discarded.
      await discardAttempt();
      this.logger.error(
        `[RESULT] performIssuance lost the claim requestId=${request.id} certificateId=${externalReference} vcId=${credential.id} — attempt discarded (PDF removed, reference deleted, credential revoked)`,
      );
      throw new ConflictException('Certificate generation was taken over by another worker');
    }
    request.status = AdminCertificateRequestStatus.ISSUED;
    request.adminCertificateRefId = refId;
    // TODO(lot 4): notify the holder here ("your certificate is ready").

    this.logger.log(
      `[RESULT] issueForRequest success requestId=${request.id} certificateId=${externalReference} vcId=${credential.id}`,
    );

    return {
      certificateId: externalReference,
      documentHash,
      blockchainAnchor: {
        txId: anchorResult.txId,
        network: anchorResult.network,
        timestamp: anchorResult.timestamp,
        blockHeight: anchorResult.blockHeight,
      },
      validUntil: validUntil.toISOString(),
      qrCodeData: qrPayload,
    };
  }

  /**
   * Serves the PDF rendered and persisted at issuance time (see
   * `issueForRequest`). Not regenerated on demand — the stored bytes are the
   * source of truth so a downloaded certificate is always byte-identical to
   * what was issued, regardless of how many times it's downloaded.
   */
  async getCertificateFile(certificateId: string): Promise<{ pdfBuffer: Buffer; filename: string }> {
    this.logger.log(`[START] getCertificateFile certificateId=${certificateId}`);

    const ref = await this.refsRepository.findOne({ where: { externalReference: certificateId } });
    if (!ref) {
      throw new NotFoundException('Certificate not found');
    }

    const filepath = this.pdfFilePath(ref.externalReference);
    if (!fs.existsSync(filepath)) {
      this.logger.warn(`[RESULT] getCertificateFile missing file certificateId=${certificateId} filepath=${filepath}`);
      throw new NotFoundException('Certificate file not found');
    }

    const pdfBuffer = await fs.promises.readFile(filepath);
    this.logger.log(`[RESULT] getCertificateFile success certificateId=${certificateId} bytes=${pdfBuffer.length}`);

    return { pdfBuffer, filename: `certificate_${ref.externalReference}.pdf` };
  }

  async verifyCertificate(certificateId: string, dto: { documentHash?: string }): Promise<VerifyCertificateResult> {
    this.logger.log(`[START] verifyCertificate certificateId=${certificateId}`);

    const ref = await this.refsRepository.findOne({ where: { externalReference: certificateId } });
    if (!ref) {
      throw new NotFoundException('Certificate not found');
    }

    const result = await this.credentialVerificationService.verify(ref.vcId, {
      comparisonHash: dto.documentHash,
    });

    // `verifyCertificate` is reachable from an unauthenticated route
    // (AdminCertificatesController.verify has no guard by design — anyone
    // with a certificateId can verify it), so the caller's identity is
    // genuinely unknown: `actorType: 'anonymous'` is the honest value here,
    // not a stand-in for an identity we chose not to capture. `result` is
    // narrowed to the access_logs enum (valid|invalid|expired|error) from
    // CredentialVerificationService's finer-grained reason
    // (revoked|expired|signature_invalid|hash_mismatch) — everything that
    // isn't a clean pass or an expiry collapses to 'invalid', since the
    // audit trail only needs to answer "did this verification succeed and
    // if not, in broad terms why", not replicate the verification service's
    // own detailed reason.
    await this.accessLogService.record({
      actorType: AccessLogActorType.ANONYMOUS,
      resourceType: 'verifiable_credential',
      resourceId: result.credential.id,
      action: AccessLogAction.VERIFY,
      result: result.valid
        ? AccessLogResult.VALID
        : result.reason === 'expired'
          ? AccessLogResult.EXPIRED
          : AccessLogResult.INVALID,
    });

    this.logger.log(
      `[RESULT] verifyCertificate certificateId=${certificateId} valid=${result.valid} reason=${result.reason ?? 'n/a'}`,
    );

    return {
      certificateId,
      valid: result.valid,
      reason: result.reason,
      certificateType: ref.certificateType,
      issuedAt: result.credential.issuedAt,
      expiresAt: result.credential.expiresAt,
    };
  }

  /**
   * Certificate-scoped Bitnob payout — quote + initialize ONLY. Money does
   * NOT move here: `finalizeBitnobPayoutForCertificate` is a separate,
   * admin-only step, and is disabled outright in production this increment.
   *
   * Security shape (see the Increment 3 security review):
   *  - the DTO carries NO beneficiary / customerId / organizationId; the
   *    beneficiary is resolved from `BITNOB_PAYOUT_BENEFICIARY_*` config and
   *    the org / subject DID from the certificate's own ref row;
   *  - a `bitnob_payouts` row is inserted FIRST (status `quote`), inside a
   *    transaction with the `payments` ledger row, so the idempotency key
   *    `reference = dkpayout_<row id>` is deterministic and the local ledger
   *    never lags the remote call;
   *  - a 409 pre-check + a partial unique index both forbid a second
   *    still-recoverable payout for the same certificate (`failed` and
   *    `expired` rows do not block a re-quote); the concurrent-race loser's
   *    23505 is caught and surfaced as a 409, not a 500;
   *  - on failure the row is kept (never deleted) with a PII-free error
   *    summary in `raw_result`; if the quote step never succeeded (no
   *    `bitnobPayoutId`) the row is set to `failed` so the certificate is not
   *    permanently bricked (B2), otherwise it keeps its last-good status.
   */
  async createBitnobPayoutForCertificate(
    certificateId: string,
    dto: CreateBitnobPayoutForCertificateDto,
    actorUserId: string,
  ): Promise<{ payout: CertificatePayoutView }> {
    const environment = this.configService.get<string>('bitnob.environment', 'sandbox');
    this.logger.log(
      `[START] createBitnobPayoutForCertificate certificateId=${certificateId} actorUserId=${actorUserId} toCurrency=${dto.toCurrency} ` +
        `country=${dto.country} settlementAmount=${dto.settlementAmount} bitnob.environment=${environment}`,
    );

    // A3 runtime guard — backstop the DTO regex against odd-but-matching input.
    const numericAmount = Number(dto.settlementAmount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new BadRequestException('settlementAmount must be a positive number');
    }

    // Scope before anything else (incl. the 409 below, which would otherwise confirm that a certificate exists).
    const ref = await this.findOrganizationCertificateRefOrThrow(certificateId, actorUserId);

    // A certificate obtained through the dev-only payment simulation never produced any money to pay out.
    if (await this.requestsRepository.count({ where: { adminCertificateRefId: ref.id, paymentSimulated: true } })) {
      this.logger.warn(`[RESULT] createBitnobPayoutForCertificate refused: simulated payment certificateId=${certificateId}`);
      throw new ConflictException('This certificate was obtained with a simulated payment');
    }

    // M3 — 409 pre-check (the DB partial unique index is the hard backstop).
    // `failed` and `expired` are both recoverable (re-quote), so neither
    // blocks a new payout — everything else does.
    const activePayout = await this.bitnobPayoutsRepository.findOne({
      where: { adminCertificateRefId: ref.id, status: Not(In(['failed', 'expired'])) },
    });
    if (activePayout) {
      this.logger.warn(
        `[RESULT] createBitnobPayoutForCertificate rejected certificateId=${certificateId} ` +
          `reason=payout_exists payoutId=${activePayout.id} status=${activePayout.status}`,
      );
      throw new ConflictException('A payout already exists for this certificate');
    }

    // M1 b-lite — beneficiary is server-side only.
    const beneficiary = this.resolvePayoutBeneficiary();
    const fromAsset = dto.fromAsset ?? PAYOUT_DEFAULT_FROM_ASSET;

    // M4 — local writes are transactional; no Bitnob call inside the tx.
    // C3 — the losing side of a concurrent race hits the partial unique
    // index (23505) inside the transaction; surface that as a 409, not a 500.
    let payoutRow: BitnobPayout;
    try {
      payoutRow = await this.dataSource.transaction(async (manager) => {
        const row = await manager.save(
          manager.create(BitnobPayout, {
            status: 'quote',
            adminCertificateRefId: ref.id,
            organizationId: ref.organizationId,
            subjectDidId: ref.subjectDidId,
            fromAsset,
            toCurrency: dto.toCurrency,
            country: dto.country,
            source: 'offchain',
            settlementAmount: dto.settlementAmount,
          }),
        );
        await manager.save(
          manager.create(Payment, {
            provider: LightningProvider.BITNOB,
            purposeType: ADMIN_CERTIFICATE_BITNOB_PAYOUT_PURPOSE_TYPE,
            purposeId: row.id,
            bitnobPayoutId: row.id,
            status: PaymentStatus.PENDING,
            organizationId: ref.organizationId,
            currency: dto.toCurrency,
          }),
        );
        return row;
      });
    } catch (err) {
      if (this.isPayoutUniqueViolation(err)) {
        this.logger.warn(
          `[RESULT] createBitnobPayoutForCertificate rejected certificateId=${certificateId} reason=unique_violation_race`,
        );
        throw new ConflictException('A payout already exists for this certificate');
      }
      throw err;
    }

    const reference = `dkpayout_${payoutRow.id}`;
    this.logger.log(
      `[ENTITY] bitnob_payouts id=${payoutRow.id} reference=${reference} certificateId=${certificateId} ` +
        `organizationId=${payoutRow.organizationId ?? 'n/a'}`,
    );

    try {
      const quote = await this.bitnobPayoutsService.createQuote({
        fromAsset,
        toCurrency: dto.toCurrency,
        country: dto.country,
        settlementAmount: dto.settlementAmount,
        reference,
        source: 'offchain',
      });
      payoutRow.reference = reference;
      payoutRow.quoteId = quote.quote_id ?? null;
      payoutRow.amount = quote.amount != null ? String(quote.amount) : null;
      payoutRow.bitnobPayoutId = quote.id ?? null;
      // N13 — the Bitnob quote response is PII-free BY CONTRACT (verified live
      // 2026-08-30: `data.payout` has no `beneficiary` before initialize), so
      // `raw_quote` is stored verbatim. Only `raw_result` (post-initialize)
      // needs `stripPayoutPii`.
      payoutRow.rawQuote = quote as unknown as Record<string, unknown>;
      await this.bitnobPayoutsRepository.save(payoutRow);

      if (!payoutRow.quoteId) {
        throw new InternalServerErrorException('Bitnob quote did not return a quote_id');
      }

      const initialized = await this.bitnobPayoutsService.initializePayout(payoutRow.quoteId, {
        reference,
        paymentReason: dto.paymentReason ?? 'certificate_service_fee',
        beneficiary,
      });
      payoutRow.status = 'initiated';
      payoutRow.bitnobPayoutId = initialized.id ?? payoutRow.bitnobPayoutId;
      payoutRow.rawResult = stripPayoutPii(initialized as unknown as Record<string, unknown>);
      await this.bitnobPayoutsRepository.save(payoutRow);

      // N9 — an audit-log hiccup must never corrupt a real payout result.
      await this.recordPayoutAudit(payoutRow, ref.subjectDidId, certificateId, reference, AccessLogResult.VALID, actorUserId);

      this.logger.log(
        `[RESULT] createBitnobPayoutForCertificate success certificateId=${certificateId} payoutId=${payoutRow.id} ` +
          `reference=${reference} quoteId=${payoutRow.quoteId} bitnobPayoutId=${payoutRow.bitnobPayoutId ?? 'n/a'} ` +
          `status=${payoutRow.status} settlementAmount=${payoutRow.settlementAmount} toCurrency=${payoutRow.toCurrency}`,
      );
      return { payout: this.projectCertificatePayout(payoutRow) };
    } catch (err) {
      const summary = summarizePayoutError(err);
      // B2 — if the row never reached `initiated` (quote step failed), mark it
      // `failed` so it does NOT permanently brick the certificate: `failed`
      // rows don't block a re-quote, and neither `reconcile` (needs
      // `bitnobPayoutId`) nor `finalize` (needs `initiated`) could recover it.
      if (!payoutRow.bitnobPayoutId && payoutRow.status !== 'initiated') {
        payoutRow.status = 'failed';
      }
      payoutRow.rawResult = { error: summary };
      await this.bitnobPayoutsRepository.save(payoutRow).catch(() => undefined);
      await this.syncLinkedPayment(payoutRow).catch(() => undefined);
      this.logger.error(
        `[RESULT] createBitnobPayoutForCertificate failed certificateId=${certificateId} payoutId=${payoutRow.id} ` +
          `reference=${reference} status=${payoutRow.status} detail=${summary}`,
      );
      throw err;
    }
  }

  /**
   * Admin-only. The ONLY step that can move money.
   *
   * N1 — the `initiated -> finalizing` transition is an ATOMIC compare-and-
   * swap (`repo.update` with both id and status in the WHERE), so two
   * concurrent finalize requests can never both proceed to the Bitnob call.
   * `finalizing` is a local-only transient status. On success the row moves
   * to `processing` (or the reconciled remote status); on any failure before
   * the disbursement it is put back to `initiated` so it stays recoverable.
   * `BitnobPayoutsService.finalizePayout` itself throws in production.
   */
  async finalizeBitnobPayoutForCertificate(
    certificateId: string,
    actorUserId: string,
  ): Promise<{ payout: CertificatePayoutView }> {
    this.logger.log(`[START] finalizeBitnobPayoutForCertificate certificateId=${certificateId} actorUserId=${actorUserId}`);

    const { ref, row } = await this.loadCertificatePayout(certificateId, actorUserId);
    if (!row.bitnobPayoutId || !row.quoteId) {
      throw new ConflictException('Payout row is missing Bitnob identifiers — cannot finalize');
    }

    // N1 — atomic guard. Only the request that flips `initiated -> finalizing`
    // proceeds; everyone else (including a re-submit, or a row already past
    // `initiated`) gets a 409.
    const claimed = await this.bitnobPayoutsRepository.update(
      { id: row.id, status: 'initiated' },
      { status: 'finalizing' },
    );
    if (claimed.affected !== 1) {
      throw new ConflictException(`Payout is not in a finalizable state (current: "${row.status}")`);
    }
    row.status = 'finalizing';

    // The try/catch wraps ONLY the money-critical span (remote read +
    // disburse + the status save). A failure there means nothing durable
    // moved, so the row is reverted to `initiated`. Everything after the save
    // is secondary bookkeeping and must NOT be able to trigger that revert.
    try {
      const remote = await this.getPayoutOrThrow(row);
      const remoteStatus = String(remote?.status ?? '').toUpperCase();

      if (remoteStatus === 'INITIATED') {
        const finalized = await this.bitnobPayoutsService.finalizePayout(row.quoteId);
        row.status = 'processing';
        row.rawResult = stripPayoutPii(finalized as unknown as Record<string, unknown>);
      } else {
        // Remote already moved on (or the quote lapsed) — just sync, no disburse.
        row.status = reconcilePayoutStatus(remote, this.logger);
        row.rawResult = stripPayoutPii(remote as unknown as Record<string, unknown>);
      }
      await this.bitnobPayoutsRepository.save(row);
    } catch (err) {
      row.status = 'initiated';
      row.rawResult = { error: summarizePayoutError(err) };
      await this.bitnobPayoutsRepository.save(row).catch(() => undefined);
      this.logger.error(
        `[RESULT] finalizeBitnobPayoutForCertificate failed certificateId=${certificateId} payoutId=${row.id} ` +
          `status=initiated detail=${summarizePayoutError(err)}`,
      );
      // Keep a deliberate HTTP status (403 prod gate, 503 read failure); map a
      // raw Bitnob rejection to 502 rather than leaking a bare 500.
      if (err instanceof HttpException) {
        throw err;
      }
      if (err instanceof BitnobApiError) {
        throw new BadGatewayException('Bitnob rejected the payout finalize — the payout was left initiated');
      }
      throw err;
    }

    await this.syncLinkedPayment(row).catch((err) =>
      this.logger.warn(`[RESULT] syncLinkedPayment failed payoutId=${row.id} detail=${summarizePayoutError(err)}`),
    );
    if (isTerminalPayoutStatus(row.status)) {
      await this.recordPayoutAudit(
        row,
        ref.subjectDidId,
        certificateId,
        row.reference ?? `dkpayout_${row.id}`,
        row.status === 'completed' ? AccessLogResult.VALID : AccessLogResult.ERROR,
        actorUserId,
      );
    }

    this.logger.log(
      `[RESULT] finalizeBitnobPayoutForCertificate certificateId=${certificateId} payoutId=${row.id} ` +
        `status=${row.status} bitnobPayoutId=${row.bitnobPayoutId}`,
    );
    return { payout: this.projectCertificatePayout(row) };
  }

  /**
   * Admin-only. Re-reads the remote payout and syncs `bitnob_payouts.status`
   * (+ the linked `payments.status`). The only way `FAILED` ever lands
   * locally — Bitnob emits no failure webhook. A remote payout still at
   * `QUOTE` past its `expires_at` is mapped to local `expired` so the dead
   * row stops blocking a fresh payout for this certificate.
   */
  async reconcileBitnobPayoutForCertificate(
    certificateId: string,
    actorUserId: string,
  ): Promise<{ payout: CertificatePayoutView }> {
    this.logger.log(`[START] reconcileBitnobPayoutForCertificate certificateId=${certificateId} actorUserId=${actorUserId}`);

    const { ref, row } = await this.loadCertificatePayout(certificateId, actorUserId);
    if (!row.bitnobPayoutId) {
      throw new ConflictException('Payout has not been initialized with Bitnob yet — nothing to reconcile');
    }

    const remote = await this.getPayoutOrThrow(row);
    const previousStatus = row.status;
    row.status = reconcilePayoutStatus(remote, this.logger);
    row.rawResult = stripPayoutPii(remote as unknown as Record<string, unknown>);
    await this.bitnobPayoutsRepository.save(row);
    await this.syncLinkedPayment(row);

    if (row.status !== previousStatus && isTerminalPayoutStatus(row.status)) {
      await this.recordPayoutAudit(
        row,
        ref.subjectDidId,
        certificateId,
        row.reference ?? `dkpayout_${row.id}`,
        row.status === 'completed' ? AccessLogResult.VALID : AccessLogResult.ERROR,
        actorUserId,
      );
    }

    this.logger.log(
      `[RESULT] reconcileBitnobPayoutForCertificate certificateId=${certificateId} payoutId=${row.id} ` +
        `previousStatus=${previousStatus} status=${row.status}`,
    );
    return { payout: this.projectCertificatePayout(row) };
  }

  /**
   * The certificate, only if it belongs to the actor's organization (read from the DB, never from the token or
   * the body). Unknown and foreign certificates answer the same 404. A staff account that is inactive or not
   * attached to an organization gets a 403 from `resolveActorOrganizationId`, which says nothing about the certificate.
   */
  private async findOrganizationCertificateRefOrThrow(
    certificateId: string,
    actorUserId: string,
  ): Promise<AdminCertificateRef> {
    const organizationId = await this.resolveActorOrganizationId(actorUserId);
    const ref = await this.refsRepository.findOne({ where: { externalReference: certificateId, organizationId } });
    if (!ref) {
      this.logger.warn(
        `[RESULT] certificate not accessible certificateId=${certificateId} actorUserId=${actorUserId} organizationId=${organizationId}`,
      );
      throw new NotFoundException('Certificate not found');
    }
    return ref;
  }

  private async loadCertificatePayout(
    certificateId: string,
    actorUserId: string,
  ): Promise<{ ref: AdminCertificateRef; row: BitnobPayout }> {
    const ref = await this.findOrganizationCertificateRefOrThrow(certificateId, actorUserId);
    const row = await this.bitnobPayoutsRepository.findOne({
      where: { adminCertificateRefId: ref.id },
      order: { createdAt: 'DESC' },
    });
    if (!row) {
      throw new NotFoundException('No Bitnob payout exists for this certificate');
    }
    return { ref, row };
  }

  /**
   * N11 — a transient Bitnob read failure must not 500 the request. Persist a
   * PII-free summary to `raw_result` and surface a retryable 503.
   */
  private async getPayoutOrThrow(row: BitnobPayout): Promise<BitnobPayoutRecord> {
    try {
      return await this.bitnobPayoutsService.getPayout(row.bitnobPayoutId as string);
    } catch (err) {
      row.rawResult = { error: summarizePayoutError(err) };
      await this.bitnobPayoutsRepository.save(row).catch(() => undefined);
      this.logger.error(
        `[RESULT] getPayout failed payoutId=${row.id} bitnobPayoutId=${row.bitnobPayoutId} ` +
          `detail=${summarizePayoutError(err)}`,
      );
      throw new ServiceUnavailableException('Could not read the payout status from Bitnob — retry shortly');
    }
  }

  /** True for a Postgres 23505 raised by either `bitnob_payouts` unique index. */
  private isPayoutUniqueViolation(err: unknown): boolean {
    if (!(err instanceof QueryFailedError)) {
      return false;
    }
    const driverError = err as unknown as { code?: string; constraint?: string };
    if (driverError.code !== '23505') {
      return false;
    }
    return (
      driverError.constraint === 'UQ_bitnob_payouts_active_cert' ||
      driverError.constraint === 'UQ_bitnob_payouts_reference' ||
      driverError.constraint === undefined
    );
  }

  /**
   * Resolves the certificate-payout bank beneficiary from config. All four
   * fields are required; a partial config is a 500 (server misconfiguration).
   */
  private resolvePayoutBeneficiary(): BankBeneficiaryInput {
    const accountNumber = this.configService.get<string>('bitnob.payoutBeneficiary.accountNumber', '');
    const accountName = this.configService.get<string>('bitnob.payoutBeneficiary.accountName', '');
    const bankCode = this.configService.get<string>('bitnob.payoutBeneficiary.bankCode', '');
    const country = this.configService.get<string>('bitnob.payoutBeneficiary.country', '');
    if (!accountNumber || !accountName || !bankCode || !country) {
      throw new InternalServerErrorException('Bitnob payout beneficiary not configured');
    }
    return { destinationType: 'bank', country, accountName, accountNumber, bankCode };
  }

  private async syncLinkedPayment(row: BitnobPayout): Promise<void> {
    const payment = await this.paymentsRepository.findOne({
      where: { purposeType: ADMIN_CERTIFICATE_BITNOB_PAYOUT_PURPOSE_TYPE, purposeId: row.id },
    });
    if (!payment) {
      return;
    }
    const mapped = PAYOUT_STATUS_TO_PAYMENT_STATUS[row.status] ?? PaymentStatus.PENDING;
    if (payment.status !== mapped) {
      payment.status = mapped;
      await this.paymentsRepository.save(payment);
      this.logger.log(`[STATE] payment status synced paymentId=${payment.id} status=${mapped} payoutId=${row.id}`);
    }
  }

  /**
   * N9 — best-effort: an `access_logs` write failure must NEVER turn a
   * successful payout into a caller-visible error. Swallow + warn.
   */
  private async recordPayoutAudit(
    row: BitnobPayout,
    subjectDidId: string | null,
    certificateId: string,
    reference: string,
    result: AccessLogResult,
    actorUserId: string,
  ): Promise<void> {
    try {
      await this.accessLogService.record({
        // The staff member who triggered the step, so "who moved this money" is answerable from the audit log.
        actorType: AccessLogActorType.ISSUER_ORGANIZATION,
        actorUserId,
        actorOrganizationId: row.organizationId ?? undefined,
        subjectDidId: subjectDidId ?? undefined,
        resourceType: 'bitnob_payout',
        resourceId: row.id,
        action: AccessLogAction.PAYOUT,
        result,
        metadata: { certificateId, reference },
      });
    } catch (err) {
      this.logger.warn(
        `[RESULT] payout audit-log write failed payoutId=${row.id} certificateId=${certificateId} ` +
          `detail=${err instanceof Error ? err.name : String(err)}`,
      );
    }
  }

  private projectCertificatePayout(row: BitnobPayout): CertificatePayoutView {
    return {
      id: row.id,
      status: row.status,
      reference: row.reference,
      settlementAmount: row.settlementAmount,
      toCurrency: row.toCurrency,
      country: row.country,
      bitnobPayoutId: row.bitnobPayoutId,
      quoteId: row.quoteId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private pdfFilePath(externalReference: string): string {
    return path.join(this.storageDir, `certificate_${externalReference}.pdf`);
  }
}
