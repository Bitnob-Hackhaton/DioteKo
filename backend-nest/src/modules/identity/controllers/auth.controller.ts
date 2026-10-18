import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { JwtPayload } from '../../../common/interfaces/jwt-payload.interface';
import { AppwriteLoginDto } from '../dto/appwrite-login.dto';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { RegisterDto } from '../dto/register.dto';
import { AppwriteService } from '../services/appwrite.service';
import { AuthService } from '../services/auth.service';
import { UsersService } from '../services/users.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly appwriteService: AppwriteService,
  ) {}

  // Public, bcrypt-backed routes: capped per IP (named limits, see IdentityModule). `register`
  // and `login` are the brute-force / mass-signup surface; `refresh` is capped more loosely.
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto) {
    const tokens = await this.authService.register(dto.email, dto.password, dto.displayName);
    return { success: true, ...tokens };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    const tokens = await this.authService.login(dto.email, dto.password);
    return { success: true, ...tokens };
  }

  @Public()
  @Post('appwrite/login')
  @HttpCode(HttpStatus.OK)
  async appwriteLogin(@Body() dto: AppwriteLoginDto) {
    const identity = await this.appwriteService.verifyClientJwt(dto.appwriteJwt);
    // `tokens.user` is the safe AuthUserDto (never the entity).
    const tokens = await this.authService.completeAppwriteLogin(identity);
    return { success: true, ...tokens };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    const tokens = await this.authService.refresh(dto.refreshToken);
    return { success: true, ...tokens };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
    return { success: true };
  }

  @Get('me')
  @ApiBearerAuth()
  async me(@CurrentUser() currentUser: JwtPayload) {
    const user = await this.usersService.getProfileResponse(currentUser);
    return { success: true, user };
  }
}
