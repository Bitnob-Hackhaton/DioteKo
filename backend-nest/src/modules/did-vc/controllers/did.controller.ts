import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RoleCode } from '../../identity/entities/role.entity';
import { CreateDidDto } from '../dto/create-did.dto';
import { DidService } from '../services/did.service';

/**
 * Internal/debug endpoints for the DID layer (`/api/did-vc/dids`). Not
 * meant for a public client in this pass — holder DIDs are normally created
 * implicitly on first Google login (`AuthService.completeAppwriteLogin`).
 * Useful for manual testing and for seeding organization (issuer/verifier)
 * DIDs. `POST /` is admin-only — it can mint a DID controlled by an
 * arbitrary user/organization id, so it must not be reachable by any
 * authenticated caller.
 */
@ApiTags('did-vc')
@ApiBearerAuth()
@Controller('did-vc/dids')
export class DidController {
  constructor(private readonly didService: DidService) {}

  @Post()
  @Roles(RoleCode.ADMIN)
  async create(@Body() dto: CreateDidDto) {
    const did = await this.didService.createDid(dto.controllerUserId, dto.controllerOrganizationId);
    return { success: true, did };
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    const did = await this.didService.findById(id);
    return { success: true, did };
  }
}
