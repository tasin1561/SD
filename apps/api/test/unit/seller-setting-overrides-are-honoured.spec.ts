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

/**
 * Keys that ARE per seller, read globally by ONE named consumer.
 *
 * Distinct from `GLOBAL_ONLY` on purpose. That map says a value must
 * never vary per seller and exempts every reader of it; this one says
 * the value DOES vary per seller and is resolved that way by the
 * consumers that matter — but that at this particular call site there
 * is no seller to resolve it for, because the decision is at a
 * different GRAIN.
 *
 * Keying it on the file is what keeps that narrow: exempting the key
 * outright would have silently exempted the order path too, and the
 * order path is precisely where a seller pinned to `manual` must not be
 * quietly given the global default and a live waybill (CUR-19).
 */
const GLOBAL_AT: ReadonlyArray<{ key: string; file: string; why: string }> = [
  {
    key: 'ops.default_courier_code',
    file: 'courier-ops/services/courier-pickup.service.ts',
    why:
      'A pickup is per (courier, WAREHOUSE, day): one van comes to one building and ' +
      "carries many sellers' parcels, so there is no seller whose override could apply. " +
      'It reads the key so a pickup raised with no courier named follows the same default ' +
      'the rest of the system does, rather than a second hard-coded answer (which is what ' +
      "it held before — `const COURIER_CODE = 'delhivery'`). The ORDER path resolves the " +
      'same key per seller, in `OrderPostCommitHooksService`, and is NOT exempt here.',
  },
];

describe('every seller-overridable setting is actually resolved per seller', () => {
  const files = tsFiles(SRC).filter((f) => !f.endsWith('.spec.ts'));

  it('finds keys to check (the scan itself is not silently empty)', () => {
    // A parser that quietly matched nothing would make every assertion
    // below pass by vacuum.
    expect(overridableKeys().length).toBeGreaterThan(10);
  });

  it('every named-file exemption still names a real reader', () => {
    // An exemption that outlives the code it excuses is worse than no
    // exemption: it is a hole nobody can see, held open by a file path
    // that stopped meaning anything.
    for (const { key, file } of GLOBAL_AT) {
      const target = files.filter((f) => f.endsWith(file));
      expect({ file, found: target.length }).toEqual({ file, found: 1 });
      const src = readFileSync(target[0] as string, 'utf8');
      expect({ file, readsTheKey: src.includes(`'${key}'`) }).toEqual({ file, readsTheKey: true });
    }
  });

  it.each(overridableKeys())('%s is consumed via SettingsResolverService', (key) => {
    if (GLOBAL_ONLY[key]) return;

    // The file that names the key is the one that acts on it.
    const consumers = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return src.includes(`'${key}'`) && !f.includes('/settings/');
    });
    expect(consumers.length).toBeGreaterThan(0);

    // A key with a named-file exemption must STILL have a consumer that
    // resolves per seller — or the exemption has quietly become a
    // blanket one, which is the mistake it exists to avoid.
    const exemptFiles = GLOBAL_AT.filter((e) => e.key === key).map((e) => e.file);
    if (exemptFiles.length > 0) {
      const perSeller = consumers.filter((f) => !exemptFiles.some((e) => f.endsWith(e)));
      expect({ key, hasAPerSellerConsumer: perSeller.length > 0 }).toEqual({
        key,
        hasAPerSellerConsumer: true,
      });
    }

    for (const file of consumers) {
      if (exemptFiles.some((e) => file.endsWith(e))) continue;
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
