import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConsentModule } from './modules/consent/consent.module';
import configuration from './config/configuration';
import { envFilePathForNodeEnv } from './config/env-files';
import { validate } from './config/env.validation';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { DidVcModule } from './modules/did-vc/did-vc.module';
import { IdentityModule } from './modules/identity/identity.module';
import { AdminCertificatesModule } from './modules/admin-certificates/admin-certificates.module';
import { EducationDomainModule } from './modules/education/education-domain.module';
import { EmploymentDomainModule } from './modules/employment/employment-domain.module';
import { HealthDomainModule } from './modules/health/health-domain.module';
import { KycDomainModule } from './modules/kyc/kyc-domain.module';
import { MerchantDomainModule } from './modules/merchant/merchant-domain.module';
import { SocialAidDomainModule } from './modules/social-aid/social-aid-domain.module';
import { TransportDomainModule } from './modules/transport/transport-domain.module';
import { BitnobModule } from './modules/bitnob/bitnob.module';
import { HealthzModule } from './modules/healthz/healthz.module';
import { LightningModule } from './modules/lightning/lightning.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // NODE_ENV picks the file: .env (dev) / .env.test / .env.prod — see
      // config/env-files.ts. The standalone TypeORM CLI data source and the
      // seed CLI resolve the same way, so migrations/seed and the running app
      // always target the same database.
      envFilePath: envFilePathForNodeEnv(),
      load: [configuration],
      validate,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres' as const,
        host: configService.get<string>('database.host'),
        port: configService.get<number>('database.port'),
        username: configService.get<string>('database.username'),
        password: configService.get<string>('database.password'),
        database: configService.get<string>('database.name'),
        // Glob-loaded, same pattern as the standalone CLI data source in
        // src/database/data-source.ts — every *.entity.ts under src/ is
        // picked up automatically as feature modules add their own.
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
        synchronize: false,
        logging: configService.get<string>('nodeEnv') === 'development',
      }),
    }),

    HealthzModule,
    IdentityModule,
    DidVcModule,
    LightningModule,
    AdminCertificatesModule,
    ConsentModule,
    BitnobModule,

    // 7 domain shells (plan step 10) — placeholder entity + TODO controller
    // each, one `GET /api/{domain}` route apiece, no real business logic yet.
    HealthDomainModule,
    KycDomainModule,
    EducationDomainModule,
    TransportDomainModule,
    EmploymentDomainModule,
    SocialAidDomainModule,
    MerchantDomainModule,
  ],
  providers: [
    // Global guards, applied in order: JwtAuthGuard must run before
    // RolesGuard, since RolesGuard reads `request.user`, which is only
    // populated once JwtAuthGuard's passport 'jwt' strategy succeeds (or
    // the route is bypassed entirely via `@Public()`).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
