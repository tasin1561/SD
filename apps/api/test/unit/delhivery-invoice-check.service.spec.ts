import type { Page } from 'playwright';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { SystemIssueService } from '../../src/modules/system-issues/services/system-issue.service';
import type {
  InvoiceCheckRead,
  NoteListFinding,
} from '../../src/modules/courier-portal/pages/delhivery-billing.page';
import { parseListRows } from '../../src/modules/courier-portal/services/delhivery-billing-probe-files';
import { DelhiveryInvoiceCheckService } from '../../src/modules/courier-portal/services/delhivery-invoice-check.service';
import type { PortalSessionService } from '../../src/modules/courier-portal/services/portal-session.service';

/**
 * The nightly Delhivery invoice check with the browser replaced by what it
 * would have read. These cases are about what the night CONCLUDES and who
 * is told; the comparison itself is in delhivery-invoice-rows.spec.
 */
class TestCheck extends DelhiveryInvoiceCheckService {
  read: InvoiceCheckRead | Error = emptyRead();
  protected override async readInvoices(): Promise<InvoiceCheckRead> {
    if (this.read instanceof Error) throw this.read;
    return this.read;
  }
}

const NOW = new Date('2026-09-12T12:00:00.000Z');
const INV_HEADERS = ['INVOICE ID', 'INVOICE DATE', 'GST NUMBER', 'SERVICE TYPE', 'INVOICE AMOUNT'];
const LIST = parseListRows(INV_HEADERS, [
  ['EPH1', '31 Aug, 2026', 'GST', 'Domestic', '₹210.58'],
  ['EPVAS1', '31 Aug, 2026', 'GST', 'Communication VAS', '₹2.96'],
]);
const DOMESTIC = Buffer.from(
  [
    'waybill_num,pickup_date,serial_number,status,gross_amount,total_amount',
    '"=""W1""","=""2026-08-16 11:05:31""",EPH1,Delivered,49.85,58.83',
    '"=""W2""","=""2026-08-16 11:05:31""",EPH1,Delivered,61.25,72.28',
    '"=""W3""","=""2026-08-10 11:05:31""",EPH1,RTO,67.36,79.49',
  ].join('\n'),
);
const VAS = Buffer.from(
  [
    'message_id,waybill_order_id,serial_number,gross_amt,total_amt',
    '"=""m1""",W1,EPVAS1,1.50,1.77',
    '"=""m2""",W2,EPVAS1,1.00,1.18',
  ].join('\n'),
);
const notes = (kind: 'creditNotes' | 'debitNotes'): NoteListFinding => ({
  kind,
  tab: kind,
  pageUrl: 'https://one.delhivery.com/finances/invoices/invoice_list',
  loaded: 'empty',
  rangeLabel: 'Date Range : Last 90 Days',
  headers: [],
  rowCount: 0,
  rows: [],
  parsedRows: [],
  latest: null,
});
function emptyRead(): InvoiceCheckRead {
  return {
    found: true,
    invoices: LIST,
    range: null,
    creditNotes: notes('creditNotes'),
    debitNotes: notes('debitNotes'),
    files: new Map<string, Buffer | Error | null>([
      ['EPH1', DOMESTIC],
      ['EPVAS1', VAS],
    ]),
    menus: [],
    attempts: [],
    refused: [],
    stoppedBy: null,
    error: null,
  };
}

const dec = (s: string): { toFixed: () => string } => ({ toFixed: () => s });
let seq = 0;
const row = (
  awb: string | null,
  kind: 'DEBIT' | 'CREDIT',
  inr: string,
  iso: string,
  category: 'PARCEL' | 'ADJUSTMENT' = 'PARCEL',
  detail: Record<string, unknown> | null = awb === null ? null : { wbn: awb },
) => {
  seq += 1;
  return {
    txnId: `MTX${seq}`,
    awbNumber: awb,
    kind,
    category,
    amountInr: dec(inr),
    occurredAt: new Date(iso),
    detail,
  };
};
const RECON = { code: 'Freight adjustment debit', stage: 'Settlement based on reconciliation' };
const TXNS = [
  row('W1', 'DEBIT', '58.83', '2026-08-16T06:00:00Z'),
  row('W2', 'DEBIT', '72.28', '2026-08-18T06:00:00Z'),
  row('W2', 'CREDIT', '72.28', '2026-08-22T06:00:00Z'),
  row('W2', 'DEBIT', '71.10', '2026-08-22T06:00:00Z'),
  row('W2', 'DEBIT', '72.28', '2026-09-09T06:00:00Z', 'ADJUSTMENT', RECON),
  row('W2', 'CREDIT', '71.10', '2026-09-09T06:00:00Z', 'ADJUSTMENT', RECON),
  row('W3', 'DEBIT', '72.28', '2026-08-12T06:00:00Z'),
  row('W3', 'DEBIT', '79.49', '2026-08-20T06:00:00Z'),
  row('W3', 'CREDIT', '72.28', '2026-08-28T06:00:00Z'),
  row('W3', 'CREDIT', '79.49', '2026-08-28T06:00:00Z'),
  row('W3', 'CREDIT', '1499.00', '2026-09-08T06:00:00Z', 'ADJUSTMENT', {
    notes: 'Claim settled - CMS',
  }),
  row(null, 'DEBIT', '2.95', '2026-09-01T06:00:00Z', 'ADJUSTMENT', {
    serial_number: 'EPVAS1',
  }),
];
type Row = (typeof TXNS)[number];
type Where = {
  awbNumber?: { in: string[] };
  category?: string;
  occurredAt?: { gte: Date };
};
const matches = (r: Row, w: Where): boolean =>
  (w.awbNumber === undefined || (r.awbNumber !== null && w.awbNumber.in.includes(r.awbNumber))) &&
  (w.category === undefined || r.category === w.category) &&
  (w.occurredAt === undefined || r.occurredAt.getTime() >= w.occurredAt.gte.getTime());

function makeSut(opts: {
  enabled?: boolean;
  challenge?: boolean;
  read?: InvoiceCheckRead | Error;
}) {
  const page = { close: jest.fn(async () => undefined) };
  const session = { page: jest.fn(async () => page as unknown as Page) };
  const prisma = {
    client: {
      systemSetting: {
        findUnique: async ({ where }: { where: { key: string } }) =>
          where.key.endsWith('window_days')
            ? { valueInt: 120 }
            : where.key.endsWith('dispute_days')
              ? { valueInt: 15 }
              : { valueBoolean: opts.enabled ?? true },
      },
      courierAccount: {
        findMany: async () => [{ id: 'acct-d', label: 'Delhivery - primary' }],
      },
      systemIssue: {
        findFirst: async () => (opts.challenge === true ? { id: 'x' } : null),
      },
      courierWalletTransaction: {
        findMany: async ({ where }: { where: Where }) => TXNS.filter((r) => matches(r, where)),
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
    session as unknown as PortalSessionService,
    audit as unknown as AuditLogService,
    issues as unknown as SystemIssueService,
  );
  svc.read = opts.read ?? emptyRead();
  return { svc, session, page, audit, issues };
}

const raised = (issues: { raise: jest.Mock }): Array<Record<string, unknown>> =>
  issues.raise.mock.calls.map((c) => c[0] as Record<string, unknown>);
const resolvedKeys = (issues: { resolveByKey: jest.Mock }): string[] =>
  issues.resolveByKey.mock.calls.map((c) => String(c[0]));

describe('DelhiveryInvoiceCheckService', () => {
  it('does nothing while switched off — and still records the run', async () => {
    const s = makeSut({ enabled: false });
    const out = await s.svc.check('SCHEDULE', NOW);
    expect(out.skipped).toBe('DISABLED');
    expect(s.session.page).not.toHaveBeenCalled();
    expect(s.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'courier.delhivery_invoices.checked', entityId: null }),
    );
  });

  it('does not open a browser while a sign-in challenge is unresolved', async () => {
    const s = makeSut({ challenge: true });
    const out = await s.svc.check('SCHEDULE', NOW);
    expect(out.accounts[0]?.outcome).toBe('SKIPPED');
    expect(s.session.page).not.toHaveBeenCalled();
  });

  it('raises a disagreeing invoice as HIGH while it can still be disputed, naming the waybill, and clears the ones that match', async () => {
    const s = makeSut({});
    const out = await s.svc.check('MANUAL', NOW);

    expect(out.accounts[0]).toMatchObject({ outcome: 'CHECKED', invoicesRead: 2 });
    const statuses = Object.fromEntries(
      (out.accounts[0]?.result?.rows ?? []).map((r) => [r.invoiceId, r.status]),
    );
    expect(statuses).toEqual({ EPH1: 'DIFFERS', EPVAS1: 'MATCHES' });

    const domestic = raised(s.issues).find(
      (i) => i['dedupeKey'] === 'delhivery-invoice:acct-d:EPH1',
    );
    expect(domestic).toMatchObject({ kind: 'MONEY', severity: 'HIGH' });
    expect(String(domestic?.['detail'])).toMatch(/W3 \(RTO\) · billed ₹79\.49 · wallet net ₹0\.00/);
    expect(String(domestic?.['detail'])).toMatch(/by 2026-09-15/);
    expect(String(domestic?.['detail'])).toMatch(/is not known/);

    expect(resolvedKeys(s.issues)).toEqual(
      expect.arrayContaining([
        'delhivery-invoice:acct-d:EPVAS1',
        'delhivery-uninvoiced:acct-d',
        'delhivery-invoice-check:acct-d',
      ]),
    );
    expect(s.page.close).toHaveBeenCalled();
    expect(s.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'courier.delhivery_invoices.checked', severity: 'HIGH' }),
    );
  });

  it('an itemized file it could not have is recorded against that invoice, not the night', async () => {
    const r = emptyRead();
    const files = new Map(r.files);
    files.set('EPH1', new Error('"Transaction list" for EPH1 produced no file'));
    const s = makeSut({ read: { ...r, files } });
    const out = await s.svc.check('SCHEDULE', NOW);
    expect(out.accounts[0]?.outcome).toBe('CHECKED');
    expect(out.accounts[0]?.result?.rows.find((x) => x.invoiceId === 'EPH1')?.status).toBe(
      'UNREADABLE',
    );
    // Its own issue, left open to take up with Delhivery (owner, 13 Sep 2026)…
    const own = raised(s.issues).find(
      (i) => i['dedupeKey'] === 'delhivery-invoice-file:acct-d:EPH1',
    );
    expect(own).toMatchObject({ kind: 'MONEY', severity: 'MEDIUM' });
    expect(String(own?.['title'])).toMatch(/EPH1 .*2026-08-31.*will not download/);
    expect(String(own?.['detail'])).toMatch(/"Transaction list" for EPH1 produced no file/);
    expect(String(own?.['detail'])).toMatch(/closes by itself/);
    // …not folded into the run's own failure issue, which a clean run clears.
    expect(raised(s.issues).map((i) => i['dedupeKey'])).not.toContain(
      'delhivery-invoice-check:acct-d',
    );
    expect(resolvedKeys(s.issues)).toContain('delhivery-invoice-check:acct-d');
    // The other invoice was read, so its file issue (if any) is cleared.
    expect(resolvedKeys(s.issues)).toContain('delhivery-invoice-file:acct-d:EPVAS1');
  });

  it('a read that fails says so, still closes the page, and records a failed run', async () => {
    const s = makeSut({ read: new Error('the Delhivery session did not hold') });
    const out = await s.svc.check('SCHEDULE', NOW);
    expect(out.accounts[0]?.outcome).toBe('FAILED');
    expect(raised(s.issues)).toEqual([
      expect.objectContaining({
        dedupeKey: 'delhivery-invoice-check:acct-d',
        kind: 'COURIER_COST_SYNC',
        severity: 'MEDIUM',
      }),
    ]);
    expect(s.page.close).toHaveBeenCalled();
    expect(s.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'courier.delhivery_invoices.check_failed' }),
    );
  });

  it('no invoice table at all is a failed night, not an empty one', async () => {
    const s = makeSut({ read: { ...emptyRead(), found: false, invoices: [] } });
    const out = await s.svc.check('SCHEDULE', NOW);
    expect(out.accounts[0]?.outcome).toBe('FAILED');
  });
});
