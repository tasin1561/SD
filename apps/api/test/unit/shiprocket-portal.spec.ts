import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { SystemIssueService } from '../../src/modules/system-issues/services/system-issue.service';
import type { CourierCredentialService } from '../../src/modules/courier-shared/services/courier-credential.service';
import {
  ShiprocketPortalChallengeError,
  ShiprocketPortalCredentialsMissingError,
  ShiprocketPortalProxyMissingError,
  ShiprocketPortalSessionService,
  gotoShiprocket,
  isShiprocketLoginUrl,
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

describe('ShiprocketPortalSessionService', () => {
  it('REFUSES to start without the Bangalore proxy — it never connects directly', async () => {
    const prisma = {
      client: { systemSetting: { findUnique: async () => ({ valueString: '  ' }) } },
    } as unknown as PrismaService;
    const svc = new ShiprocketPortalSessionService(prisma, {} as CourierCredentialService);
    await expect(svc.open('acct', 'run')).rejects.toBeInstanceOf(ShiprocketPortalProxyMissingError);
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

  it.each(['SHIPROCKET_PORTAL_QUEUE', 'JOB_SHIPROCKET_PORTAL_PROBE'])('%s', (name) => {
    expect(pick(worker, name)).toBeDefined();
    expect(pick(trigger, name)).toBe(pick(worker, name));
  });
});
