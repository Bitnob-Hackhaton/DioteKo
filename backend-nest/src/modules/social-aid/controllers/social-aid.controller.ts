import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';

/**
 * Placeholder shell for the `social-aid` domain (plan step 10, "7 domain
 * shells" scope). Public — nothing sensitive is exposed yet.
 */
// TODO: real domain logic — not implemented this pass
@ApiTags('social-aid')
@Controller('social-aid')
@Public()
export class SocialAidController {
  @Get()
  getStatus() {
    return {
      implemented: false,
      domain: 'social-aid',
      message: 'Not implemented in this pass',
    };
  }
}
