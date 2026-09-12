import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { SpacesService } from '../../src/infrastructure/spaces/spaces.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { RawExploration } from '../../src/modules/courier-portal/pages/delhivery-billing.page';
import {
  latestDateIn,
  pickInvoiceRows,
  redactUrl,
  scrubSessionMaterial,
  summariseFile,
} from '../../src/modules/courier-portal/services/delhivery-billing-probe-files';
import {
  ACTION_DELHIVERY_BILLING_PROBED,
  DelhiveryBillingProbeService,
} from '../../src/modules/courier-portal/services/delhivery-billing-probe.service';
import type { PortalSessionService } from '../../src/modules/courier-portal/services/portal-session.service';

const RUN_ID = '0199a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl';

describe('describing a downloaded billing file', () => {
  it('finds the header under a title row, samples rows, sums money columns and keeps total rows', () => {
    const csv = [
      'Invoice Annexure - August 2026',
      'AWB,Order Date,Freight Charge,GST',
      '1234567890123,01-08-2026,100.50,18.09',
      '1234567890124,02-08-2026,"1,200.00",216.00',
      'Total,,"1,300.50",234.09',
    ].join('\n');
    const s = summariseFile('annexure.csv', Buffer.from(csv));
    expect(s.kind).toBe('csv');
    const sheet = s.sheets?.[0];
    expect(sheet?.headerRowIndex).toBe(1);
    expect(sheet?.header).toEqual(['AWB', 'Order Date', 'Freight Charge', 'GST']);
    expect(sheet?.dataRowCount).toBe(2);
    expect(sheet?.firstRows[1]).toEqual(['1234567890124', '02-08-2026', '1,200.00', '216.00']);
    expect(sheet?.columnSums).toEqual([
      { column: 'Freight Charge', sumInr: '1300.50', numericCells: 2 },
      { column: 'GST', sumInr: '234.09', numericCells: 2 },
    ]);
    expect(sheet?.totalRows).toEqual([['Total', '', '1,300.50', '234.09']]);
    expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('names a PDF, an HTML page and bytes it cannot read, instead of throwing', () => {
    expect(
      summariseFile('i.pdf', Buffer.from('%PDF-1.4\n/Type /Page\n/Type /Page\n')).pdfPages,
    ).toBe(2);
    expect(summariseFile('x', Buffer.from('<!doctype html><html></html>')).kind).toBe('html');
    expect(summariseFile('x.bin', Buffer.from([0, 1, 2, 3])).kind).toBe('unknown');
  });
});

describe('choosing which invoices to download', () => {
  it('reads dates in the forms India writes them', () => {
    expect(latestDateIn('12 Sep 2026')).toBe(Date.UTC(2026, 8, 12));
    expect(latestDateIn('12/09/2026')).toBe(Date.UTC(2026, 8, 12));
    expect(latestDateIn('2026-09-12')).toBe(Date.UTC(2026, 8, 12));
    expect(latestDateIn('01 Aug 2026 - 31 Aug 2026')).toBe(Date.UTC(2026, 7, 31));
    expect(latestDateIn('Aug 2026')).toBe(Date.UTC(2026, 7, 31));
    expect(latestDateIn('1,234.00')).toBeNull();
  });

  it('takes the most recent, then the most recent of a different type', () => {
    const headers = ['Invoice No', 'Invoice Type', 'Invoice Date', 'Total'];
    const rows = [
      ['INV-1', 'Freight', '01 Jul 2026', '100'],
      ['INV-3', 'Freight', '01 Sep 2026', '300'],
      ['INV-2', 'COD', '15 Aug 2026', '200'],
    ];
    const picks = pickInvoiceRows(headers, rows);
    expect(picks.map((p) => p.rowIndex)).toEqual([1, 2]);
  });

  it('falls back to the first row when no date can be read', () => {
    expect(
      pickInvoiceRows(
        ['Invoice', 'Amount'],
        [
          ['A', '1'],
          ['B', '2'],
        ],
      )[0]?.rowIndex,
    ).toBe(0);
  });
});

describe('keeping session material out of what is stored', () => {
  it('drops query values and the fragment but keeps parameter names', () => {
    expect(redactUrl('https://x.s3.amazonaws.com/f.xlsx?X-Amz-Signature=abc&token=def#frag')).toBe(
      'https://x.s3.amazonaws.com/f.xlsx?X-Amz-Signature=…&token=…',
    );
  });

  it('scrubs cookies, tokens, JWTs and signed urls at any depth', () => {
    const out = scrubSessionMaterial({
      cookie: 'sid=secret-cookie',
      nested: [{ Authorization: 'Bearer x', text: `hello ${JWT}` }],
      link: 'see https://one.delhivery.com/f?session=secret-session ok',
      invoice: { number: 'INV-9', amount: '1,200.00' },
    });
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/secret-cookie|Bearer x|eyJ|secret-session/);
    expect(out.invoice).toEqual({ number: 'INV-9', amount: '1,200.00' });
  });
});

describe('DelhiveryBillingProbeService', () => {
  function build(opts: { challengeOpen?: boolean; exploration?: RawExploration } = {}) {
    const prisma = {
      client: {
        courierAccount: {
          findMany: jest.fn().mockResolvedValue([{ id: 'acc12345-0000', label: 'Main' }]),
        },
        systemIssue: {
          findFirst: jest.fn().mockResolvedValue(opts.challengeOpen === true ? { id: 'i1' } : null),
        },
      },
    } as unknown as PrismaService;
    const page = { close: jest.fn().mockResolvedValue(undefined) };
    const session = {
      page: jest.fn().mockResolvedValue(page),
    } as unknown as PortalSessionService;
    const putObject = jest.fn().mockResolvedValue(undefined);
    const spaces = { putObject } as unknown as SpacesService;
    const log = jest.fn().mockResolvedValue('audit-id');
    const audit = { log } as unknown as AuditLogService;
    const service = new DelhiveryBillingProbeService(prisma, session, spaces, audit);
    const explorer = jest.fn().mockResolvedValue(
      opts.exploration ?? {
        pages: [
          {
            finding: {
              why: 'start: the Finances page',
              url: `https://one.delhivery.com/finances?token=secret-token`,
              title: 'Finances',
              landedOnLogin: false,
              headings: ['Invoices'],
              menu: ['Transactions', 'Invoices'],
              buttons: ['Download'],
              links: [],
              tables: [],
            },
            screenshot: Buffer.from('png'),
            text: `Invoices ${JWT}`,
          },
        ],
        invoiceList: null,
        downloads: [
          {
            forRow: 0,
            control: 'Download',
            via: 'href',
            fileName: 'annexure.csv',
            contentType: 'text/csv',
            sourceUrl: 'https://x.s3.amazonaws.com/a.csv?X-Amz-Signature=secret-sig',
            body: Buffer.from('AWB,Freight Charge\n1,10.00\n'),
            bytes: 27,
          },
        ],
        attempts: [],
        refused: [{ label: 'Pay Now', reason: 'label reads as an action ("Pay")' }],
        notFound: [],
        stoppedBy: null,
        error: null,
      },
    );
    service.explorer = explorer;
    return { service, session, putObject, log, explorer, page };
  }

  it('signs in through the wallet sync session, stores files privately and findings without session material', async () => {
    const { service, session, putObject, log, page } = build();
    const findings = await service.probe({ runId: RUN_ID, requestedByStaffId: 'staff-1' });

    expect(session.page).toHaveBeenCalledWith('acc12345-0000');
    expect(page.close).toHaveBeenCalled();
    const keys = putObject.mock.calls.map((c) => c[0] as string);
    expect(keys.every((k) => k.startsWith(`courier-probes/delhivery-billing/${RUN_ID}/`))).toBe(
      true,
    );
    expect(keys.some((k) => k.endsWith('annexure.csv'))).toBe(true);
    // The page text is scrubbed before it is uploaded, not only in the audit row.
    const textUpload = putObject.mock.calls.find((c) => (c[0] as string).endsWith('.txt'));
    expect((textUpload?.[1] as Buffer).toString('utf8')).not.toContain('eyJ');

    expect(log).toHaveBeenCalledTimes(1);
    const entry = log.mock.calls[0]?.[0] as {
      action: string;
      entityId: unknown;
      metadata: unknown;
    };
    expect(entry.action).toBe(ACTION_DELHIVERY_BILLING_PROBED);
    expect(entry.entityId).toBeNull();
    const stored = JSON.stringify(entry.metadata);
    expect(stored).not.toMatch(/secret-token|secret-sig|eyJ/);
    expect(stored).toContain(RUN_ID);

    const acc = findings.accounts[0];
    expect(acc?.outcome).toBe('READ');
    expect(acc?.downloads[0]?.summary?.kind).toBe('csv');
    expect(acc?.refusedClicks).toEqual([{ label: 'Pay Now', reason: expect.any(String) }]);
  });

  it('opens nothing while a sign-in challenge is open', async () => {
    const { service, session, explorer, log } = build({ challengeOpen: true });
    const findings = await service.probe({ runId: RUN_ID });
    expect(session.page).not.toHaveBeenCalled();
    expect(explorer).not.toHaveBeenCalled();
    expect(findings.accounts[0]?.outcome).toBe('SKIPPED');
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('mints its own run id when the job carried none', async () => {
    const { service } = build();
    const findings = await service.probe({ runId: 'not a uuid' });
    expect(findings.runId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
