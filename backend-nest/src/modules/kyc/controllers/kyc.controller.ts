import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  HttpException,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../../common/interfaces/jwt-payload.interface';
import { StartSessionDto } from '../dto/start-session.dto';
import { KYC_UPLOAD_MAX_BYTES } from '../kyc.constants';
import { sniffImage } from '../kyc-upload.util';
import { IdswyftUploadStep } from '../services/idswyft-http-client.service';
import { KycService } from '../services/kyc.service';

/**
 * Multer limits are enforced by the framework, not by us: one file, no text fields, kept in memory only (the
 * photo is forwarded to the provider and never written to disk or the database). `fields: 0` means the upload
 * routes accept no multipart text field at all (the global `forbidNonWhitelisted` pipe would refuse one anyway).
 */
const uploadInterceptor = FileInterceptor('file', {
  // Memory storage is multer's default when no `storage` is given.
  limits: { fileSize: KYC_UPLOAD_MAX_BYTES, files: 1, fields: 0, parts: 2 },
});

/**
 * `/api/kyc` — the holder's identity verification (JWT, global guard). Ownership is always `currentUser.sub`:
 * a session of another user answers 404. The Idswyft webhook lives in `KycWebhookController` (public, signed).
 */
@ApiTags('kyc')
@ApiBearerAuth()
@Controller('kyc')
export class KycController {
  /**
   * Users with a photo being forwarded right now: one at a time per process. This bounds the provider calls, not
   * memory: multer buffers (up to 5 MB) before the handler runs.
   */
  private readonly uploading = new Set<string>();

  constructor(private readonly kycService: KycService) {}

  private readonly logger = new Logger(KycController.name);

  /** Opens (or returns the already open) verification session. */
  @Post('sessions')
  @HttpCode(200)
  async startSession(@Body() dto: StartSessionDto, @CurrentUser() currentUser: JwtPayload) {
    const kyc = await this.kycService.startSession(currentUser.sub, dto.documentType, dto.issuingCountry);
    return { success: true, kyc };
  }

  @Post('sessions/:sessionId/front')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(uploadInterceptor)
  front(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.upload(currentUser.sub, sessionId, 'front', file);
  }

  @Post('sessions/:sessionId/back')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(uploadInterceptor)
  back(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.upload(currentUser.sub, sessionId, 'back', file);
  }

  /** The selfie closes the session: the verdict is read back from the provider before answering. */
  @Post('sessions/:sessionId/selfie')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(uploadInterceptor)
  selfie(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.upload(currentUser.sub, sessionId, 'selfie', file);
  }

  /** Closes the caller's own open session (to start over with another document or country). */
  @Post('sessions/:sessionId/cancel')
  @HttpCode(200)
  async cancel(@Param('sessionId', ParseUUIDPipe) sessionId: string, @CurrentUser() currentUser: JwtPayload) {
    const kyc = await this.kycService.cancelSession(currentUser.sub, sessionId);
    return { success: true, kyc };
  }

  /**
   * Checks a (small) photo BEFORE it is uploaded: does it show a document / a face? Answers `ok`, `no_document`,
   * `no_face` or `skipped` (could not check). Does not count as an upload and does not touch the dossier.
   */
  @Post('sessions/:sessionId/precheck/:step')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(uploadInterceptor)
  async precheck(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('step', new ParseEnumPipe({ front: 'front', back: 'back', selfie: 'selfie' })) step: IdswyftUploadStep,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    const { mimetype } = sniffImage(file?.buffer);
    const startedAt = Date.now();
    const result = await this.kycService.precheck(currentUser.sub, sessionId, step, { buffer: (file as Express.Multer.File).buffer, mimetype });
    // Ids, size and outcome only: never the picture, never what was read in it.
    this.logger.log(`[RESULT] POST precheck sessionId=${sessionId} step=${step} bytes=${file?.size ?? 0} result=${result} elapsedMs=${Date.now() - startedAt}`);
    return { success: true, result };
  }

  /** The holder's best dossier; a pending one is refreshed from the provider (covers a lost webhook). */
  @Get('status')
  async status(@CurrentUser() currentUser: JwtPayload) {
    const kyc = await this.kycService.getStatus(currentUser.sub);
    return { success: true, kyc };
  }

  private async upload(userId: string, sessionId: string, step: IdswyftUploadStep, file: Express.Multer.File | undefined) {
    // Sniffed from the bytes: the declared mimetype and original name are never trusted nor forwarded.
    const { mimetype } = sniffImage(file?.buffer);
    if (this.uploading.has(userId)) {
      throw new HttpException('A photo is already being verified. Wait for it to finish.', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.uploading.add(userId);
    const startedAt = Date.now();
    this.logger.log(`[START] POST upload sessionId=${sessionId} step=${step} bytes=${file?.size ?? 0} mimetype=${mimetype}`);
    try {
      const kyc = await this.kycService.uploadStep(userId, sessionId, step, { buffer: (file as Express.Multer.File).buffer, mimetype });
      this.logger.log(`[RESULT] POST upload sessionId=${sessionId} step=${step} status=${kyc.status} elapsedMs=${Date.now() - startedAt}`);
      return { success: true, kyc };
    } finally {
      this.uploading.delete(userId);
    }
  }
}
