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
  } = {},
) {
  const findUnique = jest.fn(async (args: AnyArgs) => {
    if (
      (args.where as { key: string }).key === 'tracking.webhook_secret_ref'
    ) {
      const v = opts.secretRefValue;
      if (v === null) return null;
      return { valueString: v ?? 'TRACKING_WEBHOOK_SECRET_DELHIVERY' };
    }
    return null;
  });
  const client = { systemSetting: { findUnique } };
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
