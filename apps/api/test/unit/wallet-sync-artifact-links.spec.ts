import {
  PORTAL_FAILURE_PREFIX,
  WalletSyncHistoryService,
} from '../../src/modules/courier-cost-sync/services/wallet-sync-history.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { SpacesService } from '../../src/infrastructure/spaces/spaces.service';

/**
 * The failure capture, read back onto /cost-sync.
 *
 * A screenshot nobody can reach is a screenshot nobody looks at, which
 * is the whole point of taking one — so the panel mints a short-lived
 * link for it. The rules worth pinning are not about rendering:
 *
 *   - the KEY comes out of an audit row's JSON, so presigning whatever
 *     it says would mint a link to any object in the private bucket.
 *     Only keys under the portal-failure prefix are ever signed.
 *   - nothing is captured on a good night, so a successful account must
 *     not grow an empty artefact slot promising a file.
 *   - this page exists to show whether things are working; a signing
 *     failure must cost one link, never the page.
 */
function build(opts: {
  accounts: readonly Record<string, unknown>[];
  presign?: (key: string) => Promise<string>;
}) {
  const auditFindMany = jest.fn(async () => [
    {
      action: 'courier.wallet_ledger.sync_failed',
      createdAt: new Date('2026-10-05T21:10:00Z'),
      metadata: { wrote: true, windowDays: 90, accounts: opts.accounts },
    },
  ]);
  const prisma = {
    client: {
      systemSetting: { findMany: jest.fn(async () => []) },
      auditLog: { findMany: auditFindMany },
      // `costCoverage` runs alongside; answered flatly so these cases
      // are about the links and nothing else.
      shipment: {
        count: jest.fn(async () => 0),
        aggregate: jest.fn(async () => ({
          _sum: { actualCourierCostInr: null, actualRtoCostInr: null },
        })),
      },
    },
  } as unknown as PrismaService;

  const presignGetUrl = jest.fn(
    opts.presign ?? (async (key: string) => `https://spaces.example/${key}?signed=1`),
  );
  const svc = new WalletSyncHistoryService(prisma, {
    presignGetUrl,
  } as unknown as SpacesService);
  return { svc, presignGetUrl };
}

const failedAccount = (artifact: Record<string, unknown> | null) => ({
  courierAccountId: 'acct-1',
  label: 'Delhivery — MS EXPORTS',
  outcome: 'FAILED',
  error: 'page.waitForEvent: Timeout 120000ms exceeded',
  ...(artifact === null ? {} : { artifact }),
});

describe('the failure capture on /cost-sync', () => {
  it('presigns the screenshot and the page text', async () => {
    const { svc } = build({
      accounts: [
        failedAccount({
          url: 'https://one.delhivery.com/finances/unified/transactions',
          control: '0 match(es)',
          screenshotKey: `${PORTAL_FAILURE_PREFIX}delhivery-wallet-sync/run-1/abcdef12/page.png`,
          textKey: `${PORTAL_FAILURE_PREFIX}delhivery-wallet-sync/run-1/abcdef12/page.txt`,
          error: null,
        }),
      ],
    });
    const panel = await svc.panel();
    const a = panel.last?.accounts[0]?.failureArtifact;
    expect(a?.screenshotUrl).toContain('page.png?signed=1');
    expect(a?.pageTextUrl).toContain('page.txt?signed=1');
    // The two facts the timeout message cannot carry.
    expect(a?.url).toBe('https://one.delhivery.com/finances/unified/transactions');
    expect(a?.control).toBe('0 match(es)');
  });

  it('REFUSES a key outside the portal-failure prefix, and says so', async () => {
    // The key is JSON from an audit row. Signing whatever it says would
    // hand out a link to anything in the bucket — invoices, labels,
    // product images.
    const { svc, presignGetUrl } = build({
      accounts: [
        failedAccount({
          screenshotKey: 'invoices/seller-9/000123.pdf',
          textKey: null,
          url: null,
          control: null,
          error: null,
        }),
      ],
    });
    const panel = await svc.panel();
    const a = panel.last?.accounts[0]?.failureArtifact;
    expect(presignGetUrl).not.toHaveBeenCalled();
    expect(a?.screenshotUrl).toBeNull();
    // Reported rather than silently dropped: "there should be a capture
    // and there is not" is its own finding.
    expect(a?.problem).toMatch(/not under the portal-failure prefix/);
  });

  it('leaves a successful account with no artefact at all', async () => {
    // Nothing is captured on a good night, so there must be no empty
    // slot implying a file exists.
    const { svc, presignGetUrl } = build({
      accounts: [{ courierAccountId: 'acct-1', label: 'A', outcome: 'READ', error: null }],
    });
    const panel = await svc.panel();
    expect(panel.last?.accounts[0]?.failureArtifact).toBeNull();
    expect(presignGetUrl).not.toHaveBeenCalled();
  });

  it('carries the capture’s own problem through when it took nothing', async () => {
    const { svc } = build({
      accounts: [
        failedAccount({
          url: 'https://one.delhivery.com/finances/unified/transactions',
          control: null,
          screenshotKey: null,
          textKey: null,
          error: 'screenshot: timeout; text: page gone',
        }),
      ],
    });
    const a = (await svc.panel()).last?.accounts[0]?.failureArtifact;
    expect(a?.problem).toBe('screenshot: timeout; text: page gone');
    expect(a?.screenshotUrl).toBeNull();
  });

  it('does not 500 the page when signing fails', async () => {
    const { svc } = build({
      accounts: [
        failedAccount({
          screenshotKey: `${PORTAL_FAILURE_PREFIX}j/r/acct/page.png`,
          textKey: null,
          url: null,
          control: null,
          error: null,
        }),
      ],
      presign: async () => {
        throw new Error('no credentials');
      },
    });
    const panel = await svc.panel();
    expect(panel.last?.accounts[0]?.failureArtifact?.screenshotUrl).toBeNull();
    // The error itself still reaches the page, which is the point.
    expect(panel.last?.accounts[0]?.error).toContain('Timeout 120000ms');
  });
});
