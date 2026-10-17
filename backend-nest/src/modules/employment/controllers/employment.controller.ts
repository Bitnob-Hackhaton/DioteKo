import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';

/**
 * Placeholder shell for the `employment` domain (plan step 10, "7 domain
 * shells" scope). Public — nothing sensitive is exposed yet.
 */
// TODO: real domain logic — not implemented this pass
@ApiTags('employment')
@Controller('employment')
@Public()
export class EmploymentController {
  @Get()
  getStatus() {
    return {
      implemented: false,
      domain: 'employment',
      message: 'Not implemented in this pass',
    };
  }
}
