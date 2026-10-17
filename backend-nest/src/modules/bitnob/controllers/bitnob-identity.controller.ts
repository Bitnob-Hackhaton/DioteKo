import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RoleCode } from '../../../modules/identity/entities/role.entity';
import { BitnobIdentityService } from '../services/bitnob-identity.service';

/**
 * `/api/bitnob/whoami` — Bitnob credentials/connectivity probe. `admin` only:
 * it exposes which Bitnob environment and company the platform's API key is
 * bound to, which is operational infrastructure detail, not something
 * `issuer`/`verifier` callers need.
 */
@ApiTags('bitnob')
@ApiBearerAuth()
@Controller('bitnob')
@Roles(RoleCode.ADMIN)
export class BitnobIdentityController {
  constructor(private readonly identity: BitnobIdentityService) {}

  @Get('whoami')
  async whoami() {
    return { success: true, whoami: await this.identity.whoami() };
  }
}
