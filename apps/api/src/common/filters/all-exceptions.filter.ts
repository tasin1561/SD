import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { SystemIssueService } from '../../modules/system-issues/services/system-issue.service';

interface StructuredError {
  code: string;
  message: string;
  details?: unknown;
  requestId: string | null;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  /**
   * REQUIRED, not optional, and not injected.
   *
   * The filter is constructed by hand in `main.ts` (and in the e2e
   * harness), so there is no DI to forget — which is exactly why the
   * parameter is required rather than defaulted. An optional one would
   * let a refactor drop the argument and take every 5xx off the board
   * with nothing failing anywhere; required, the compiler asks the
   * question.
   */
  constructor(private readonly issues: SystemIssueService) {}

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
      /*
        A 5xx is a request that failed for a reason nobody anticipated,
        and until now it went to a log file and stopped there. Somebody
        was told "something went wrong" and we found out when they rang.

        Fire-and-forget and never awaited: the caller is waiting on a
        response, and a board write must not be the thing that delays
        or breaks it. `raise` swallows its own failures for the same
        reason every alerting layer here does — we are already inside a
        failure path, and an alerter that throws turns a handled
        problem into an unhandled one.
      */
      void this.issues.reportRequestFailure({
        method: req.method,
        // The ROUTE, not the URL. `/admin/tickets/:ticketId` groups
        // every ticket's failures into one issue with a count;
        // `/admin/tickets/01a05d96-…` would open a fresh one per
        // request and bury the board in a thousand copies of one bug.
        route: req.route?.path ?? req.url,
        exception,
        requestId,
      });
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

    // body-parser rejects an oversize body by throwing a plain Error
    // carrying `status`/`type`, NOT an HttpException — so without this it
    // presented as a 500. That matters more than the status code: a
    // courier reading 500 retries forever and we investigate a phantom
    // server fault, where 413 says plainly that they sent more than we
    // accept.
    if (isPayloadTooLarge(exception)) {
      return {
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        body: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request body is larger than this endpoint accepts',
          requestId,
        },
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

/** body-parser's `entity.too.large`, which is not an HttpException. */
function isPayloadTooLarge(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const err = e as { type?: unknown; status?: unknown; statusCode?: unknown };
  return err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413;
}
