import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EnvService } from '../../../config/env.service';

/**
 * Result of a webhook authentication attempt. NEVER carries the plaintext
 * secret or the computed expected signature — the caller logs only the
 * status + reason. A failure is always 401-equivalent: the controller
 * MUST NOT store an unauthenticated webhook in courier_webhooks (TRK-1).
 */
export type WebhookAuthResult =
  | { valid: true; secretRefEnvKey: string }
  | {
      valid: false;
      /** Coarse-grained, no secret material; safe to log + audit. */
      reason:
        | 'SECRET_REF_NOT_CONFIGURED' // tracking.webhook_secret_ref missing/empty
        | 'SECRET_NOT_CONFIGURED' // env var pointed to by the ref is empty
        | 'SIGNATURE_MISSING' // request omitted the signature header
        | 'SIGNATURE_MALFORMED' // not lowercase hex / wrong length
        | 'SIGNATURE_MISMATCH'; // HMAC computed but did not equal supplied
    };

/**
 * Per-courier system-setting key holding the env var name of the HMAC
 * secret. Phase 1A has one — Delhivery; add another setting key per
 * integrated courier as M-future couriers land (each follows the same
 * CUR-1 discipline — secret in env, ref in DB).
 */
const SECRET_REF_SETTING_KEY = 'tracking.webhook_secret_ref';

/**
 * Module 10 (TRK-1) — inbound webhook authentication. Verifies the
 * caller possessed a shared HMAC secret over the raw request body,
 * BEFORE the WebhookIngestService persists the row in courier_webhooks
 * (commit 5). An unauthenticated request returns 401 and IS NEVER
 * STORED — the raw inbound ledger is reserved for authenticated
 * payloads.
 *
 * ── STUB MODE (Phase 1A default) ───────────────────────────────────
 * Scheme: HMAC-SHA256(rawBody, secret) hex-encoded, supplied by the
 * caller in a single signature header (the controller pulls the
 * header value; this service does not care about the header NAME).
 * The secret comes from env (CUR-1 discipline; never the DB). An
 * empty secret means fail-closed — every authenticated path returns
 * 401 until the env is configured.
 *
 * ── REAL MODE (TODO(delhivery-api)) ────────────────────────────────
 * Delhivery's real webhook signature scheme is NOT reliably known at
 * build time and is NOT hallucinated. Validate against Delhivery's
 * webhook spec before flipping to real mode. Open seams:
 *   - HMAC algorithm (SHA256 / SHA1 / other)
 *   - Signature encoding (hex / base64 / prefixed)
 *   - Header NAME (X-Delhivery-Signature? Authorization?)
 *   - Inclusion of a timestamp / nonce + a replay-protection window
 *   - Body normalization (raw bytes vs canonicalized JSON)
 * Until validated, the stub scheme above is what tests exercise; this
 * service is the single point a real-mode swap touches.
 */
@Injectable()
export class WebhookAuthService {
  private readonly logger = new Logger(WebhookAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  async verify(input: {
    courierCode: string;
    /** Raw request body bytes, exactly as received (signed) — NEVER
     *  re-serialized JSON. */
    rawBody: string;
    /** Signature header value, or undefined if the header was absent. */
    signatureHeader: string | undefined;
  }): Promise<WebhookAuthResult> {
    // (1) Resolve the env var name for this courier from system_settings.
    const setting = await this.prisma.client.systemSetting.findUnique({
      where: { key: SECRET_REF_SETTING_KEY },
      select: { valueString: true },
    });
    const envKey = (setting?.valueString ?? '').trim();
    if (envKey === '') {
      // No ref configured — every webhook fails closed.
      this.logger.warn(
        { courierCode: input.courierCode },
        'Tracking webhook secret ref not configured — rejecting',
      );
      return { valid: false, reason: 'SECRET_REF_NOT_CONFIGURED' };
    }

    // (2) Resolve the secret value from env. NEVER logged.
    const secret = this.env.trackingWebhookSecretByRef(envKey);
    if (secret === '') {
      this.logger.warn(
        { courierCode: input.courierCode, envKey },
        'Tracking webhook secret env var is empty — rejecting',
      );
      return { valid: false, reason: 'SECRET_NOT_CONFIGURED' };
    }

    // (3) Signature header present?
    if (
      input.signatureHeader === undefined ||
      input.signatureHeader.length === 0
    ) {
      return { valid: false, reason: 'SIGNATURE_MISSING' };
    }

    // (4) Compute expected HMAC-SHA256 over the RAW body
    //     (TODO(delhivery-api): real-mode algorithm/encoding).
    const expected = createHmac('sha256', secret)
      .update(input.rawBody, 'utf8')
      .digest('hex');

    // (5) Constant-time compare. Reject if lengths differ (the
    //     timingSafeEqual call below also requires it).
    const supplied = input.signatureHeader.trim().toLowerCase();
    if (!/^[0-9a-f]+$/.test(supplied) || supplied.length !== expected.length) {
      return { valid: false, reason: 'SIGNATURE_MALFORMED' };
    }
    const ok = timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(supplied, 'utf8'),
    );
    if (!ok) return { valid: false, reason: 'SIGNATURE_MISMATCH' };

    return { valid: true, secretRefEnvKey: envKey };
  }
}
