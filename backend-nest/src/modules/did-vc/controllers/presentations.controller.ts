import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { sha256Hex } from '../../../common/utils/sha256.util';
import { stableStringify } from '../../../common/utils/stable-stringify.util';
import { CreatePresentationDto } from '../dto/create-presentation.dto';
import { VerifiablePresentation } from '../entities/verifiable-presentation.entity';

const DEFAULT_VP_CONTEXT = { '@context': ['https://www.w3.org/2018/credentials/v1'] };

/**
 * Minimal VP creation endpoint (`POST /api/did-vc/presentations`) — no
 * selective-disclosure logic, no signature over the presentation itself
 * (unlike VCs, which are signed JWTs — see `CredentialIssuanceService`).
 * `vpHash` is a content fingerprint of the holder + credential set +
 * context, useful as an integrity/idempotency marker for a future real VP
 * flow. Kept a thin repository-backed controller (no dedicated service) —
 * intentionally minimal per this round's scope.
 */
@ApiTags('did-vc')
@ApiBearerAuth()
@Controller('did-vc/presentations')
export class PresentationsController {
  constructor(
    @InjectRepository(VerifiablePresentation)
    private readonly presentationsRepository: Repository<VerifiablePresentation>,
  ) {}

  @Post()
  async create(@Body() dto: CreatePresentationDto) {
    const context = dto.context ?? DEFAULT_VP_CONTEXT;
    const vpHash = sha256Hex(
      stableStringify({ holderDidId: dto.holderDidId, credentialIds: dto.credentialIds, context }),
    );

    const presentation = await this.presentationsRepository.save(
      this.presentationsRepository.create({
        holderDidId: dto.holderDidId,
        verifierOrganizationId: dto.verifierOrganizationId ?? null,
        vpHash,
        context,
        credentialIds: dto.credentialIds,
      }),
    );

    return { success: true, presentation };
  }
}
