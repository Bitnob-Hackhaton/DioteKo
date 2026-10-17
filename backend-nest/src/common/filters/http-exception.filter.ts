import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

/**
 * Global exception filter. Mirrors the response shape the existing Express
 * `backend/` already uses (`{ success: false, error, details }`), so any
 * future client that talks to both backends during the migration sees a
 * consistent error contract. Stack traces / internal error messages are
 * only included outside production (`NODE_ENV !== 'production'`), matching
 * `backend/src/index.js`'s `config.env === 'development'` check.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly configService: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const publicMessage = isHttpException ? this.extractMessage(exception) : 'Internal server error';

    const isDevelopment = this.configService.get<string>('nodeEnv') !== 'production';
    const internalDetail = exception instanceof Error ? exception.message : String(exception);

    // [RESULT] failed request — actionable: method, path, status, and the
    // real error detail (never suppressed in logs, only in the HTTP body).
    this.logger.error(
      `[RESULT] ${request.method} ${request.originalUrl} -> ${status}: ${internalDetail}`,
      isDevelopment && exception instanceof Error ? exception.stack : undefined,
    );

    response.status(status).json({
      success: false,
      error: publicMessage,
      // Machine-readable discriminator (e.g. `KYC_REQUIRED`) when an exception carries one, so a client can branch on it.
      code: isHttpException ? this.extractCode(exception) : undefined,
      details: isDevelopment ? internalDetail : undefined,
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
    });
  }

  /** `code` from the exception body, only when it is an UPPER_SNAKE identifier (never free text). */
  private extractCode(exception: HttpException): string | undefined {
    const body = exception.getResponse();
    if (typeof body === 'object' && body !== null && 'code' in body) {
      const code = (body as { code: unknown }).code;
      if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,40}$/.test(code)) return code;
    }
    return undefined;
  }

  private extractMessage(exception: HttpException): string {
    const body = exception.getResponse();

    if (typeof body === 'string') {
      return body;
    }

    if (typeof body === 'object' && body !== null && 'message' in body) {
      const message = (body as { message: unknown }).message;
      return Array.isArray(message) ? message.join(', ') : String(message);
    }

    return exception.message;
  }
}
