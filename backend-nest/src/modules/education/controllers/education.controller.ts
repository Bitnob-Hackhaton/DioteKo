import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';

/**
 * Placeholder shell for the `education` domain (plan step 10, "7 domain
 * shells" scope). Public — nothing sensitive is exposed yet.
 */
// TODO: real domain logic — not implemented this pass
@ApiTags('education')
@Controller('education')
@Public()
export class EducationController {
  @Get()
  getStatus() {
    return {
      implemented: false,
      domain: 'education',
      message: 'Not implemented in this pass',
    };
  }
}
