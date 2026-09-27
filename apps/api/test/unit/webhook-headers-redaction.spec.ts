import { readFileSync } from 'node:fs';
import type { IncomingHttpHeaders } from 'node:http';
import {
  CREDENTIAL_HEADERS,
  SIGNATURE_HEADER,
  redactAuthHeaders,
} from '../../src/modules/tracking-ingestion/services/webhook-headers';

/**
 * `courier_webhooks.headers` is a stored copy of an inbound request's
 * headers, and under SHARED_SECRET a credential header's VALUE *is* the
 * secret (CUR-1: the key lives in env, never in a row).
 *
 * The bug this pins: only `x-skydrop-signature` was redacted. The
 * controllers also read `x-api-key` — which is the header Shiprocket
 * sends, and Shiprocket's seeded scheme is SHARED_SECRET — so that
 * secret was written into a column on every push, and into every backup
 * taken afterwards. Nothing failed; the row simply held the key.
 *
 * The shape of the bug is "a second credential header was added and the
 * redaction was not revisited", and it will recur with a third courier.
 * So the structural test below reads the controllers' own `@Headers(...)`
 * declarations and fails when one of them names a header the set does not
 * cover — the set cannot silently fall behind what is actually read.
 */
describe('redactAuthHeaders — credential headers never reach the row', () => {
  const CONTROLLERS = [
    'src/modules/tracking-ingestion/controllers/public-webhook.controller.ts',
    'src/modules/tracking-ingestion/controllers/public-document-webhook.controller.ts',
  ];

  it('redacts every name in the set, whatever the casing', () => {
    const headers: IncomingHttpHeaders = {
      'X-Skydrop-Signature': 'sig-secret',
      'x-api-key': 'shiprocket-shared-secret',
      Authorization: 'Bearer token-secret',
      cookie: 'session=secret',
      'content-type': 'application/json',
      'user-agent': 'Delhivery/1.0',
    };

    const stored = redactAuthHeaders(headers) as Record<string, string>;

    expect(stored['X-Skydrop-Signature']).toBe('[redacted]');
    expect(stored['x-api-key']).toBe('[redacted]');
    expect(stored['Authorization']).toBe('[redacted]');
    expect(stored['cookie']).toBe('[redacted]');

    // No secret survives anywhere in the stored value, under any key.
    const serialized = JSON.stringify(stored);
    for (const secret of [
      'sig-secret',
      'shiprocket-shared-secret',
      'token-secret',
      'session=secret',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('keeps non-credential headers, joining repeated values', () => {
    const stored = redactAuthHeaders({
      'content-type': 'application/json',
      'x-forwarded-for': ['1.2.3.4', '5.6.7.8'],
      'x-empty': undefined,
    }) as Record<string, string>;

    expect(stored['content-type']).toBe('application/json');
    expect(stored['x-forwarded-for']).toBe('1.2.3.4,5.6.7.8');
    expect(stored['x-empty']).toBe('');
  });

  it('covers the signature header and the four known credential names', () => {
    expect(CREDENTIAL_HEADERS.has(SIGNATURE_HEADER)).toBe(true);
    expect([...CREDENTIAL_HEADERS].sort()).toEqual([
      'authorization',
      'cookie',
      'x-api-key',
      'x-skydrop-signature',
    ]);
  });

  it('every header the controllers read as a credential is in the set', () => {
    // A credential header is one the controller feeds into the signature
    // it authenticates with. Both controllers name theirs in a
    // `@Headers('...')` parameter and combine them into `signatureHeader`.
    for (const rel of CONTROLLERS) {
      const src = readFileSync(rel, 'utf8');
      const declared = [...src.matchAll(/@Headers\('([^']+)'\)/g)].map((m) => m[1] ?? '');
      expect(declared.length).toBeGreaterThan(0);

      // Which of those does the controller actually treat as the auth
      // credential? Anything fed into `signatureHeader` — declared with
      // `=` in one controller and passed as `signatureHeader:` in the
      // other, so both shapes count.
      const signatureExpr = [...src.matchAll(/signatureHeader\s*[=:]\s*([^;,\n]+)/g)]
        .map((m) => m[1] ?? '')
        .join(' ');
      expect(signatureExpr).not.toBe('');

      for (const header of declared) {
        // Map the header name to the parameter name the controller bound
        // it to, then ask whether that parameter feeds the credential.
        const param = new RegExp(
          `@Headers\\('${header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)\\s*(\\w+)`,
        ).exec(src)?.[1];
        if (param === undefined) continue;
        if (!signatureExpr.includes(param)) continue;

        expect(CREDENTIAL_HEADERS.has(header.toLowerCase())).toBe(true);
      }
    }
  });
});
