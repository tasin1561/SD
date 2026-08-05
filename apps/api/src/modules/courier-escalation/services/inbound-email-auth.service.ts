import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Authenticate the Cloudflare Worker that forwards courier email.
 *
 * ── WHY THE SECRET IS IN ENV, NOT `courier_credentials` ──────────────
 * CUR-1 governs COURIER credentials — the things that authenticate US to
 * a courier. This secret authenticates a piece of OUR OWN infrastructure
 * to our own API. It is the same class as
 * `TRACKING_WEBHOOK_SECRET_DELHIVERY`, and putting it in the courier
 * credential table would mean the API cannot verify a request until it
 * has decrypted a row — an availability dependency for something that is
 * not a courier secret at all.
 *
 * ── HMAC OVER THE RAW BYTES ──────────────────────────────────────────
 * The same discipline as TRK-1: the signature covers the EXACT bytes
 * received, never a re-serialised object. `JSON.parse` then
 * `JSON.stringify` reorders keys and drops insignificant whitespace, so
 * a signature computed over the round-trip would fail for correct
 * requests and — worse — could be made to pass for altered ones.
 *
 * FAILS CLOSED: an unset secret rejects everything. A webhook endpoint
 * that authenticates nothing when misconfigured is an open write path.
 */
@Injectable()
export class InboundEmailAuthService {
  private readonly logger = new Logger(InboundEmailAuthService.name);

  /** Read at call time, not construction: a secret added to the env and
   *  restarted-into must not need a code change to take effect, and
   *  tests set it per-case. */
  private secret(): string {
    return (process.env['COURIER_INBOUND_EMAIL_SECRET'] ?? '').trim();
  }

  /** True when the endpoint is usable at all. */
  isConfigured(): boolean {
    return this.secret().length > 0;
  }

  /**
   * @param rawBody the bytes as received — NOT a re-serialised object.
   * @param signature hex HMAC-SHA256 from the Worker.
   */
  assertValid(rawBody: Buffer, signature: string | undefined): void {
    const secret = this.secret();
    if (secret === '') {
      this.logger.error(
        'COURIER_INBOUND_EMAIL_SECRET is unset — refusing every inbound courier email',
      );
      throw new UnauthorizedException({
        code: 'INBOUND_EMAIL_NOT_CONFIGURED',
        message: 'Inbound courier email is not configured.',
      });
    }
    if (signature === undefined || signature === '') {
      throw new UnauthorizedException({
        code: 'INBOUND_EMAIL_SIGNATURE_MISSING',
        message: 'Missing signature.',
      });
    }

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    // Length check FIRST: timingSafeEqual throws on a length mismatch,
    // and a thrown comparison is itself a timing signal.
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException({
        code: 'INBOUND_EMAIL_SIGNATURE_INVALID',
        message: 'Invalid signature.',
      });
    }
  }
}
