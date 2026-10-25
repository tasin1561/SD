import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ENUM_VALUED_STRING_KEYS,
  URL_VALUED_STRING_KEYS,
} from '../../src/modules/settings/services/settings-resolver.service';

const SEED = readFileSync(join(__dirname, '../../../../packages/db/prisma/seed.ts'), 'utf8');

/**
 * The seeded default and the validator's allow-list must agree.
 *
 * `assertReferencesExist` stores an ENUM_VALUED_STRING_KEYS value
 * `.trim().toUpperCase()`, and the seed writes straight through Prisma
 * with no validator in front of it. So a lower-case seed default and an
 * upper-case allow-list produce a setting that reads one way until the
 * first admin edit and the other way afterwards — with every reader
 * downstream quietly taking a different branch depending on whether
 * anyone has touched the row. It would never fail; it would just start
 * behaving differently one day, which is worse.
 *
 * This was nearly shipped on 2026-10-25: the seed said `off`, the
 * allow-list said `OFF`. The test reads the seed's SOURCE rather than
 * importing it, because importing it connects to a database.
 */
function seededString(key: string): string {
  const block = SEED.split(`key: '${key}'`)[1];
  expect(block).toBeDefined();
  const m = /valueString: '([^']*)'/.exec(block ?? '');
  expect(m).not.toBeNull();
  return m?.[1] ?? '';
}

describe('order page v2 — the flags are seeded in the form the validator writes', () => {
  it.each(['orders.page_v2_audience', 'address_check.mode'])(
    '%s seeds a default its own allow-list accepts',
    (key) => {
      const allowed = ENUM_VALUED_STRING_KEYS[key];
      expect(allowed).toBeDefined();
      expect(allowed).toContain(seededString(key));
    },
  );

  it('the two flags default to the inert setting', () => {
    // Deploy one: nobody sees the new page, and nothing is blocked for
    // anyone who does. Both defaults are the "this change is not
    // happening yet" value, so landing the code is not landing the
    // feature.
    expect(seededString('orders.page_v2_audience')).toBe('OFF');
    expect(seededString('address_check.mode')).toBe('SHADOW');
  });

  it('every audience value the flag may hold is one the brief names', () => {
    // Upper-cased storage, lower-cased vocabulary. If a fourth audience
    // is ever added, it has to be added here too — which is the point.
    expect([...(ENUM_VALUED_STRING_KEYS['orders.page_v2_audience'] ?? [])].sort()).toEqual([
      'ALL',
      'OFF',
      'STAFF',
    ]);
  });

  it('the pilot allowlist seeds EMPTY', () => {
    // A pilot that starts with somebody in it is a pilot nobody chose.
    const block = SEED.split("key: 'orders.page_v2_allowlist'")[1] ?? '';
    expect(block).toMatch(/valueJson: \[\]/);
  });

  it('the base URL is host-allow-listed, because every call to it carries our key', () => {
    const patterns = URL_VALUED_STRING_KEYS['address_check.base_url'];
    expect(patterns).toBeDefined();
    const host = new URL(seededString('address_check.base_url')).hostname;
    expect((patterns ?? []).some((re) => re.test(host))).toBe(true);
  });

  it('the seeded base URL is HTTPS and is their public host', () => {
    // "Always this public URL, even though both run on the same
    // server": a loopback or private address here would couple two
    // products that are deliberately joined only over HTTP.
    const url = new URL(seededString('address_check.base_url'));
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('address-api.solustation.site');
  });
});
