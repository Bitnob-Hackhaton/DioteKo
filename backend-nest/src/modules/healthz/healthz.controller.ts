import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Ops liveness/readiness probe — `GET /api/healthz`. Public (no auth), no
 * business data. Distinct from the `health` *domain* shell
 * (`GET /api/health`, the future healthcare-records surface).
 *
 * Used by the Dockerfile HEALTHCHECK, the compose healthchecks, and as the
 * cheapest reachability + DB check in E2E.
 *
 * 200 body: `{ status: 'ok', db: 'up', uptimeSeconds }`.
 * 503: the global HttpExceptionFilter renders `{ success: false, error:
 * 'database unavailable', ... }` (it does not echo the exception payload) —
 * the real DB error is logged, not returned.
 */
@ApiTags('healthz')
@Controller('healthz')
@Public()
export class HealthzController {
  private readonly logger = new Logger(HealthzController.name);
  private readonly startedAt = Date.now();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  @ApiOkResponse({ description: 'App is up and the database answered SELECT 1.' })
  @ApiServiceUnavailableResponse({ description: 'App is up but the database check failed.' })
  async check(): Promise<{ status: string; db: string; uptimeSeconds: number }> {
    const uptimeSeconds = Math.floor((Date.now() - this.startedAt) / 1000);
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok', db: 'up', uptimeSeconds };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`[RESULT] healthz db check failed uptimeSeconds=${uptimeSeconds} detail=${detail}`);
      throw new ServiceUnavailableException('database unavailable');
    }
  }
}
