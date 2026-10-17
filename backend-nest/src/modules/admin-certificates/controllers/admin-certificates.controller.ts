import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtPayload } from '../../../common/interfaces/jwt-payload.interface';
import { RoleCode } from '../../../modules/identity/entities/role.entity';
import { CreateBitnobPayoutForCertificateDto } from '../dto/create-bitnob-payout-for-certificate.dto';
import { CreateRequestDto } from '../dto/create-request.dto';
import { ListRequestsQueryDto } from '../dto/list-requests-query.dto';
import { RejectRequestDto, RequestInfoDto, ResubmitRequestDto } from '../dto/review-request.dto';
import { VerifyDto } from '../dto/verify.dto';
import { AdminCertificatesService } from '../services/admin-certificates.service';
import { CertificateFileLinkService } from '../services/certificate-file-link.service';

/**
 * `/api/admin-certificates` — request intake, Lightning payment, VC issuance,
 * PDF download, and verification for admin (municipality/ministry)
 * certificates. Endpoint shapes follow the plan's "Key endpoints" table,
 * with one addition: the plan's table starts at `POST /requests/
 * lightning-invoices` but never lists how a `requestId` comes to exist in
 * the first place, even though `AdminCertificatesService.createRequest` is
 * explicitly specced. `POST /requests` (JWT-guarded, any authenticated
 * holder) is added here to close that gap — without it the rest of the flow
 * has no entry point.
 *
 * One intentional payload-shape change vs. the old Express API (per the
 * plan): `certificateId` moves from the request body to a path param on
 * verify.
 */
@ApiTags('admin-certificates')
@Controller('admin-certificates')
export class AdminCertificatesController {
  constructor(
    private readonly adminCertificatesService: AdminCertificatesService,
    private readonly fileLinkService: CertificateFileLinkService,
  ) {}

  @Public()
  @Get('types')
  getTypes() {
    return { success: true, types: this.adminCertificatesService.getTypes() };
  }

  /** Authenticated only (a public flag would advertise an exploitable instance): whether to offer the dev-only "simulate payment" button. */
  @Get('config')
  @ApiBearerAuth()
  getConfig() {
    return { success: true, paymentSimulation: this.adminCertificatesService.isPaymentSimulationEnabled() };
  }

  @Post('requests')
  @ApiBearerAuth()
  async createRequest(@CurrentUser() currentUser: JwtPayload, @Body() dto: CreateRequestDto) {
    const request = await this.adminCertificatesService.createRequest(currentUser.sub, dto);
    return { success: true, request };
  }

  /** The caller's own requests (never anyone else's, whatever the role). */
  @Get('requests')
  @ApiBearerAuth()
  async listMyRequests(@CurrentUser() currentUser: JwtPayload, @Query() query: ListRequestsQueryDto) {
    const { requests, total } = await this.adminCertificatesService.listMyRequests(currentUser.sub, query);
    return { success: true, requests, total };
  }

  /** Counts of the caller's own requests by status and certificate validity. Declared before `requests/:requestId`. */
  @Get('requests/stats')
  @ApiBearerAuth()
  async getMyRequestStats(@CurrentUser() currentUser: JwtPayload) {
    const stats = await this.adminCertificatesService.getMyRequestStats(currentUser.sub);
    return { success: true, stats };
  }

  /**
   * Staff side: requests addressed to the caller's own organization (read from the DB, not the token), filterable
   * by `status`/`validity`. Minimal projection, no personal data. Declared before the `:certificateId/...` routes.
   */
  @Get('organization/requests')
  @Roles(RoleCode.ISSUER, RoleCode.ADMIN)
  @ApiBearerAuth()
  async listOrganizationRequests(@CurrentUser() currentUser: JwtPayload, @Query() query: ListRequestsQueryDto) {
    const { requests, total } = await this.adminCertificatesService.listOrganizationRequests(currentUser.sub, query);
    return { success: true, requests, total };
  }

  /** Staff side: one request of the caller's organization, with its submitted data. Audited; 404 for another org. */
  @Get('organization/requests/:requestId')
  @Roles(RoleCode.ISSUER, RoleCode.ADMIN)
  @ApiBearerAuth()
  async getOrganizationRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    const request = await this.adminCertificatesService.getOrganizationRequest(requestId, currentUser.sub);
    return { success: true, request };
  }

  /** Staff side: accept a `pending` request of the caller's organization; the holder can then pay. */
  @Post('organization/requests/:requestId/accept')
  @Roles(RoleCode.ISSUER, RoleCode.ADMIN)
  @ApiBearerAuth()
  async acceptRequest(@Param('requestId', ParseUUIDPipe) requestId: string, @CurrentUser() currentUser: JwtPayload) {
    const request = await this.adminCertificatesService.acceptRequest(requestId, currentUser.sub);
    return { success: true, request };
  }

  /** Staff side: reject a `pending` request. The reason (10 to 500 characters) is mandatory and shown to the holder. */
  @Post('organization/requests/:requestId/reject')
  @Roles(RoleCode.ISSUER, RoleCode.ADMIN)
  @ApiBearerAuth()
  async rejectRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: RejectRequestDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    const request = await this.adminCertificatesService.rejectRequest(requestId, currentUser.sub, dto.reason);
    return { success: true, request };
  }

  /** Staff side: ask the holder for a correction or a missing piece; the holder answers with `resubmit`. */
  @Post('organization/requests/:requestId/request-info')
  @Roles(RoleCode.ISSUER, RoleCode.ADMIN)
  @ApiBearerAuth()
  async requestInfo(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: RequestInfoDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    const request = await this.adminCertificatesService.requestInfo(requestId, currentUser.sub, dto.message);
    return { success: true, request };
  }

  /** Holder: answer a `needs_info` request with corrected data; the request goes back to `pending`. */
  @Post('requests/:requestId/resubmit')
  @ApiBearerAuth()
  async resubmitRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: ResubmitRequestDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    const request = await this.adminCertificatesService.resubmitRequest(requestId, currentUser.sub, dto.submittedData);
    return { success: true, request };
  }

  /** One of the caller's own requests, with the data they submitted. Holder-only: 404 otherwise. */
  @Get('requests/:requestId')
  @ApiBearerAuth()
  async getMyRequest(@Param('requestId', ParseUUIDPipe) requestId: string, @CurrentUser() currentUser: JwtPayload) {
    const request = await this.adminCertificatesService.getMyRequest(requestId, currentUser.sub);
    return { success: true, request };
  }

  @Post('requests/:requestId/lightning-invoices')
  @ApiBearerAuth()
  async createInvoice(@Param('requestId', ParseUUIDPipe) requestId: string, @CurrentUser() currentUser: JwtPayload) {
    const invoice = await this.adminCertificatesService.createInvoiceForRequest(requestId, {
      userId: currentUser.sub,
      roles: currentUser.roles,
    });
    return { success: true, invoice };
  }

  /** The holder's still-payable invoice (BOLT11), to reopen the payment screen. 404 when none is open. */
  @Get('requests/:requestId/lightning-invoice')
  @ApiBearerAuth()
  async getOpenInvoice(@Param('requestId', ParseUUIDPipe) requestId: string, @CurrentUser() currentUser: JwtPayload) {
    const invoice = await this.adminCertificatesService.getOpenInvoice(requestId, {
      userId: currentUser.sub,
      roles: currentUser.roles,
    });
    return { success: true, invoice };
  }

  @Get('requests/:requestId/lightning-invoices/status')
  @ApiBearerAuth()
  async getInvoiceStatus(@Param('requestId', ParseUUIDPipe) requestId: string, @CurrentUser() currentUser: JwtPayload) {
    const status = await this.adminCertificatesService.checkRequestPaymentStatus(requestId, {
      userId: currentUser.sub,
      roles: currentUser.roles,
    });
    return { success: true, ...status };
  }

  /**
   * Dev only (`PAYMENT_SIMULATION=true`, 404 otherwise, refused at boot in production): marks the request's invoice
   * paid as if it had been settled; the certificate is then generated by the normal automatic path.
   */
  @Post('dev/requests/:requestId/mark-paid')
  @ApiBearerAuth()
  async simulatePayment(@Param('requestId', ParseUUIDPipe) requestId: string, @CurrentUser() currentUser: JwtPayload) {
    const result = await this.adminCertificatesService.simulatePayment(requestId, {
      userId: currentUser.sub,
      roles: currentUser.roles,
    });
    return { success: true, ...result };
  }

  /** Manual recovery: generate a paid request's certificate when the automatic generation failed. */
  @Post('requests/:requestId/issue')
  @ApiBearerAuth()
  @Roles(RoleCode.ISSUER, RoleCode.ADMIN)
  async issue(@Param('requestId', ParseUUIDPipe) requestId: string, @CurrentUser() currentUser: JwtPayload) {
    const result = await this.adminCertificatesService.issueForRequest(requestId, {
      userId: currentUser.sub,
      roles: currentUser.roles,
    });
    return { success: true, ...result };
  }

  /**
   * A short-lived signed download link for the PDF of one of the caller's own issued requests (holder-only: 404
   * otherwise). `url` is relative to the API base; it is opened by the phone's browser, which has no Bearer token.
   */
  @Get('requests/:requestId/file-link')
  @ApiBearerAuth()
  async getFileLink(@Param('requestId', ParseUUIDPipe) requestId: string, @CurrentUser() currentUser: JwtPayload) {
    const request = await this.adminCertificatesService.getMyRequest(requestId, currentUser.sub);
    if (!request.certificateId) {
      throw new NotFoundException('No certificate has been issued for this request');
    }
    const { exp, sig } = this.fileLinkService.sign(request.certificateId);
    const url = `/admin-certificates/${encodeURIComponent(request.certificateId)}/file?exp=${exp}&sig=${sig}`;
    return { success: true, url, expiresAt: new Date(exp * 1000).toISOString() };
  }

  /** Public route, but only with a valid signed link (see `getFileLink`). */
  @Public()
  @Get(':certificateId/file')
  async getFile(
    @Param('certificateId') certificateId: string,
    @Query('exp') exp?: string,
    @Query('sig') sig?: string,
  ): Promise<StreamableFile> {
    this.fileLinkService.assertValid(certificateId, exp, sig);
    const { pdfBuffer, filename } = await this.adminCertificatesService.getCertificateFile(certificateId);
    return new StreamableFile(pdfBuffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Public()
  @Post(':certificateId/verify')
  async verify(@Param('certificateId') certificateId: string, @Body() dto: VerifyDto) {
    const result = await this.adminCertificatesService.verifyCertificate(certificateId, dto);
    return { success: true, ...result };
  }

  /**
   * Quote + initialize a Bitnob payout for this issued certificate. Money
   * does NOT move here. The DTO carries no beneficiary / org — both are
   * server-resolved. `issuer` + `admin`.
   */
  @Post(':certificateId/bitnob/payouts')
  @ApiBearerAuth()
  @Roles(RoleCode.ISSUER, RoleCode.ADMIN)
  async createBitnobPayout(
    @Param('certificateId', ParseUUIDPipe) certificateId: string,
    @Body() dto: CreateBitnobPayoutForCertificateDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    const result = await this.adminCertificatesService.createBitnobPayoutForCertificate(
      certificateId,
      dto,
      currentUser.sub,
    );
    return { success: true, ...result };
  }

  /**
   * Finalize (disburse) the certificate's initialized payout — the only
   * step that moves money. `admin` only; disabled entirely in production
   * this increment.
   */
  @Post(':certificateId/bitnob/payouts/finalize')
  @ApiBearerAuth()
  @Roles(RoleCode.ADMIN)
  async finalizeBitnobPayout(
    @Param('certificateId', ParseUUIDPipe) certificateId: string,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    const result = await this.adminCertificatesService.finalizeBitnobPayoutForCertificate(
      certificateId,
      currentUser.sub,
    );
    return { success: true, ...result };
  }

  /**
   * Re-read the remote payout and sync the local + ledger status. The only
   * path by which a `FAILED` payout is ever observed (no failure webhook).
   * `admin` only.
   */
  @Post(':certificateId/bitnob/payouts/reconcile')
  @ApiBearerAuth()
  @Roles(RoleCode.ADMIN)
  async reconcileBitnobPayout(
    @Param('certificateId', ParseUUIDPipe) certificateId: string,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    const result = await this.adminCertificatesService.reconcileBitnobPayoutForCertificate(
      certificateId,
      currentUser.sub,
    );
    return { success: true, ...result };
  }
}
