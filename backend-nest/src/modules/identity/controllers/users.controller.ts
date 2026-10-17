import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../../common/interfaces/jwt-payload.interface';
import { UsersService } from '../services/users.service';

/**
 * Minimal profile surface for this round — grows into real user CRUD once
 * that's actually needed. `GET /me` mirrors AuthController's `/auth/me` but
 * lives under the `users` namespace for future profile endpoints
 * (PATCH /me, etc).
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async me(@CurrentUser() currentUser: JwtPayload) {
    const user = await this.usersService.getProfileResponse(currentUser);
    return { success: true, user };
  }
}
