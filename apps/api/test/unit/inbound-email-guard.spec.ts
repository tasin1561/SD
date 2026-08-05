import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { InboundEmailGuard } from '../../src/modules/courier-escalation/guards/inbound-email.guard';
import { InboundEmailAuthService } from '../../src/modules/courier-escalation/services/inbound-email-auth.service';

/**
 * Authentication runs BEFORE the ValidationPipe.
 *
 * ── WHAT MOVED, AND WHY IT IS A TEST ─────────────────────────────────
 * With the HMAC check as the first line of the handler, Nest had already
 * run `ValidationPipe`: a malformed body returned 400 with field-level
 * detail to a caller who had proved nothing. Nothing was ever stored
 * unauthenticated, so TRK-1 held — but the endpoint answered questions
 * about its own schema to anyone who asked.
 *
 * A guard is the fix because Nest's order is guards → pipes → handler.
 * That ordering is invisible in the source: moving the check back into
 * the handler would still "work" for every honest request, and only the
 * unauthenticated-400 would come back. Hence a structural assertion that
 * the guard exists and the handler does not re-check.
 */

const SECRET = 'guard-test-secret';
const CONTROLLER = join(
  __dirname,
  '../../src/modules/courier-escalation/controllers/inbound-email.controller.ts',
);

function ctx(body: string, signature?: string): ExecutionContext {
  const req = {
    rawBody: Buffer.from(body, 'utf8'),
    header: (name: string) =>
      name.toLowerCase() === 'x-skydrop-signature' ? signature : undefined,
  };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

const sign = (body: string, secret = SECRET): string =>
  createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest('hex');

describe('InboundEmailGuard', () => {
  const guard = new InboundEmailGuard(new InboundEmailAuthService());
  const original = process.env['COURIER_INBOUND_EMAIL_SECRET'];

  afterEach(() => {
    if (original === undefined) delete process.env['COURIER_INBOUND_EMAIL_SECRET'];
    else process.env['COURIER_INBOUND_EMAIL_SECRET'] = original;
  });

  it('admits a correctly signed request', () => {
    process.env['COURIER_INBOUND_EMAIL_SECRET'] = SECRET;
    const body = '{"subject":"x"}';
    expect(guard.canActivate(ctx(body, sign(body)))).toBe(true);
  });

  it('refuses a bad signature', () => {
    process.env['COURIER_INBOUND_EMAIL_SECRET'] = SECRET;
    expect(() => guard.canActivate(ctx('{}', sign('{}', 'wrong')))).toThrow(/invalid/i);
  });

  it('still FAILS CLOSED with no secret — the behaviour did not change, only its timing', () => {
    delete process.env['COURIER_INBOUND_EMAIL_SECRET'];
    expect(() => guard.canActivate(ctx('{}', sign('{}')))).toThrow(/not configured/i);
  });

  it('refuses a body that would NOT survive the DTO — proving auth is first', () => {
    // This is the whole point. `{"bogus":1}` fails validation, but a
    // correctly-signed request must be REJECTED FOR ITS SIGNATURE before
    // the DTO is ever consulted. Here it is unsigned, so the guard
    // refuses and the caller learns nothing about our schema.
    process.env['COURIER_INBOUND_EMAIL_SECRET'] = SECRET;
    expect(() => guard.canActivate(ctx('{"bogus":1}', undefined))).toThrow(/missing/i);
  });
});

describe('the ordering is structural, not incidental', () => {
  const src = readFileSync(CONTROLLER, 'utf8');

  it('the controller applies the guard', () => {
    expect(src).toContain('@UseGuards(InboundEmailGuard)');
  });

  it('the handler does NOT re-check the signature', () => {
    // A leftover in-handler check would run after the pipe again and
    // quietly restore the unauthenticated-400 while looking safer.
    expect(src).not.toContain('assertValid');
  });

  it('the handler no longer takes the raw body or the signature header', () => {
    // If either is still a parameter, someone is about to use it.
    expect(src).not.toContain('rawBody');
    expect(src).not.toContain("@Headers('x-skydrop-signature')");
  });
});
