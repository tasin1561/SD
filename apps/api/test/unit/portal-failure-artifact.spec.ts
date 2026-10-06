import {
  attachPortalFailureArtifact,
  describePortalFailureArtifact,
  PORTAL_FAILURE_PREFIX,
  PortalFailureArtifactService,
  portalFailureArtifactOf,
} from '../../src/modules/courier-portal/services/portal-failure-artifact';
import { WalletLedgerFetcherService } from '../../src/modules/courier-portal/services/wallet-ledger-fetcher.service';

/**
 * What was on screen when the portal job failed.
 *
 * ── WHY ──────────────────────────────────────────────────────────────
 * The nightly Delhivery wallet sync captured NOTHING on failure, while
 * the one-off billing probe beside it has saved screenshots and raw
 * files all along. On 5 October 2026, an hour after the credential fix
 * got the sync past the company picker, it failed with:
 *
 *   page.waitForEvent: Timeout 120000ms exceeded while waiting for event "download"
 *
 * The wait is armed before the click, so the click landed and Delhivery
 * produced no file in two minutes. A slower export, a button that has
 * become a format menu, and a page that was still drawing are three
 * different fixes and that sentence cannot tell them apart — so the
 * owner had to go and look by hand.
 */
function spaces(opts: { putThrows?: boolean } = {}) {
  const putObject = jest.fn(async () => {
    if (opts.putThrows === true) throw new Error('spaces refused');
  });
  return { putObject, svc: { putObject } as never };
}

function page(opts: { text?: string; shotThrows?: boolean; textThrows?: boolean } = {}) {
  return {
    url: () => 'https://one.delhivery.com/finances/unified/transactions?sig=SECRET-SIGNATURE',
    innerText: async () => {
      if (opts.textThrows === true) throw new Error('page gone');
      return opts.text ?? 'Finances\nDownload Ledger\nBalance 12,345';
    },
    screenshot: async () => {
      if (opts.shotThrows === true) throw new Error('timeout');
      return Buffer.from('PNG');
    },
  } as never;
}

describe('capturing a portal failure', () => {
  it('stores the page text and a screenshot under one run folder', async () => {
    const s = spaces();
    const svc = new PortalFailureArtifactService(s.svc);
    const out = await svc.capture({
      page: page(),
      job: 'delhivery-wallet-sync',
      runId: '2026-10-05T21-10-00-000Z',
      courierAccountId: 'abcdef12-3456-7890-abcd-ef1234567890',
    });
    expect(out.textKey).toBe(
      `${PORTAL_FAILURE_PREFIX}/delhivery-wallet-sync/2026-10-05T21-10-00-000Z/abcdef12/page.txt`,
    );
    expect(out.screenshotKey?.endsWith('/page.png')).toBe(true);
    expect(s.putObject).toHaveBeenCalledTimes(2);
  });

  it('strips the query string from the URL it reports', async () => {
    // Their panel signs some of them, and this text goes into a system
    // issue a person reads and pastes — the `shiprocket-portal-network`
    // rule, applied here for the same reason.
    const svc = new PortalFailureArtifactService(spaces().svc);
    const out = await svc.capture({
      page: page(),
      job: 'j',
      runId: 'r',
      courierAccountId: 'acct-1234',
    });
    expect(out.url).toBe('https://one.delhivery.com/finances/unified/transactions');
    expect(out.url).not.toContain('SECRET-SIGNATURE');
  });

  it('puts nothing but ids we generated in the KEY', async () => {
    // Same rule as the credential redaction: a screenshot of the
    // operator's own signed-in page is acceptable, a credential value in
    // a durable filename is not.
    const svc = new PortalFailureArtifactService(spaces().svc);
    const out = await svc.capture({
      page: page(),
      job: 'delhivery-wallet-sync',
      runId: '2026-10-05T21-10-00-000Z',
      courierAccountId: 'abcdef12-3456',
      describeControl: async () => '1 match(es), label "Download Ledger"',
    });
    for (const key of [out.textKey ?? '', out.screenshotKey ?? '']) {
      expect(key).toMatch(
        /^courier-probes\/portal-failures\/delhivery-wallet-sync\/[\w.:-]+\/[0-9a-f]{8}\/page\.(txt|png)$/,
      );
    }
  });

  it('records what the control looked like — the half the timeout cannot say', async () => {
    const svc = new PortalFailureArtifactService(spaces().svc);
    const out = await svc.capture({
      page: page(),
      job: 'j',
      runId: 'r',
      courierAccountId: 'acct',
      describeControl: async () => '1 match(es), label "Download Ledger", aria-expanded=true',
    });
    expect(out.control).toContain('aria-expanded=true');
  });

  it('NEVER throws — it is called from inside a catch block', async () => {
    const svc = new PortalFailureArtifactService(spaces({ putThrows: true }).svc);
    const out = await svc.capture({
      page: page({ shotThrows: true, textThrows: true }),
      job: 'j',
      runId: 'r',
      courierAccountId: 'acct',
      describeControl: async () => {
        throw new Error('control read failed');
      },
    });
    expect(out.screenshotKey).toBeNull();
    expect(out.textKey).toBeNull();
    expect(out.error).toContain('control');
  });
});

describe('the artefact rides on the error', () => {
  class ChallengeLike extends Error {}

  it('keeps the error class, so a challenge is still a challenge', async () => {
    const err = new ChallengeLike('boom');
    const out = attachPortalFailureArtifact(err, {
      url: 'u',
      screenshotKey: 'k',
      textKey: null,
      control: null,
      pages: [],
      error: null,
    });
    expect(out).toBe(err);
    expect(out).toBeInstanceOf(ChallengeLike);
    expect(portalFailureArtifactOf(out)?.screenshotKey).toBe('k');
  });

  it('is invisible to JSON — nothing starts copying it into logs by accident', () => {
    const err = Object.assign(new Error('boom'), { context: 1 });
    attachPortalFailureArtifact(err, {
      url: 'u',
      screenshotKey: 'k',
      textKey: null,
      control: null,
      pages: [],
      error: null,
    });
    expect(Object.keys(err)).toEqual(['context']);
  });

  it('reads as absent on an error that never had one', () => {
    expect(portalFailureArtifactOf(new Error('x'))).toBeNull();
    expect(portalFailureArtifactOf('a string')).toBeNull();
  });

  it('reads as prose a person can act on', () => {
    const text = describePortalFailureArtifact({
      url: 'https://one.delhivery.com/finances/unified/transactions',
      screenshotKey: 'courier-probes/portal-failures/j/r/abc/page.png',
      textKey: null,
      control: '0 match(es)',
      pages: [],
      error: null,
    });
    expect(text).toContain('Page: https://one.delhivery.com/finances');
    expect(text).toContain('0 match(es)');
    expect(text).toContain('page.png');
  });

  it('names the other tabs, because a click can hand its work to one', () => {
    const text = describePortalFailureArtifact({
      url: 'https://one.delhivery.com/finances/unified/transactions',
      screenshotKey: null,
      textKey: null,
      control: null,
      pages: [
        'https://one.delhivery.com/finances/unified/transactions',
        'https://one.delhivery.com/reports/export',
      ],
      error: null,
    });
    expect(text).toContain('Other pages open:');
    expect(text).toContain('/reports/export');
  });

  it('stays quiet when the only page open is the one we were watching', () => {
    // A line reading "Other pages open: <the page we were on>" on every
    // failure is noise that teaches a reader to skip the field.
    const text = describePortalFailureArtifact({
      url: 'https://one.delhivery.com/finances/unified/transactions',
      screenshotKey: null,
      textKey: null,
      control: null,
      pages: ['https://one.delhivery.com/finances/unified/transactions'],
      error: null,
    });
    expect(text).not.toContain('Other pages open');
  });
});

describe('the wallet-ledger fetcher', () => {
  function build(opts: { downloadThrows?: Error } = {}) {
    const close = jest.fn(async () => undefined);
    const p = { close, url: () => 'https://one.delhivery.com/x' };
    const session = { page: jest.fn(async () => p) } as never;
    const capture = jest.fn(async () => ({
      url: 'https://one.delhivery.com/finances/unified/transactions',
      screenshotKey: 'k.png',
      textKey: 'k.txt',
      control: '0 match(es)',
      error: null,
    }));
    const svc = new WalletLedgerFetcherService(session, { capture } as never);
    // The page object is constructed inside `fetch`, so the download is
    // faked by patching the prototype for the length of the call.
    const ledger = jest.requireActual(
      '../../src/modules/courier-portal/pages/wallet-ledger.page',
    ) as { WalletLedgerPage: { prototype: Record<string, unknown> } };
    ledger.WalletLedgerPage.prototype['download'] = jest.fn(async () => {
      if (opts.downloadThrows !== undefined) throw opts.downloadThrows;
      return { bytes: Buffer.from('file'), rangeApplied: true, window: 'LAST_90_DAYS' };
    });
    ledger.WalletLedgerPage.prototype['describeDownloadControl'] = jest.fn(
      async () => '0 match(es)',
    );
    return { svc, capture, close };
  }

  it('captures nothing on a good night', async () => {
    // On FAILURE only: a nightly screenshot of a signed-in finances page
    // is a standing privacy and storage cost for a page we already
    // parsed.
    const { svc, capture } = build();
    await svc.fetch('acct-1', new Date(0), new Date(1), 'run-1');
    expect(capture).not.toHaveBeenCalled();
  });

  it('captures BEFORE the page is closed, and attaches it to the error', async () => {
    const boom = new Error('page.waitForEvent: Timeout 120000ms exceeded');
    const { svc, capture, close } = build({ downloadThrows: boom });
    const err = await svc
      .fetch('acct-1', new Date(0), new Date(1), 'run-1')
      .catch((e: unknown) => e as Error);
    expect(capture).toHaveBeenCalledTimes(1);
    // The evidence only exists while the tab does.
    expect(capture.mock.invocationCallOrder[0]).toBeLessThan(
      close.mock.invocationCallOrder[0] ?? 0,
    );
    expect(err).toBe(boom);
    expect(portalFailureArtifactOf(err)?.screenshotKey).toBe('k.png');
  });
});
