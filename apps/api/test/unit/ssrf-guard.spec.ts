import {
  assertPublicHttpsUrl,
  isPublicUnicastAddress,
  SsrfBlockedError,
} from '../../src/common/net/ssrf-guard';

/**
 * The guard on the one URL a user hands us and we then fetch.
 *
 * Range checks are the kind of code that is wrong in a way nobody
 * notices: an off-by-one on 172.16/12 or a forgotten IPv4-mapped IPv6
 * form leaves the hole open while every test that only tries 10.0.0.1
 * still passes. So the boundaries are asserted on both sides.
 */
describe('ssrf-guard', () => {
  describe('isPublicUnicastAddress', () => {
    it('accepts ordinary public addresses', () => {
      // 9.9.9.9 is Quad9's resolver. The slot used to hold this
      // deployment's own origin address, which is a poor fixture: it puts
      // the production IP in the repo for no benefit and goes stale the
      // day the host moves. It cannot be a documentation range either —
      // 203.0.113.0/24 is reserved, so the guard rejects it, which this
      // test proved when it was tried.
      for (const ip of ['8.8.8.8', '1.1.1.1', '9.9.9.9', '2606:4700:4700::1111']) {
        expect(isPublicUnicastAddress(ip)).toBe(true);
      }
    });

    it('rejects every reserved IPv4 range', () => {
      for (const ip of [
        '0.0.0.0',
        '10.0.0.1',
        '10.255.255.255',
        '127.0.0.1',
        '100.64.0.1', // CGNAT
        '169.254.169.254', // the cloud metadata address
        '172.16.0.1',
        '172.31.255.255',
        '192.0.0.1',
        '192.0.2.1',
        '192.168.1.1',
        '198.18.0.1',
        '198.51.100.1',
        '203.0.113.1',
        '224.0.0.1', // multicast
        '255.255.255.255',
      ]) {
        expect({ ip, public: isPublicUnicastAddress(ip) }).toEqual({ ip, public: false });
      }
    });

    it('gets the 172.16/12 boundary right in BOTH directions', () => {
      // The classic off-by-one: 172.15 and 172.32 are public, the twelve
      // in between are not. A rule written as `a === 172` would blackhole
      // a legitimate customer; one written as `b === 16` leaves 17-31 open.
      expect(isPublicUnicastAddress('172.15.255.255')).toBe(true);
      expect(isPublicUnicastAddress('172.16.0.0')).toBe(false);
      expect(isPublicUnicastAddress('172.31.255.255')).toBe(false);
      expect(isPublicUnicastAddress('172.32.0.0')).toBe(true);
    });

    it('gets the 100.64/10 boundary right in BOTH directions', () => {
      expect(isPublicUnicastAddress('100.63.255.255')).toBe(true);
      expect(isPublicUnicastAddress('100.64.0.0')).toBe(false);
      expect(isPublicUnicastAddress('100.127.255.255')).toBe(false);
      expect(isPublicUnicastAddress('100.128.0.0')).toBe(true);
    });

    it('rejects reserved IPv6, including the IPv4-mapped forms', () => {
      for (const ip of [
        '::',
        '::1',
        'fc00::1', // unique-local
        'fd12:3456::1',
        'fe80::1', // link-local
        'ff02::1', // multicast
        '::ffff:127.0.0.1', // v4-mapped loopback — the bypass if unwrapping is missed
        '::ffff:169.254.169.254',
        '::ffff:10.0.0.1',
        '2002:a00:1::1', // 6to4 wrapping 10.0.0.1
        '64:ff9b::1', // NAT64
      ]) {
        expect({ ip, public: isPublicUnicastAddress(ip) }).toEqual({ ip, public: false });
      }
    });

    it('rejects anything that is not an IP at all', () => {
      for (const s of ['', 'localhost', 'not-an-ip', '999.999.999.999']) {
        expect(isPublicUnicastAddress(s)).toBe(false);
      }
    });
  });

  describe('assertPublicHttpsUrl', () => {
    const reason = async (url: string): Promise<string> => {
      try {
        await assertPublicHttpsUrl(url);
        return 'ALLOWED';
      } catch (e) {
        return e instanceof SsrfBlockedError ? e.reason : `unexpected: ${String(e)}`;
      }
    };

    it('blocks a literal metadata-service URL', async () => {
      // The prize behind this whole class of bug: DigitalOcean's metadata
      // includes the droplet's provisioning user-data.
      expect(await reason('https://169.254.169.254/metadata/v1.json')).toBe(
        'URL resolves to a non-public address',
      );
    });

    it('blocks loopback and private literals', async () => {
      expect(await reason('https://127.0.0.1:4000/admin/orders')).toBe(
        'URL resolves to a non-public address',
      );
      expect(await reason('https://10.104.0.2:4000/')).toBe('URL resolves to a non-public address');
      expect(await reason('https://[::1]/')).toBe('URL resolves to a non-public address');
    });

    it('blocks http, since the whole point is a TLS-authenticated peer', async () => {
      expect(await reason('http://example.com/hook')).toBe('URL must use https');
    });

    it('blocks embedded credentials', async () => {
      // `https://evil.com@127.0.0.1/` reads as evil.com to a human and
      // resolves to 127.0.0.1 in a parser.
      expect(await reason('https://user:pass@example.com/hook')).toBe(
        'URL must not embed credentials',
      );
    });

    it('blocks a hostname that does not resolve — fails CLOSED', async () => {
      expect(await reason('https://this-host-does-not-exist.invalid/hook')).toBe(
        'URL hostname does not resolve',
      );
    });

    it('blocks garbage', async () => {
      expect(await reason('not a url')).toBe('URL is not parseable');
    });

    it('allows a normal public https endpoint', async () => {
      // Resolution is real, so this asserts the guard does not simply
      // refuse everything — a deny-all guard passes every test above.
      expect(await reason('https://example.com/skydrop/webhooks')).toBe('ALLOWED');
    });
  });
});
