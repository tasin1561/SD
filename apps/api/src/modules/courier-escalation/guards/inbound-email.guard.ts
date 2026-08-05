import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { InboundEmailAuthService } from '../services/inbound-email-auth.service';

/**
 * Verify the Worker's HMAC BEFORE anything else looks at the request.
 *
 * ── WHY A GUARD AND NOT A LINE IN THE HANDLER ────────────────────────
 * Nest's order is guards → interceptors → pipes → handler. With the
 * check as the first statement of the handler, `ValidationPipe` had
 * already run: a malformed body came back 400 with field-level detail to
 * a caller who had proved nothing, and the endpoint answered questions
 * about its own schema to anyone who asked.
 *
 * Nothing was ever stored unauthenticated — TRK-1's rule held — but
 * "authentication precedes storage" is weaker than "authentication
 * precedes everything", and there was no reason to settle for the weaker
 * one. Moved while the endpoint has no real traffic, because changing an
 * auth path with mail flowing through it is a worse moment.
 *
 * The verification itself is UNCHANGED: same service, same fail-closed
 * behaviour, same log line. This moves *when* it runs, not *what* it
 * decides.
 */
@Injectable()
export class InboundEmailGuard implements CanActivate {
  constructor(private readonly auth: InboundEmailAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    // The EXACT bytes, as received. Re-serialising a parsed object
    // reorders keys and drops whitespace, so a signature over the
    // round-trip fails for honest requests and could be made to pass for
    // altered ones.
    const signature = req.header('x-skydrop-signature') ?? undefined;
    // Throws UnauthorizedException; that IS the refusal.
    this.auth.assertValid(req.rawBody ?? Buffer.alloc(0), signature);
    return true;
  }
}
