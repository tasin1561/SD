import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  URL_VALUED_STRING_KEYS,
  urlSettingRefusal,
} from '../../src/modules/settings/services/settings-resolver.service';

/**
 * A URL-valued system setting is the DESTINATION OF A CALL THAT CARRIES
 * A CREDENTIAL, and `parseValue`'s STRING arm used to accept any string.
 *
 * `courier.delhivery_api_base_url` is sent `Authorization: Token <token>`
 * on every request, including reads; `courier.shiprocket_api_base_url`
 * receives `{ email, password }` whenever the token cache is cold; and
 * `courier.shiprocket_portal_egress_check_url` is fetched with no SSRF
 * guard and its distinguishable failure reasons are returned to the
 * caller. Nothing in the estate offers a read of courier plaintext to
 * ANY principal, SUPER_ADMIN included, so a settings edit that
 * redirected one of these was a plaintext read that no route grants.
 *
 * These assertions are about BEHAVIOUR of the pure refusal function
 * plus a two-way pin on the one list that is restated rather than
 * imported.
 */
describe('URL-valued system settings — host allowlist', () => {
  const KEYS = [
    'courier.delhivery_api_base_url',
    'courier.shiprocket_api_base_url',
    'courier.shiprocket_portal_egress_check_url',
  ] as const;

  it('covers every setting whose value is fetched with a credential', () => {
    for (const key of KEYS) {
      expect(URL_VALUED_STRING_KEYS[key]).toBeDefined();
    }
  });

  it('allows empty, because that is the state all three ship in', () => {
    // Seeded '' and read by each consumer as "not configured" — the
    // Delhivery client treats it as stub mode and Shiprocket's refuses
    // the call. Refusing empty would make the settings screen unable to
    // save the value it was given.
    for (const key of KEYS) {
      expect(urlSettingRefusal(key, '')).toBeNull();
      expect(urlSettingRefusal(key, '   ')).toBeNull();
    }
  });

  it('allows each courier its own real hosts', () => {
    expect(
      urlSettingRefusal('courier.delhivery_api_base_url', 'https://track.delhivery.com'),
    ).toBeNull();
    expect(
      urlSettingRefusal('courier.delhivery_api_base_url', 'https://staging-express.delhivery.com'),
    ).toBeNull();
    expect(
      urlSettingRefusal('courier.shiprocket_api_base_url', 'https://apiv2.shiprocket.in'),
    ).toBeNull();
    expect(
      urlSettingRefusal('courier.shiprocket_api_base_url', 'https://apiv2.shiprocket.co'),
    ).toBeNull();
  });

  it('allows the local simulator, which dev, CI and the tutorials all point at', () => {
    // `apps/delhivery-sim/src/server.ts` and
    // `scripts/tutorials/provision-stack.mjs` both set this to loopback.
    // Refusing it would have broken every one of those, which is why
    // this is a host allowlist and not `assertPublicHttpsUrl`.
    expect(urlSettingRefusal('courier.delhivery_api_base_url', 'http://127.0.0.1:4010')).toBeNull();
    expect(urlSettingRefusal('courier.delhivery_api_base_url', 'http://localhost:4010')).toBeNull();
  });

  it('REFUSES a host of the caller’s choosing', () => {
    // The finding: this exfiltrated the live Delhivery token and the
    // Shiprocket account password to any host an operator could type.
    for (const key of KEYS) {
      expect(urlSettingRefusal(key, 'https://attacker.example')).toMatch(
        /not an allowed destination/,
      );
      expect(urlSettingRefusal(key, 'https://track.delhivery.com.attacker.example')).not.toBeNull();
    }
  });

  it('refuses a non-URL and a non-http scheme', () => {
    expect(urlSettingRefusal('courier.delhivery_api_base_url', 'not a url')).toMatch(
      /absolute http/,
    );
    // file: / gopher: etc. are not destinations we ever want signed.
    expect(
      urlSettingRefusal('courier.delhivery_api_base_url', 'file:///etc/passwd'),
    ).not.toBeNull();
  });

  it('holds the egress check to LOOPBACK only', () => {
    const key = 'courier.shiprocket_portal_egress_check_url';
    // It names the VPN's own control server on this host. There is no
    // legitimate remote value, and it is the one URL fetched with no
    // guard whose four failure reasons are reported back — i.e. a port
    // scanner if it can be pointed anywhere.
    expect(urlSettingRefusal(key, 'http://127.0.0.1:8001/v1/publicip/ip')).toBeNull();
    expect(urlSettingRefusal(key, 'http://10.0.0.5:8001/')).not.toBeNull();
    expect(urlSettingRefusal(key, 'https://ifconfig.me')).not.toBeNull();
  });

  it('is cross-checked against a key it does not govern', () => {
    // A key with no entry must pass through untouched, or adding this
    // check would have silently started refusing unrelated settings.
    expect(urlSettingRefusal('ops.default_courier_code', 'delhivery')).toBeNull();
    expect(urlSettingRefusal('pricing.flat_delivery_fee_currency', 'BDT')).toBeNull();
  });

  /**
   * THE RESTATEMENT PIN, in both directions.
   *
   * The loopback/private set is `SIMULATOR_HOST_PATTERNS` in
   * `courier-write-guard.service.ts`. `SettingsResolverService` is
   * dependency-free by design (R0/R3) and must not import from a
   * courier module — the same reason `JSON_VALUED_ENUM_LIST_KEYS`
   * restates the NDR vocabulary instead of importing it — so the two
   * lists are kept honest here rather than by a shared import.
   *
   * Drift matters in a specific way: a host the write guard calls a
   * SIMULATOR is one it lets through with NO audit row, so if this list
   * refused such a host the operator would get a confusing 400, and if
   * the guard gained a pattern this list lacks, the safe-looking host
   * would be refused here while being un-audited there.
   */
  it('restates the write guard’s simulator patterns exactly', () => {
    const guardSrc = readFileSync(
      join(__dirname, '../../src/modules/courier-shared/services/courier-write-guard.service.ts'),
      'utf8',
    );
    const block = /SIMULATOR_HOST_PATTERNS:\s*readonly RegExp\[\]\s*=\s*\[([\s\S]*?)\];/.exec(
      guardSrc,
    );
    expect(block).not.toBeNull();
    const guardPatterns = (block?.[1] ?? '')
      .split('\n')
      .map((l) => l.trim().replace(/,$/, ''))
      .filter((l) => l.startsWith('/'));
    expect(guardPatterns.length).toBeGreaterThan(5);

    // Every pattern the guard treats as a simulator must be accepted by
    // both courier base-URL keys. Compare by SOURCE text, so a changed
    // pattern fails here rather than being approximated by a sample.
    const delhivery = (URL_VALUED_STRING_KEYS['courier.delhivery_api_base_url'] ?? []).map(
      (re) => `${re}`,
    );
    const shiprocket = (URL_VALUED_STRING_KEYS['courier.shiprocket_api_base_url'] ?? []).map(
      (re) => `${re}`,
    );
    for (const p of guardPatterns) {
      expect(delhivery).toContain(p);
      expect(shiprocket).toContain(p);
    }

    // And the other direction: this list must not quietly admit a
    // private-range shape the guard has since dropped.
    const simsHere = delhivery.filter(
      (p) => !/delhivery|shiprocket\\?\./i.test(p) || /sim/i.test(p),
    );
    for (const p of simsHere) {
      if (/delhivery\\?\.com|shiprocket\\?\.(in|co)/i.test(p)) continue;
      expect(guardPatterns).toContain(p);
    }
  });
});
