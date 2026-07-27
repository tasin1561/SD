import { createHmac } from 'node:crypto';
import { WebhookAuthService } from '../../src/modules/tracking-ingestion/services/webhook-auth.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { makeTestEnv } from '../helpers/env';

type AnyArgs = Record<string, unknown>;

const COURIER = 'delhivery';
const RAW_BODY = '{"awb":"DLV-123","status":"DLV-DELIVERED","scan_at":"2026-05-25T10:00:00Z"}';

function correctSignatureFor(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

function makeService(
  opts: {
    /** valueString returned for `tracking.webhook_secret_ref`. */
    secretRefValue?: string | null;
    /** Override the TRACKING_WEBHOOK_SECRET_DELHIVERY env. */
    secretEnv?: string;
    /** D5: 'SHARED_SECRET' for couriers that do not sign (Delhivery). */
    authScheme?: 'HMAC_SHA256' | 'SHARED_SECRET';
  } = {},
) {
  // D5: settings are now resolved courier-first then global, so the
  // service reads a SET of keys rather than one.
  const findMany = jest.fn(async (args: AnyArgs) => {
    const keys = ((args.where as AnyArgs).key as AnyArgs).in as string[];
    const rows: Array<{ key: string; valueString: string | null }> = [];
    if (keys.includes('tracking.webhook_secret_ref')) {
      const v = opts.secretRefValue;
      if (v !== null) {
        rows.push({
          key: 'tracking.webhook_secret_ref',
          valueString: v ?? 'TRACKING_WEBHOOK_SECRET_DELHIVERY',
        });
      }
    }
    if (
      opts.authScheme !== undefined &&
      keys.includes('tracking.webhook_auth_scheme')
    ) {
      rows.push({
        key: 'tracking.webhook_auth_scheme',
        valueString: opts.authScheme,
      });
    }
    return rows;
  });
  const client = { systemSetting: { findMany } };
  const env = makeTestEnv(
    opts.secretEnv !== undefined
      ? { TRACKING_WEBHOOK_SECRET_DELHIVERY: opts.secretEnv }
      : {},
  );
  return new WebhookAuthService(
    { client } as unknown as PrismaService,
    env,
  );
}

describe('WebhookAuthService.verify', () => {
  it('valid: signature matches the configured secret → ok with secretRefEnvKey', async () => {
    const svc = makeService();
    const sig = correctSignatureFor(
      RAW_BODY,
      'test-tracking-webhook-secret-delhivery',
    );
    const r = await svc.verify({
      courierCode: COURIER,
      rawBody: RAW_BODY,
      signatureHeader: sig,
    });
    expect(r).toEqual({
      valid: true,
      secretRefEnvKey: 'TRACKING_WEBHOOK_SECRET_DELHIVERY',
    });
  });

  it('SECRET_REF_NOT_CONFIGURED: tracking.webhook_secret_ref missing → fail closed (TRK-1)', async () => {
    const svc = makeService({ secretRefValue: null });
    const r = await svc.verify({
      courierCode: COURIER,
      rawBody: RAW_BODY,
      signatureHeader: 'whatever',
    });
    expect(r).toEqual({ valid: false, reason: 'SECRET_REF_NOT_CONFIGURED' });
  });

  it('SECRET_REF_NOT_CONFIGURED: tracking.webhook_secret_ref empty string → fail closed', async () => {
    const svc = makeService({ secretRefValue: '' });
    const r = await svc.verify({
      courierCode: COURIER,
      rawBody: RAW_BODY,
      signatureHeader: 'whatever',
    });
    expect(r).toEqual({ valid: false, reason: 'SECRET_REF_NOT_CONFIGURED' });
  });

  it('SECRET_NOT_CONFIGURED: env var pointed-to is empty → fail closed', async () => {
    const svc = makeService({ secretEnv: '' });
    const sig = correctSignatureFor(RAW_BODY, ''); // would only match if env were ''
    const r = await svc.verify({
      courierCode: COURIER,
      rawBody: RAW_BODY,
      signatureHeader: sig,
    });
    expect(r).toEqual({ valid: false, reason: 'SECRET_NOT_CONFIGURED' });
  });

  it('SIGNATURE_MISSING: omitted header → 401', async () => {
    const svc = makeService();
    const r = await svc.verify({
      courierCode: COURIER,
      rawBody: RAW_BODY,
      signatureHeader: undefined,
    });
    expect(r).toEqual({ valid: false, reason: 'SIGNATURE_MISSING' });
  });

  it('SIGNATURE_MISSING: empty string header → 401', async () => {
    const svc = makeService();
    const r = await svc.verify({
      courierCode: COURIER,
      rawBody: RAW_BODY,
      signatureHeader: '',
    });
    expect(r).toEqual({ valid: false, reason: 'SIGNATURE_MISSING' });
  });

  it('SIGNATURE_MALFORMED: non-hex content → 401', async () => {
    const svc = makeService();
    const r = await svc.verify({
      courierCode: COURIER,
      rawBody: RAW_BODY,
      signatureHeader: 'not-a-hex-string!!',
    });
    expect(r).toEqual({ valid: false, reason: 'SIGNATURE_MALFORMED' });
  });

  it('SIGNATURE_MALFORMED: hex but wrong length → 401 (caught before timingSafeEqual)', async () => {
    const svc = makeService();
    const r = await svc.verify({
      courierCode: COURIER,
      rawBody: RAW_BODY,
      signatureHeader: 'deadbeef', // too short
    });
    expect(r).toEqual({ valid: false, reason: 'SIGNATURE_MALFORMED' });
  });

  it('SIGNATURE_MISMATCH: well-formed hex of correct length but wrong value → 401', async () => {
    const svc = makeService();
    const correct = correctSignatureFor(
      RAW_BODY,
      'test-tracking-webhook-secret-delhivery',
    );
    // Same length, all-zeroes (will not match unless lucky collision).
    const wrong = '0'.repeat(correct.length);
    const r = await svc.verify({
      courierCode: COURIER,
      rawBody: RAW_BODY,
      signatureHeader: wrong,
    });
    expect(r).toEqual({ valid: false, reason: 'SIGNATURE_MISMATCH' });
  });

  it('valid: uppercase hex signature accepted (normalized to lowercase)', async () => {
    const svc = makeService();
    const sig = correctSignatureFor(
      RAW_BODY,
      'test-tracking-webhook-secret-delhivery',
    ).toUpperCase();
    const r = await svc.verify({
      courierCode: COURIER,
      rawBody: RAW_BODY,
      signatureHeader: sig,
    });
    expect(r.valid).toBe(true);
  });

  it('signature is computed over the EXACT raw bytes (whitespace-sensitive — no re-serialization)', async () => {
    const svc = makeService();
    const bodyA = '{"a":1}';
    const bodyB = '{ "a": 1 }'; // semantically equivalent JSON, different bytes
    const sig = correctSignatureFor(
      bodyA,
      'test-tracking-webhook-secret-delhivery',
    );
    // Signature for bodyA must NOT validate bodyB.
    const r = await svc.verify({
      courierCode: COURIER,
      rawBody: bodyB,
      signatureHeader: sig,
    });
    expect(r).toEqual({ valid: false, reason: 'SIGNATURE_MISMATCH' });
  });
});

/**
 * D5 — the scheme that matters for the courier we actually use.
 *
 * Delhivery does not sign webhooks. You email them a requirement
 * document nominating your endpoint and YOUR authorization details, and
 * they send that credential back on every call. An HMAC-only verifier
 * would therefore reject every real scan — and silently, since a
 * rejected webhook is indistinguishable from one that never arrived.
 */
describe('WebhookAuthService.verify — SHARED_SECRET (Delhivery)', () => {
  const SECRET = 'a-static-credential-we-nominated';

  it('accepts the exact credential', async () => {
    const svc = makeService({
      authScheme: 'SHARED_SECRET',
      secretEnv: SECRET,
    });
    await expect(
      svc.verify({
        courierCode: 'delhivery',
        rawBody: '{"Shipment":{}}',
        signatureHeader: SECRET,
      }),
    ).resolves.toMatchObject({ valid: true });
  });

  it('tolerates a Bearer/Token prefix — we dictate the header, an operator may write either', async () => {
    const svc = makeService({ authScheme: 'SHARED_SECRET', secretEnv: SECRET });
    for (const header of [`Bearer ${SECRET}`, `Token ${SECRET}`]) {
      await expect(
        svc.verify({
          courierCode: 'delhivery',
          rawBody: '{}',
          signatureHeader: header,
        }),
      ).resolves.toMatchObject({ valid: true });
    }
  });

  it('rejects a wrong credential', async () => {
    const svc = makeService({ authScheme: 'SHARED_SECRET', secretEnv: SECRET });
    await expect(
      svc.verify({
        courierCode: 'delhivery',
        rawBody: '{}',
        signatureHeader: 'not-the-secret-at-all-no',
      }),
    ).resolves.toMatchObject({ valid: false, reason: 'SIGNATURE_MISMATCH' });
  });

  it('rejects an absent credential', async () => {
    const svc = makeService({ authScheme: 'SHARED_SECRET', secretEnv: SECRET });
    await expect(
      svc.verify({
        courierCode: 'delhivery',
        rawBody: '{}',
        signatureHeader: undefined,
      }),
    ).resolves.toMatchObject({ valid: false, reason: 'SIGNATURE_MISSING' });
  });

  it('does NOT care about the body — that is the trade-off, and it is deliberate', async () => {
    // A shared secret proves the caller knows a secret, not that the
    // payload is untampered. Stated here so the weakening is explicit
    // rather than discovered: the ingest path keeps IP throttling and
    // the processor keeps its idempotency gates because of it.
    const svc = makeService({ authScheme: 'SHARED_SECRET', secretEnv: SECRET });
    await expect(
      svc.verify({
        courierCode: 'delhivery',
        rawBody: 'anything at all',
        signatureHeader: SECRET,
      }),
    ).resolves.toMatchObject({ valid: true });
  });

  it('still fails CLOSED when no secret is configured', async () => {
    const svc = makeService({ authScheme: 'SHARED_SECRET', secretEnv: '' });
    await expect(
      svc.verify({
        courierCode: 'delhivery',
        rawBody: '{}',
        signatureHeader: 'whatever',
      }),
    ).resolves.toMatchObject({ valid: false, reason: 'SECRET_NOT_CONFIGURED' });
  });

  it('defaults to HMAC when no scheme is set — a missing setting must not weaken auth', async () => {
    const svc = makeService({ secretEnv: SECRET });
    await expect(
      svc.verify({
        courierCode: 'delhivery',
        rawBody: '{}',
        signatureHeader: SECRET, // valid as a shared secret, not as an HMAC
      }),
    ).resolves.toMatchObject({ valid: false });
  });
});

