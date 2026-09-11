import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { SystemIssueService } from '../../src/modules/system-issues/services/system-issue.service';
import {
  ShiprocketPortalChallengeError,
  type ShiprocketPortalHandle,
  type ShiprocketPortalSessionService,
} from '../../src/modules/courier-portal/services/shiprocket-portal-session.service';
import {
  ShiprocketInvoiceCheckService,
  type InvoicesRead,
} from '../../src/modules/courier-portal/services/shiprocket-invoice-check.service';
import { buildZip } from '../helpers/zip-builder';

/**
 * The nightly invoice check, with the browser replaced by what it would
 * have read. These cases are about what the night CONCLUDES and who is
 * told; the comparison itself is tested in shiprocket-invoice-rows.spec.
 */
class TestCheck extends ShiprocketInvoiceCheckService {
  read: InvoicesRead | Error = { rows: [], files: new Map() };
  protected override async readInvoices(): Promise<InvoicesRead> {
    if (this.read instanceof Error) throw this.read;
    return this.read;
  }
}

const NOW = new Date('2026-09-11T15:30:00.000Z');
const FREIGHT_HEADER =
  'AWB Code,Order ID,Billing Amount (Inclusive GST),Awb Assigned Date,Awb Status';
const VAS_HEADER = 'Channel Order Id,Order Id,AWB,Item Name,HSN Code,Total,Order_Date';

const ROWS = [
  [
    'SRF27HR000404559',
    'Freight',
    '30 Aug, 2026',
    '06 Sep, 2026',
    '₹ 190.72',
    'Paid',
    'View Invoice',
  ],
  ['SRV27HR000274953', 'VAS', '03 Aug, 2026', '10 Aug, 2026', '₹ 5.90', 'Paid', 'View Invoice'],
  ['SRV27HR000315314', 'VAS', '03 Sep, 2026', '10 Sep, 2026', '₹ 5.90', 'Paid', 'View Invoice'],
  [
    'SRSI27HR00064789',
    'Subscription',
    '08 Sep, 2026',
    '15 Sep, 2026',
    '₹ 799.00',
    'Paid',
    'View Invoice',
  ],
];
const FILES = (): Map<string, Buffer | Error | null> =>
  new Map<string, Buffer | Error | null>([
    [
      'SRF27HR000404559',
      Buffer.from(
        `${FREIGHT_HEADER}\n'AAA',1001,90.36,2026-08-01 10:00,DELIVERED\n'BBB',1002,100.36,2026-08-02 10:00,DELIVERED\n`,
      ),
    ],
    [
      'SRV27HR000274953',
      buildZip([
        {
          name: 'Whatsapp Tracking Status.csv',
          body: `${VAS_HEADER}\n2001,1,,Whatsapp Tracking Status,998593,5.9,2026-07-02 10:00:00`,
        },
      ]),
    ],
    [
      'SRV27HR000315314',
      buildZip([
        {
          name: 'Whatsapp Tracking Status.csv',
          body: `${VAS_HEADER}\n2002,2,,Whatsapp Tracking Status,998593,5.9,2026-08-05 10:00:00`,
        },
      ]),
    ],
  ]);

const dec = (s: string): { toFixed: () => string } => ({ toFixed: () => s });
const row = (
  orderId: string,
  type: string,
  sub: string,
  inr: string,
  iso: string,
  awb: string | null = null,
) => ({
  occurredAt: new Date(iso),
  kind: 'DEBIT',
  amountInr: dec(inr),
  awbNumber: awb,
  detail: { orderId, awbNumber: awb, transactionType: type, subCategory: sub, description: '' },
});
const MOVES = [
  row('1001', 'Freight Charges', 'Freight Forward', '90.36', '2026-08-01T04:30:00Z', 'AAA'),
  row('1002', 'Freight Charges', 'Freight Forward', '90.36', '2026-08-02T04:30:00Z', 'BBB'),
  row('2001', 'VAS', 'WhatsApp Communication', '5.90', '2026-07-02T04:30:00Z', 'W1'),
  row('2002', 'VAS', 'WhatsApp Communication', '5.90', '2026-08-05T04:30:00Z', 'W2'),
  // Charged in July, on neither invoice.
  row('2003', 'VAS', 'WhatsApp Communication', '5.90', '2026-07-16T06:00:00Z', 'W3'),
];

function makeSut(opts: {
  enabled?: boolean;
  openChallenge?: boolean;
  openError?: Error;
  read?: InvoicesRead | Error;
}) {
  const handle = {
    page: {},
    newPage: jest.fn(),
    close: jest.fn(async () => undefined),
  } as unknown as ShiprocketPortalHandle;
  const session = {
    open: jest.fn(async () => {
      if (opts.openError !== undefined) throw opts.openError;
      return handle;
    }),
  };
  const prisma = {
    client: {
      systemSetting: {
        findUnique: async ({ where }: { where: { key: string } }) =>
          where.key.endsWith('window_days')
            ? { valueInt: 120 }
            : { valueBoolean: opts.enabled ?? true },
      },
      courierAccount: {
        findMany: async () => [{ id: 'acct-sr', label: 'Shiprocket - primary' }],
      },
      systemIssue: {
        findFirst: async () => (opts.openChallenge === true ? { id: 'x' } : null),
      },
      courierWalletTransaction: {
        findMany: async () => MOVES,
        aggregate: async () => ({ _min: { occurredAt: new Date('2026-06-13T05:18:00Z') } }),
      },
    },
  };
  const audit = { log: jest.fn(async (_a: Record<string, unknown>) => 'a1') };
  const issues = {
    raise: jest.fn(async (_i: Record<string, unknown>) => ({ id: 'i', isNew: true })),
    resolveByKey: jest.fn(async (_k: string, _n: string) => 0),
  };
  const svc = new TestCheck(
    prisma as unknown as PrismaService,
    session as unknown as ShiprocketPortalSessionService,
    audit as unknown as AuditLogService,
    issues as unknown as SystemIssueService,
  );
  svc.read = opts.read ?? { rows: ROWS, files: FILES() };
  return { svc, session, handle, audit, issues };
}

const raised = (issues: { raise: jest.Mock }): Array<Record<string, unknown>> =>
  issues.raise.mock.calls.map((c) => c[0] as Record<string, unknown>);
const resolvedKeys = (issues: { resolveByKey: jest.Mock }): string[] =>
  issues.resolveByKey.mock.calls.map((c) => String(c[0]));

describe('ShiprocketInvoiceCheckService', () => {
  it('does nothing while switched off — and still records the run', async () => {
    const s = makeSut({ enabled: false });
    const out = await s.svc.check('SCHEDULE', NOW);
    expect(out.skipped).toBe('DISABLED');
    expect(s.session.open).not.toHaveBeenCalled();
    expect(s.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'courier.shiprocket_invoices.checked' }),
    );
  });

  it('does not open a browser while a sign-in challenge is unresolved', async () => {
    const s = makeSut({ openChallenge: true });
    const out = await s.svc.check('SCHEDULE', NOW);
    expect(out.accounts[0]?.outcome).toBe('SKIPPED');
    expect(s.session.open).not.toHaveBeenCalled();
  });

  it('raises an invoice that disagrees as HIGH while it can still be disputed, and clears the ones that match', async () => {
    const s = makeSut({});
    const out = await s.svc.check('MANUAL', NOW);

    expect(out.accounts[0]).toMatchObject({ outcome: 'CHECKED', invoicesRead: 4 });
    const statuses = Object.fromEntries(
      (out.accounts[0]?.result?.rows ?? []).map((r) => [r.invoiceId, r.status]),
    );
    expect(statuses).toEqual({
      SRF27HR000404559: 'DIFFERS',
      SRV27HR000274953: 'MATCHES',
      SRV27HR000315314: 'MATCHES',
      SRSI27HR00064789: 'NOT_ITEMIZED',
    });

    const freight = raised(s.issues).find(
      (i) => i['dedupeKey'] === 'shiprocket-invoice:acct-sr:SRF27HR000404559',
    );
    expect(freight).toMatchObject({ kind: 'MONEY', severity: 'HIGH' });
    expect(String(freight?.['detail'])).toMatch(
      /order 1002 · Freight · billed ₹100\.36 · wallet charged ₹90\.36/,
    );
    expect(String(freight?.['detail'])).toMatch(/by 2026-09-14/);

    expect(resolvedKeys(s.issues)).toEqual(
      expect.arrayContaining([
        'shiprocket-invoice:acct-sr:SRV27HR000274953',
        'shiprocket-invoice:acct-sr:SRV27HR000315314',
        'shiprocket-invoice-check:acct-sr',
      ]),
    );
    expect(s.handle.close).toHaveBeenCalled();
  });

  it('names VAS charges the wallet paid and no invoice billed', async () => {
    const s = makeSut({});
    await s.svc.check('SCHEDULE', NOW);
    const vas = raised(s.issues).find(
      (i) => i['dedupeKey'] === 'shiprocket-vas-uninvoiced:acct-sr',
    );
    expect(vas).toMatchObject({ kind: 'MONEY', severity: 'MEDIUM' });
    expect(String(vas?.['title'])).toMatch(/^1 Shiprocket VAS charge\(s\), ₹5\.90/);
    expect(String(vas?.['detail'])).toMatch(/order 2003/);
  });

  it('an itemized file it could not have is recorded against that invoice, not the night', async () => {
    const files = FILES();
    files.set(
      'SRV27HR000315314',
      new Error('SRV27HR000315314: their itemized file answered HTTP 403'),
    );
    const s = makeSut({ read: { rows: ROWS, files } });
    const out = await s.svc.check('SCHEDULE', NOW);
    expect(out.accounts[0]?.outcome).toBe('CHECKED');
    expect(
      out.accounts[0]?.result?.rows.find((r) => r.invoiceId === 'SRV27HR000315314')?.status,
    ).toBe('UNREADABLE');
    expect(raised(s.issues).map((i) => i['dedupeKey'])).toContain(
      'shiprocket-invoice-check:acct-sr',
    );
  });

  it('a read that fails says so, still closes the browser, and records a failed run', async () => {
    const s = makeSut({
      read: new Error('the invoice list never finished drawing (no invoice table)'),
    });
    const out = await s.svc.check('SCHEDULE', NOW);
    expect(out.accounts[0]?.outcome).toBe('FAILED');
    expect(raised(s.issues).map((i) => i['dedupeKey'])).toContain(
      'shiprocket-invoice-check:acct-sr',
    );
    expect(s.handle.close).toHaveBeenCalled();
    expect(s.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'courier.shiprocket_invoices.check_failed' }),
    );
  });

  it('a challenge at sign-in raises the SAME issue the wallet sync does', async () => {
    const s = makeSut({
      openError: new ShiprocketPortalChallengeError(
        'CAPTCHA',
        null,
        'https://app.shiprocket.in/newlogin',
      ),
    });
    const out = await s.svc.check('SCHEDULE', NOW);
    expect(out.accounts[0]?.outcome).toBe('CHALLENGE');
    expect(raised(s.issues).map((i) => i['dedupeKey'])).toContain(
      'shiprocket-portal-challenge:acct-sr',
    );
  });
});
