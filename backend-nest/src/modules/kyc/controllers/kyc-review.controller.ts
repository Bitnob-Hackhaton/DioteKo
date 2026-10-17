import { Body, Controller, Get, HttpCode, Param, ParseEnumPipe, ParseUUIDPipe, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtPayload } from '../../../common/interfaces/jwt-payload.interface';
import { RoleCode } from '../../identity/entities/role.entity';
import { DecideKycReviewDto, ListKycReviewsQueryDto } from '../dto/kyc-review.dto';
import { KycDocumentKind } from '../kyc.constants';
import { KycReviewService } from '../services/kyc-review.service';

/**
 * `/api/kyc/review` — the agents' queue of identity dossiers waiting for a decision (console, "Vérifications d'identité").
 * Issuer / admin only (global `RolesGuard`). A route of its own, apart from the holder's `/kyc/*`, so a role mistake on one
 * can never expose the other.
 */
@ApiTags('kyc-review')
@ApiBearerAuth()
@Controller('kyc/review')
export class KycReviewController {
  constructor(private readonly reviewService: KycReviewService) {}

  @Get()
  @Roles(RoleCode.ISSUER, RoleCode.ADMIN)
  list(@Query() query: ListKycReviewsQueryDto, @CurrentUser() currentUser: JwtPayload) {
    return this.reviewService.list(currentUser.sub, query);
  }

  @Get(':id')
  @Roles(RoleCode.ISSUER, RoleCode.ADMIN)
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() currentUser: JwtPayload) {
    return this.reviewService.get(currentUser.sub, id);
  }

  /** The photo itself, decrypted for this request only: never cached, never sniffed by the browser. */
  @Get(':id/documents/:kind')
  @Roles(RoleCode.ISSUER, RoleCode.ADMIN)
  async document(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind', new ParseEnumPipe({ front: 'front', back: 'back', selfie: 'selfie' })) kind: KycDocumentKind,
    @CurrentUser() currentUser: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, mimetype } = await this.reviewService.getDocument(currentUser.sub, id, kind);
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
    return new StreamableFile(buffer, { type: mimetype });
  }

  @Post(':id/decision')
  @HttpCode(200)
  @Roles(RoleCode.ISSUER, RoleCode.ADMIN)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideKycReviewDto, @CurrentUser() currentUser: JwtPayload) {
    return this.reviewService.decide(currentUser.sub, id, dto.decision, dto.note);
  }
}
