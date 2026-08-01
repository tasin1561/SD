import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A setting the admin UI offers must be a setting the code obeys.
 *
 * `sellerOverridable: true` on a seeded key is a promise: it puts that
 * key in the per-seller settings screen, where an admin sets a value,
 * sees it saved, and reasonably assumes it now applies. Nothing in the
 * type system connects that flag to the code that acts on the setting,
 * so the promise can be broken by simply not reading
 * `seller_setting_overrides` — and it WAS, for
 * `ops.call_max_attempts_before_ndr`. A seller configured for five call
 * attempts kept getting three. The value saved. The screen showed it.
 * The only symptom was orders rejecting earlier than someone expected.
 *
 * This walks every overridable key back to the file that consumes it and
 * insists that file resolves per-seller. It is a source scan rather than
 * a behavioural test because the failure is an ABSENCE — there is no
 * wrong behaviour to assert on, only a lookup that never happened.
 */

const SRC = join(__dirname, '../../src/modules');
const SEED = join(__dirname, '../../../../packages/db/prisma/seed.ts');

/** Keys seeded with `sellerOverridable: true`. */
function overridableKeys(): string[] {
  const seed = readFileSync(SEED, 'utf8');
  const blocks = seed.split(/\n {2}\{\n/).slice(1);
  const keys: string[] = [];
  for (const block of blocks) {
    const body = block.split(/\n {2}\},/)[0] ?? '';
    const key = /key: '([^']+)'/.exec(body)?.[1];
    if (key && body.includes('sellerOverridable: true')) keys.push(key);
  }
  return keys;
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...tsFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Keys deliberately read globally, with the reason.
 *
 * An entry here is a decision, not an exemption to reach for: it means
 * the value genuinely must not vary per seller.
 */
const GLOBAL_ONLY: Record<string, string> = {
  // A tax rate is set by law, not negotiated per customer.
  'pricing.flat_fee_gst_percent': 'GST rate is statutory',
};

describe('every seller-overridable setting is actually resolved per seller', () => {
  const files = tsFiles(SRC).filter((f) => !f.endsWith('.spec.ts'));

  it('finds keys to check (the scan itself is not silently empty)', () => {
    // A parser that quietly matched nothing would make every assertion
    // below pass by vacuum.
    expect(overridableKeys().length).toBeGreaterThan(10);
  });

  it.each(overridableKeys())('%s is consumed via SettingsResolverService', (key) => {
    if (GLOBAL_ONLY[key]) return;

    // The file that names the key is the one that acts on it.
    const consumers = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return src.includes(`'${key}'`) && !f.includes('/settings/');
    });
    expect(consumers.length).toBeGreaterThan(0);

    for (const file of consumers) {
      const src = readFileSync(file, 'utf8');
      const resolvesPerSeller =
        src.includes('settings.resolve(') ||
        src.includes('settings.resolveIntWithLegacy(') ||
        src.includes('this.settings.resolve');
      expect({ key, file, resolvesPerSeller }).toEqual({
        key,
        file,
        resolvesPerSeller: true,
      });
    }
  });

  it('the two grandfathered columns route through the shared precedence', () => {
    // `seller_setting_overrides` must beat a legacy column, because the
    // override is the more recent deliberate act — and both sites have
    // to agree on that, which is why the order lives in one method.
    const legacySites = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return (
        src.includes('callMaxAttemptsBeforeNdrOverride:') ||
        src.includes('reservationTtlHoursOverride:')
      );
    });
    expect(legacySites.length).toBe(2);
    for (const file of legacySites) {
      expect(readFileSync(file, 'utf8')).toContain('resolveIntWithLegacy(');
    }
  });
});
