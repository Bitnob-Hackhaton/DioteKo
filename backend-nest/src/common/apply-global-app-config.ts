import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpExceptionFilter } from './filters/http-exception.filter';

/**
 * The global wiring every entrypoint into the app must apply identically:
 * `main.ts` (the real server) and `test/utils/create-test-app.ts` (E2E).
 * Keeping it in one place stops the two from drifting (a test passing against
 * a different pipe/prefix/filter config than production is worse than no test).
 *
 * `rawBody: true` (needed by the Bitnob webhook signature guard) is a
 * `NestFactory.create` / `createNestApplication` option, so it stays at the
 * call sites — it can't be applied here.
 */
export function applyGlobalAppConfig(app: INestApplication): void {
  const configService = app.get(ConfigService);

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter(configService));
}
