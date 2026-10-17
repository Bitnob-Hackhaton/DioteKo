import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { applyGlobalAppConfig } from './common/apply-global-app-config';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  // [START] app bootstrap
  // `rawBody: true` populates `req.rawBody` (a Buffer) for the Bitnob webhook
  // signature guard — Bitnob signs the exact bytes it sends (HMAC-SHA512 over
  // the raw body), so re-serialising the parsed body would break verification.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const configService = app.get(ConfigService);

  // Global prefix + ValidationPipe + HttpExceptionFilter — shared verbatim
  // with the E2E test app (see common/apply-global-app-config.ts).
  applyGlobalAppConfig(app);

  // CORS for the web console only (exact origins; the mobile app is not subject to it). Bearer tokens travel in
  // the Authorization header, never in cookies, so credentials stay off.
  const corsOrigins = configService.get<string[]>('corsOrigins') ?? [];
  if (corsOrigins.length > 0) {
    app.enableCors({
      origin: corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    });
  }
  logger.log(`[STATE] CORS origins: ${corsOrigins.length ? corsOrigins.join(', ') : 'none'}`);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('DioteKo API (NestJS)')
    .setDescription(
      'Identity, DID/VC, payments (Bitnob Lightning), Bitnob integration, and admin-certificate ' +
        'issuance/verification backend for DioteKo. NestJS + TypeORM + Postgres.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, document);

  const port = configService.get<number>('port') ?? 3001;
  await app.listen(port);

  // [STATE] app listening
  logger.log(`[RESULT] DioteKo NestJS API listening on port ${port} (prefix: /api)`);
  logger.log(`[STATE] Swagger UI available at http://localhost:${port}/api-docs`);
}

bootstrap();
