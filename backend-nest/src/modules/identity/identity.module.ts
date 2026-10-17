import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { parseDurationToMs } from '../../common/utils/duration.util';
import { DidVcModule } from '../did-vc/did-vc.module';
import { AuthController } from './controllers/auth.controller';
import { UsersController } from './controllers/users.controller';
import { Organization } from './entities/organization.entity';
import { Role } from './entities/role.entity';
import { Session } from './entities/session.entity';
import { User } from './entities/user.entity';
import { UserRole } from './entities/user-role.entity';
import { AppwriteService } from './services/appwrite.service';
import { AuthService } from './services/auth.service';
import { UsersService } from './services/users.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([Organization, User, Role, UserRole, Session]),
    // modules/did-vc does NOT import IdentityModule back (DidService only
    // takes plain controllerUserId/controllerOrganizationId strings), so
    // this one-directional import doesn't create a circular module graph.
    DidVcModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret', ''),
        // jsonwebtoken's `expiresIn` only accepts a `number` (seconds) or its
        // branded `ms`-package string literal type — not a plain `string` —
        // so TTL config strings ("15m") are converted via parseDurationToMs.
        signOptions: {
          // Pinned explicitly (rather than left to jsonwebtoken's default)
          // so a future `secret`/library change can't silently widen the
          // accepted algorithm set — matches the `algorithms: ['HS256']`
          // pin on the verify side in `JwtStrategy` and
          // `CredentialVerificationService.verify`.
          algorithm: 'HS256',
          expiresIn: Math.floor(parseDurationToMs(configService.get<string>('jwt.accessTtl', '15m')) / 1000),
        },
      }),
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [AuthService, UsersService, AppwriteService, JwtStrategy],
  exports: [AuthService, UsersService],
})
export class IdentityModule {}
