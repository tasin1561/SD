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
        | 'SECRET_REF_NOT_CONFIGURED' // secret-ref setting missing/empty
        | 'SECRET_NOT_CONFIGURED' // env var pointed to by the ref is empty
        | 'SIGNATURE_MISSING' // request omitted the credential header
        | 'SIGNATURE_MALFORMED' // not lowercase hex / wrong length
        | 'SIGNATURE_MISMATCH'; // computed/compared and did not match
    };

/**
 * How a given courier authenticates ITS webhooks to US.
 *
 *  - `HMAC_SHA256` — the courier signs the raw body with a shared secret
 *    and sends the hex digest. Strong: the payload itself is
 *    tamper-evident.
 *  - `SHARED_SECRET` — the courier sends a static credential in a header
 *    and nothing is signed. Weaker (it proves the caller knows a secret,
 *    not that the body is untouched), but it is what several couriers
 *    including **Delhivery** actually do, and rejecting it means
 *    rejecting all their scans.
 */
export type WebhookAuthScheme = 'HMAC_SHA256' | 'SHARED_SECRET';

/**
 * Per-courier system-setting key holding the env var name of the HMAC
 * secret. Phase 1A has one — Delhivery; add another setting key per
 * integrated courier as M-future couriers land (each follows the same
 * CUR-1 discipline — secret in env, ref in DB).
 */
const SECRET_REF_SETTING_KEY = 'tracking.webhook_secret_ref';
const AUTH_SCHEME_SETTING_KEY = 'tracking.webhook_auth_scheme';

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
 * ── WHY THE SCHEME IS PER-COURIER (D5) ─────────────────────────────
 * The original build assumed every courier signs its payloads. Reading
 * Delhivery's actual webhook documentation says otherwise: webhooks are
 * enabled by emailing them a "Webhook Requirement Document" carrying our
 * endpoint URL and **our chosen authorization details**. They do not
 * sign anything. So against the real Delhivery, an HMAC-only verifier
 * would 401 every single scan — silently, because a rejected webhook
 * looks identical to one that never arrived.
 *
 * Hence `tracking.webhook_auth_scheme[.<courier>]`:
 *   HMAC_SHA256   — verify a signature over the raw body (unchanged)
 *   SHARED_SECRET — constant-time compare a static credential header
 *
 * Both still fail CLOSED, and both still refuse to store an
 * unauthenticated payload (TRK-1). A shared secret is weaker than a
 * signature — it proves the caller knows a secret, not that the body is
 * untampered — which is why the ingest path keeps IP-throttling and the
 * processor keeps its idempotency gates.
 *
 * Settings resolve courier-first then global, so one courier moving to a
 * different scheme never disturbs another:
 *   tracking.webhook_auth_scheme.delhivery → tracking.webhook_auth_scheme
 *   tracking.webhook_secret_ref.delhivery  → tracking.webhook_secret_ref
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
    const envKey = await this.settingFor(SECRET_REF_SETTING_KEY, input.courierCode);
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
    if (input.signatureHeader === undefined || input.signatureHeader.length === 0) {
      return { valid: false, reason: 'SIGNATURE_MISSING' };
    }

    // (4) Verify per the courier's scheme.
    const scheme = await this.schemeFor(input.courierCode);
    if (scheme === 'SHARED_SECRET') {
      return this.verifySharedSecret(input.signatureHeader, secret, envKey);
    }

    const expected = createHmac('sha256', secret).update(input.rawBody, 'utf8').digest('hex');

    // (5) Constant-time compare. Reject if lengths differ (the
    //     timingSafeEqual call below also requires it).
    const supplied = input.signatureHeader.trim().toLowerCase();
    if (!/^[0-9a-f]+$/.test(supplied) || supplied.length !== expected.length) {
      return { valid: false, reason: 'SIGNATURE_MALFORMED' };
    }
    const ok = timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(supplied, 'utf8'));
    if (!ok) return { valid: false, reason: 'SIGNATURE_MISMATCH' };

    return { valid: true, secretRefEnvKey: envKey };
  }

  // ── internal ──────────────────────────────────────────────────────

  /**
   * A static credential in a header — what Delhivery actually sends.
   *
   * Compared in constant time, and tolerant of the usual `Bearer ` /
   * `Token ` prefixes because WE dictate the header contents in the
   * requirement document and an operator may well write it either way.
   */
  private verifySharedSecret(header: string, secret: string, envKey: string): WebhookAuthResult {
    const supplied = header.trim().replace(/^(Bearer|Token)\s+/i, '');
    if (supplied.length === 0) {
      return { valid: false, reason: 'SIGNATURE_MISSING' };
    }
    // Length is compared first because timingSafeEqual throws on a
    // mismatch. This leaks only the length of the credential.
    if (supplied.length !== secret.length) {
      return { valid: false, reason: 'SIGNATURE_MISMATCH' };
    }
    const ok = timingSafeEqual(Buffer.from(secret, 'utf8'), Buffer.from(supplied, 'utf8'));
    return ok
      ? { valid: true, secretRefEnvKey: envKey }
      : { valid: false, reason: 'SIGNATURE_MISMATCH' };
  }

  /** HMAC unless the courier is configured otherwise — the stricter
   *  scheme is the default, so a missing setting cannot weaken auth. */
  private async schemeFor(courierCode: string): Promise<WebhookAuthScheme> {
    const raw = (await this.settingFor(AUTH_SCHEME_SETTING_KEY, courierCode)).toUpperCase();
    return raw === 'SHARED_SECRET' ? 'SHARED_SECRET' : 'HMAC_SHA256';
  }

  /** `<key>.<courier>` if present, else `<key>`, else ''. */
  private async settingFor(key: string, courierCode: string): Promise<string> {
    const rows = await this.prisma.client.systemSetting.findMany({
      where: { key: { in: [`${key}.${courierCode.toLowerCase()}`, key] } },
      select: { key: true, valueString: true },
    });
    const specific = rows.find((r) => r.key === `${key}.${courierCode.toLowerCase()}`);
    const global = rows.find((r) => r.key === key);
    return ((specific ?? global)?.valueString ?? '').trim();
  }
}
