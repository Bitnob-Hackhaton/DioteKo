import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';

/**
 * Placeholder shell for the `health` domain (plan step 10, "7 domain
 * shells" scope). Public — nothing sensitive is exposed yet.
 */
// TODO: real domain logic — not implemented this pass
@ApiTags('health')
@Controller('health')
@Public()
export class HealthController {
  @Get()
  getStatus() {
    return {
      implemented: false,
      domain: 'health',
      message: 'Not implemented in this pass',
    };
  }
}
