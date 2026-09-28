import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { SystemIssueService } from '../../src/modules/system-issues/services/system-issue.service';
import type { CourierCredentialService } from '../../src/modules/courier-shared/services/courier-credential.service';
import {
  ShiprocketPortalChallengeError,
  ShiprocketPortalCredentialsMissingError,
  ShiprocketPortalEgressError,
  ShiprocketPortalProxyMissingError,
  ShiprocketPortalSessionService,
  ShiprocketPortalSignInRejectedError,
  desktopChromeClientHints,
  desktopChromeUserAgent,
  gotoShiprocket,
  isShiprocketLoginUrl,
  shiprocketEdgeRefusal,
} from '../../src/modules/courier-portal/services/shiprocket-portal-session.service';
import {
  ShiprocketPortalProbeService,
  shiprocketDate,
} from '../../src/modules/courier-portal/services/shiprocket-portal-probe.service';

/**
 * The Shiprocket panel automation's safety rails: it never connects
 * without the Bangalore proxy, never retries past a challenge, and the
 * API's copy of its queue names cannot drift from the worker's.
 */
describe('isShiprocketLoginUrl', () => {
  it.each([
    ['https://app.shiprocket.in/newlogin', true],
    ['https://app.shiprocket.in/login?source=sg', true],
    ['https://app.shiprocket.in/seller/homepage', false],
    ['https://app.shiprocket.in/seller/wallet-transactions/passbook?from=2026-Aug-13', false],
    ['https://app.shiprocket.in/newloginx', false],
  ])('%s → %p', (url, want) => {
    expect(isShiprocketLoginUrl(url)).toBe(want);
  });
});

describe('gotoShiprocket — a bounce to login is an answer, anything else still throws', () => {
  const interrupted = (to: string): Error =>
    new Error(`page.goto: Navigation to "x" is interrupted by another navigation to "${to}"`);
  const fake = (err: Error, landsOn: string) =>
    ({
      goto: jest.fn(async () => {
        throw err;
      }),
      url: jest.fn(() => landsOn),
      waitForLoadState: jest.fn(async () => undefined),
    }) as never;

  it('accepts their router sending a signed-out visit to /newlogin', async () => {
    const login = 'https://app.shiprocket.in/newlogin';
    await expect(
      gotoShiprocket(fake(interrupted(login), login), 'https://app.shiprocket.in/seller/homepage'),
    ).resolves.toBeUndefined();
  });

  it('still throws when the detour went anywhere else', async () => {
    const other = 'https://app.shiprocket.in/seller/onboarding';
    await expect(
      gotoShiprocket(fake(interrupted(other), other), 'https://app.shiprocket.in/seller/homepage'),
    ).rejects.toThrow(/interrupted/);
  });

  it('still throws a timeout, even if the page happens to sit on login', async () => {
    await expect(
      gotoShiprocket(
        fake(new Error('page.goto: Timeout 45000ms exceeded'), 'https://app.shiprocket.in/login'),
        'https://app.shiprocket.in/seller/homepage',
      ),
    ).rejects.toThrow(/Timeout/);
  });
});

describe('shiprocketDate — their URL format, on the Indian calendar', () => {
  it('writes 2026-Aug-13', () => {
    expect(shiprocketDate(new Date('2026-08-13T06:00:00Z'))).toBe('2026-Aug-13');
  });
  it('an evening in UTC is already the next day in India', () => {
    expect(shiprocketDate(new Date('2026-09-10T20:00:00Z'))).toBe('2026-Sep-11');
  });
});

function sessionWith(settings: Record<string, string>): ShiprocketPortalSessionService {
  const prisma = {
    client: {
      systemSetting: {
        findUnique: async ({ where }: { where: { key: string } }) => ({
          valueString: settings[where.key] ?? '',
        }),
        findMany: async ({ where }: { where: { key: { in: string[] } } }) =>
          where.key.in.map((key) => ({ key, valueString: settings[key] ?? '' })),
      },
    },
  } as unknown as PrismaService;
  return new ShiprocketPortalSessionService(prisma, {} as CourierCredentialService);
}

describe('ShiprocketPortalSessionService', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const answers = (body: unknown): void => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => body,
    })) as unknown as typeof fetch;
  };

  it('REFUSES to start without a proxy — it never connects directly', async () => {
    const svc = sessionWith({ 'courier.shiprocket_portal_proxy': '  ' });
    await expect(svc.open('acct', 'run')).rejects.toBeInstanceOf(ShiprocketPortalProxyMissingError);
  });

  it('REFUSES to launch a browser when the egress check says the VPN is down', async () => {
    answers({ public_ip: '' });
    const svc = sessionWith({
      'courier.shiprocket_portal_proxy': 'http://127.0.0.1:1082',
      'courier.shiprocket_portal_egress_check_url': 'http://127.0.0.1:8001/v1/publicip/ip',
    });
    await expect(svc.open('acct', 'run')).rejects.toBeInstanceOf(ShiprocketPortalEgressError);
  });

  it('REFUSES a VPN that is perfectly healthy in the WRONG COUNTRY — the case being up cannot catch', async () => {
    answers({ public_ip: '186.247.180.208', country: 'United States', city: 'Atlanta' });
    const svc = sessionWith({
      'courier.shiprocket_portal_proxy': 'http://127.0.0.1:1082',
      'courier.shiprocket_portal_egress_check_url': 'http://127.0.0.1:8001/v1/publicip/ip',
      'courier.shiprocket_portal_egress_country': 'India',
    });
    await expect(svc.open('acct', 'run')).rejects.toThrow(/Atlanta.*should be in India/s);
  });

  it('asks NOTHING when no check is configured — the SSH tunnel has no control server', async () => {
    globalThis.fetch = (() => {
      throw new Error('the egress check must not be called when it is unset');
    }) as unknown as typeof fetch;
    const svc = sessionWith({ 'courier.shiprocket_portal_proxy': 'socks5://127.0.0.1:1081' });
    // It gets past the gate and dies at the browser, which this process has
    // no business launching — that it is NOT an egress error is the point.
    await expect(svc.open('acct', 'run')).rejects.not.toBeInstanceOf(ShiprocketPortalEgressError);
  });
});

function makeProbe(opts: { openIssue?: boolean; openError?: Error }) {
  const raise = jest.fn(async () => ({ id: 'i', isNew: true }));
  const prisma = {
    client: {
      courierAccount: { findMany: async () => [{ id: 'acct-sr', label: 'Shiprocket - primary' }] },
      systemIssue: { findFirst: async () => (opts.openIssue === true ? { id: 'x' } : null) },
    },
  } as unknown as PrismaService;
  const open = jest.fn(async () => {
    throw opts.openError ?? new Error('unexpected');
  });
  const svc = new ShiprocketPortalProbeService(
    prisma,
    { open } as unknown as ShiprocketPortalSessionService,
    { log: jest.fn(async () => 'a') } as unknown as AuditLogService,
    { raise, resolveByKey: jest.fn(async () => 0) } as unknown as SystemIssueService,
  );
  return { svc, raise, open };
}

describe('ShiprocketPortalProbeService', () => {
  it('does not even open a browser while a challenge is unresolved', async () => {
    const p = makeProbe({ openIssue: true });
    const [r] = await p.svc.probe('MANUAL');
    expect(r?.outcome).toBe('SKIPPED');
    expect(p.open).not.toHaveBeenCalled();
  });

  it('a challenge raises the issue that blocks every later run', async () => {
    const p = makeProbe({
      openError: new ShiprocketPortalChallengeError(
        'OTP',
        '/tmp/x.png',
        'https://app.shiprocket.in/newlogin',
      ),
    });
    const [r] = await p.svc.probe('MANUAL');
    expect(r?.outcome).toBe('CHALLENGE');
    expect(p.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'COURIER_PORTAL_CHALLENGE',
        dedupeKey: 'shiprocket-portal-challenge:acct-sr',
      }),
    );
  });

  it('a sign-in Shiprocket ACCEPTED and then refused gets its own issue, with what the browser could not load', async () => {
    /*
      This service used to keep its own copy of the failure mapping, which
      predated ShiprocketPortalSignInRejectedError — so this case was filed
      under the generic "could not open the panel" key, which sends a
      person to check a password and a tunnel that are both fine, and its
      message was cut at 400 characters, landing exactly on the network
      summary that exists to diagnose it. Two runs on 2026-09-28 were read
      from the wrong evidence because of it.
    */
    const p = makeProbe({
      openError: new ShiprocketPortalSignInRejectedError(
        'https://app.shiprocket.in/newlogin',
        'What the browser could not load:\n  401 apiv2.shiprocket.co/v1/get/version',
      ),
    });
    const [r] = await p.svc.probe('MANUAL');
    expect(r?.outcome).toBe('REJECTED');
    expect(p.raise).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: 'shiprocket-portal-rejected:acct-sr' }),
    );
    expect(r?.detail).toContain('apiv2.shiprocket.co/v1/get/version');
  });

  it('an egress that is down or in the wrong place is its OWN issue — nothing was signed in', async () => {
    const p = makeProbe({
      openError: new ShiprocketPortalEgressError('the VPN is not reporting a public IP', null),
    });
    const [r] = await p.svc.probe('MANUAL');
    expect(r?.outcome).toBe('EGRESS');
    expect(p.raise).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: 'shiprocket-portal-egress:acct-sr' }),
    );
  });

  it('a missing website login says so, and asks for it', async () => {
    const p = makeProbe({ openError: new ShiprocketPortalCredentialsMissingError() });
    const [r] = await p.svc.probe('MANUAL');
    expect(r?.outcome).toBe('NO_LOGIN');
    expect(p.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: 'COURIER_CREDENTIAL' }));
  });
});

describe('the API and the portal worker agree on the queue', () => {
  const src = (p: string): string => readFileSync(join(__dirname, '../../src/modules', p), 'utf8');
  const pick = (s: string, name: string): string | undefined =>
    new RegExp(`export const ${name} = '([^']+)'`).exec(s)?.[1];
  const worker = src('courier-portal/queue/shiprocket-portal.worker.ts');
  const trigger = src('shiprocket-cost-sync/services/shiprocket-portal-trigger.service.ts');

  it.each([
    'SHIPROCKET_PORTAL_QUEUE',
    'JOB_SHIPROCKET_PORTAL_PROBE',
    'JOB_SHIPROCKET_WALLET_SYNC',
    'JOB_SHIPROCKET_INVOICE_CHECK',
  ])('%s', (name) => {
    expect(pick(worker, name)).toBeDefined();
    expect(pick(trigger, name)).toBe(pick(worker, name));
  });

  // The /cost-sync page reads the wallet sync's history by these names.
  // Drift has no symptom but a card that says "has not run yet" forever.
  const sync = src('courier-portal/services/shiprocket-wallet-sync.service.ts');
  const panel = src('shiprocket-cost-sync/services/shiprocket-cost-panel.service.ts');
  it.each(['ACTION_SR_WALLET_OK', 'ACTION_SR_WALLET_FAILED'])('%s', (name) => {
    expect(pick(sync, name)).toBeDefined();
    expect(pick(panel, name)).toBe(pick(sync, name));
  });

  const invoiceCheck = src('courier-portal/services/shiprocket-invoice-check.service.ts');
  it.each(['ACTION_SR_INVOICES_OK', 'ACTION_SR_INVOICES_FAILED'])('%s', (name) => {
    expect(pick(invoiceCheck, name)).toBeDefined();
    expect(pick(panel, name)).toBe(pick(invoiceCheck, name));
  });

  /*
    The settings that say HOW the panel browser gets out are read in two
    places — the portal worker, which acts on them, and /cost-sync, which
    shows a person the answer. Drift would leave the page vouching for a
    route nobody uses, which is the precise mistake the page exists to
    make visible.
  */
  const session = src('courier-portal/services/shiprocket-portal-session.service.ts');
  const panelKey = (name: string): string | undefined =>
    new RegExp(`const ${name} = '([^']+)'`).exec(panel)?.[1];
  it.each([
    ['SETTING_SR_PROXY', 'SR_PORTAL_PROXY_SETTING'],
    ['SETTING_SR_EGRESS_URL', 'SR_PORTAL_EGRESS_CHECK_SETTING'],
    ['SETTING_SR_EGRESS_COUNTRY', 'SR_PORTAL_EGRESS_COUNTRY_SETTING'],
  ])('%s matches %s', (inPanel, inSession) => {
    expect(pick(session, inSession)).toBeDefined();
    expect(panelKey(inPanel)).toBe(pick(session, inSession));
  });
});

/**
 * The bug this file could not have caught before: `open()` reported
 * SUCCESS from the login page.
 *
 * `waitForURL(/\/seller\//)` resolves on the FIRST match and returns,
 * and their app routes to `/seller/...` and can bounce straight back to
 * `/newlogin?routestate=seller%2Fhome`. So a run that never signed in
 * saved that as its session state, and every page read afterwards said
 * "the session expired" — for five days, while their own
 * `/v1/auth/login` was answering 200 with a valid ten-day token
 * (measured 2026-09-28).
 *
 * A browser is the only way to see the bounce, so what is pinned here is
 * the CHECK: that the settle-and-re-ask exists at all, and that the
 * error it throws is a distinct kind. Delete the re-check and this
 * fails.
 */
describe('the panel sign-in is verified, not assumed', () => {
  const src = readFileSync(
    join(
      __dirname,
      '../../src/modules/courier-portal/services/shiprocket-portal-session.service.ts',
    ),
    'utf8',
  );

  it('re-asks after waitForURL instead of trusting one match', () => {
    const after = src.slice(src.indexOf('waitForURL(/\\/seller\\//'));
    expect(after).toContain('isShiprocketLoginUrl(page.url())');
    expect(after).toContain('ShiprocketPortalSignInRejectedError');
  });

  it('is a DIFFERENT failure from a challenge — one needs a person, the other needs them', () => {
    const rejected = new ShiprocketPortalSignInRejectedError(
      'https://app.shiprocket.in/newlogin?routestate=seller%2Fhome',
      'What the browser could not load:\n  401 apiv2.shiprocket.co/v1/get/version',
    );
    expect(rejected).not.toBeInstanceOf(ShiprocketPortalChallengeError);
    // It must not read as an expired session: that is the sentence that
    // sent everybody to re-check a password that was never wrong.
    expect(rejected.message).toContain('not an expired session');
    expect(rejected.message).toContain('401 apiv2.shiprocket.co');
  });

  it('carries no network report when there was nothing to report', () => {
    expect(
      new ShiprocketPortalSignInRejectedError('https://x/newlogin', null).message,
    ).not.toContain('could not load');
  });
});

/**
 * The browser half of the block their WAF applies.
 *
 * Measured 2026-09-29 as a credential-free CORS preflight, five times
 * per cell: through the NordVPN exit a Chrome UA is 200 and a
 * HeadlessChrome UA is 403; through either DigitalOcean address both are
 * 403. Two signals, ANDed — which is why one investigation concluded
 * "it is the browser" and another "it is the address", and each was half
 * right. Only the `HeadlessChrome` token moves the answer, so that is
 * the only thing these assert.
 */
describe('desktopChromeUserAgent', () => {
  it('never says HeadlessChrome, whatever version the browser is', () => {
    for (const v of ['149.0.7827.55', '140.0.0.0', '99.1.2.3']) {
      expect(desktopChromeUserAgent(v)).not.toContain('Headless');
    }
  });

  it('tracks the running browser rather than a version frozen at review time', () => {
    expect(desktopChromeUserAgent('149.0.7827.55')).toContain('Chrome/149.0.0.0');
    expect(desktopChromeUserAgent('151.0.1.2')).toContain('Chrome/151.0.0.0');
  });

  it('claims the platform it actually runs on — a Linux UA is accepted, so nothing pretends', () => {
    expect(desktopChromeUserAgent('149.0.7827.55')).toContain('X11; Linux x86_64');
  });

  it('still produces a usable string if the version is unreadable', () => {
    const ua = desktopChromeUserAgent('unknown');
    expect(ua).toContain('Chrome/unknown');
    expect(ua).not.toContain('Headless');
  });

  it('client hints agree with it, so the same word is not left in the same request', () => {
    const hints = desktopChromeClientHints('149.0.7827.55');
    expect(hints['sec-ch-ua']).not.toContain('Headless');
    expect(hints['sec-ch-ua']).toContain('v="149"');
    expect(hints['sec-ch-ua-platform']).toBe('"Linux"');
  });
});

/**
 * The credential-free readiness check in front of the sign-in. It exists
 * because a refused edge looked exactly like a session that would not
 * hold, which was diagnosed wrongly twice and retried against an account
 * that handles COD remittance.
 */
describe('shiprocketEdgeRefusal', () => {
  it('names the measured refusal: a 403 from the edge with no CORS header', () => {
    const reason = shiprocketEdgeRefusal(403, { server: 'CloudFront' });
    expect(reason).not.toBeNull();
    expect(reason).toContain('CloudFront');
    // The sentence has to stop somebody re-checking a password again.
    expect(reason).toContain('address is blocked');
  });

  it('says nothing when their own application answered', () => {
    expect(
      shiprocketEdgeRefusal(200, {
        server: 'istio-envoy',
        'access-control-allow-origin': 'https://app.shiprocket.in',
      }),
    ).toBeNull();
    expect(shiprocketEdgeRefusal(400, { server: 'istio-envoy' })).toBeNull();
    expect(shiprocketEdgeRefusal(429, { server: 'istio-envoy' })).toBeNull();
  });

  it('a 403 THEIR application produced is not this — it carries the CORS header', () => {
    expect(
      shiprocketEdgeRefusal(403, {
        server: 'istio-envoy',
        'access-control-allow-origin': 'https://app.shiprocket.in',
      }),
    ).toBeNull();
  });
});

describe('the sign-in asks the edge before it spends anything', () => {
  const src = readFileSync(
    join(
      __dirname,
      '../../src/modules/courier-portal/services/shiprocket-portal-session.service.ts',
    ),
    'utf8',
  );

  it('checks the edge BEFORE the credential is decrypted', () => {
    const login = src.slice(src.indexOf('private async login('));
    expect(login.indexOf('this.edgeRefusal(page)')).toBeLessThan(
      login.indexOf('getCredentialForAccount'),
    );
  });

  it('the browser presents the UA before it loads anything', () => {
    const open = src.slice(src.indexOf('async open('), src.indexOf('private async login('));
    expect(open.indexOf('userAgent: desktopChromeUserAgent')).toBeLessThan(
      open.indexOf('newPage()'),
    );
  });
});

/**
 * An issue raised by a shared helper must be cleared by a shared helper.
 *
 * These three keys were raised from `raiseShiprocketOpenFailure` and
 * cleared ONLY by the probe, so a wallet sync that signed in perfectly
 * left `shiprocket-portal-rejected` open — HIGH, and saying in so many
 * words "ask Shiprocket why a successful sign-in is being bounced".
 * Measured 2026-09-29: the fix worked, 176 stored transactions proved
 * it, and that issue was still telling a person to ring their account
 * manager. Whichever job runs first must be able to clear it.
 */
describe('a Shiprocket panel that opens clears what said it could not', () => {
  const read = (f: string): string =>
    readFileSync(join(__dirname, '../../src/modules/courier-portal/services', f), 'utf8');

  it('every key the raiser raises is one the clearer clears', () => {
    const raiser = read('shiprocket-portal-failures.ts');
    const keys = [...raiser.matchAll(/`(shiprocket-portal-[a-z]+):\$\{/g)].map((m) => m[1]);
    expect(keys).toContain('shiprocket-portal-rejected');
    const clearer = raiser.slice(
      raiser.indexOf('export async function clearShiprocketOpenFailures'),
    );
    for (const key of new Set(keys)) {
      // A challenge is the exception, and it is argued for in the code:
      // both jobs short-circuit on it before a browser is opened, so a
      // success never reaches this.
      if (key === 'shiprocket-portal-challenge') continue;
      expect(clearer).toContain(key);
    }
  });

  it('BOTH nightly jobs clear them, not just the probe', () => {
    for (const f of [
      'shiprocket-wallet-sync.service.ts',
      'shiprocket-invoice-check.service.ts',
      'shiprocket-portal-probe.service.ts',
    ]) {
      expect(read(f)).toContain('clearShiprocketOpenFailures');
    }
  });

  it('no job keeps its own copy of the key list', () => {
    for (const f of ['shiprocket-wallet-sync.service.ts', 'shiprocket-portal-probe.service.ts']) {
      expect(read(f)).not.toContain('`shiprocket-portal-rejected:');
    }
  });
});
