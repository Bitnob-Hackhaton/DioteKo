import { ArgumentsHost, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function run(exception: unknown) {
  const json = jest.fn();
  const response = { status: jest.fn().mockReturnValue({ json }) };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ method: 'POST', originalUrl: '/api/x' }) }),
  } as unknown as ArgumentsHost;
  const config = { get: jest.fn().mockReturnValue('production') };
  new HttpExceptionFilter(config as never).catch(exception, host);
  return { status: response.status.mock.calls[0][0] as number, body: json.mock.calls[0][0] as Record<string, unknown> };
}

describe('HttpExceptionFilter machine-readable code', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('passes through an UPPER_SNAKE code carried by the exception', () => {
    const { status, body } = run(new ForbiddenException({ statusCode: 403, code: 'KYC_REQUIRED', message: 'Identity verification is required' }));
    expect(status).toBe(403);
    expect(body).toMatchObject({ success: false, error: 'Identity verification is required', code: 'KYC_REQUIRED' });
  });

  it('leaves out a code that is not a plain identifier', () => {
    const { body } = run(new ForbiddenException({ code: 'free text with <html>', message: 'x' }));
    expect(body.code).toBeUndefined();
  });

  it('adds no code to an ordinary exception, nor to an unknown error', () => {
    expect(run(new NotFoundException('nope')).body.code).toBeUndefined();
    const { status, body } = run(new Error('db password is hunter2'));
    expect(status).toBe(500);
    expect(body).toMatchObject({ error: 'Internal server error' });
    expect(body.code).toBeUndefined();
  });
});
