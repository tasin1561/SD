import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The credential field NAMES the form offers must be the ones the
 * adapters read.
 *
 * They are free-form strings on both sides, which is the bad
 * combination: `ShiprocketHttpService` looks up `email` and `password`
 * by those exact keys, and a credential saved under the wrong name does
 * not fail at creation — it fails at the first booking, with the
 * courier waiting, in a message nobody connects back to a form filled in
 * weeks earlier.
 *
 * So this reads BOTH sides and compares them. Structural because there
 * is no runtime path from the admin form to the adapter: nothing but a
 * test can notice that one of them was renamed.
 */
const API = join(process.cwd(), '../../apps/api/src/modules');
const MODAL = join(
  process.cwd(),
  'src/app/(authed)/courier-accounts/_components/create-courier-account-modal.tsx',
);

function read(p: string): string {
  return readFileSync(p, 'utf8');
}

/** What the form would seed for this courier. */
function offered(courierCode: string): string[] {
  const src = read(MODAL);
  const block = /const CREDENTIAL_SHAPES[\s\S]*?\n\};/.exec(src)?.[0] ?? '';
  const line = new RegExp(`${courierCode}:\\s*\\[([^\\]]*)\\]`).exec(block)?.[1] ?? '';
  return [...line.matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
}

describe('credential field names match what the adapters read', () => {
  it('shiprocket — the adapter reads email + password', () => {
    const adapter = read(join(API, 'courier-shiprocket/services/shiprocket-http.service.ts'));
    // Read off the adapter rather than restated here: a test that
    // hardcodes both sides agrees with itself and with nothing else.
    const keys = [...adapter.matchAll(/creds\['([^']+)'\]/g)].map((m) => m[1] as string);
    expect(keys.sort()).toEqual(['email', 'password']);
    expect(offered('shiprocket').sort()).toEqual(keys.sort());
  });

  it('delhivery — the adapter reads apiToken', () => {
    const adapter = read(join(API, 'courier-delhivery/services/delhivery-http.service.ts'));
    const field = /const TOKEN_FIELD = '([^']+)'/.exec(adapter)?.[1];
    expect(field).toBe('apiToken');
    expect(offered('delhivery')).toEqual([field]);
  });

  it('an unlisted courier falls back rather than offering nothing', () => {
    // A blank field list would be worse than a wrong guess: it gives the
    // operator no shape at all to correct.
    expect(read(MODAL)).toMatch(/CREDENTIAL_SHAPES\[[^\]]+\]\s*\?\?\s*\['apiToken'\]/);
  });
});
