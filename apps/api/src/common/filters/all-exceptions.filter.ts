import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface StructuredError {
  code: string;
  message: string;
  details?: unknown;
  requestId: string | null;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const requestId = req.requestId ?? null;

    const { status, body } = this.normalize(exception, requestId);

    if (status >= 500) {
      this.logger.error(
        { requestId, path: req.url, method: req.method, err: exception },
        'Unhandled exception',
      );
    } else {
      this.logger.warn({ requestId, path: req.url, method: req.method, status, code: body.code });
    }

    res.status(status).json(body);
  }

  private normalize(
    exception: unknown,
    requestId: string | null,
  ): {
    status: number;
    body: StructuredError;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const { code, message, details } = this.extractFromHttpResponse(response, status);
      return {
        status,
        body: { code, message, requestId, ...(details !== undefined ? { details } : {}) },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        requestId,
      },
    };
  }

  private extractFromHttpResponse(
    response: string | object,
    status: number,
  ): { code: string; message: string; details?: unknown } {
    if (typeof response === 'string') {
      return { code: defaultCodeFor(status), message: response };
    }

    const r = response as Record<string, unknown>;
    const code = typeof r['code'] === 'string' ? r['code'] : defaultCodeFor(status);
    const message =
      typeof r['message'] === 'string'
        ? r['message']
        : Array.isArray(r['message'])
          ? r['message'].join('; ')
          : defaultMessageFor(status);
    const details = r['details'] ?? (Array.isArray(r['message']) ? r['message'] : undefined);
    return { code, message, ...(details !== undefined ? { details } : {}) };
  }
}

function defaultCodeFor(status: number): string {
  if (status === 400) return 'BAD_REQUEST';
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422) return 'UNPROCESSABLE_ENTITY';
  if (status === 429) return 'TOO_MANY_REQUESTS';
  if (status >= 500) return 'INTERNAL_ERROR';
  return 'ERROR';
}

function defaultMessageFor(status: number): string {
  if (status >= 500) return 'Internal server error';
  return 'Request failed';
}
