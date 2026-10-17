import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';

/**
 * Placeholder shell for the `transport` domain (plan step 10, "7 domain
 * shells" scope). Public — nothing sensitive is exposed yet.
 */
// TODO: real domain logic — not implemented this pass
@ApiTags('transport')
@Controller('transport')
@Public()
export class TransportController {
  @Get()
  getStatus() {
    return {
      implemented: false,
      domain: 'transport',
      message: 'Not implemented in this pass',
    };
  }
}
