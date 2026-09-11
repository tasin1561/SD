import type { Page } from 'playwright';
import {
  ShiprocketInvoicesPage,
  ShiprocketInvoicesPageError,
} from '../../src/modules/courier-portal/pages/shiprocket-invoices.page';
import { SR_INVOICE_HEADERS } from '../../src/modules/courier-portal/services/shiprocket-invoice-rows';

/**
 * The Invoices page reader, against a fake of their page: a list that can
 * be caught mid-draw, a login bounce, a pager, and an invoice view in a new
 * tab whose "Download Now" link carries its own token.
 */
type Table = { headers: string[]; rows: string[][] } | null;

const ROWS = [
  ['SRV27HR000315314', 'VAS', '03 Sep, 2026', '10 Sep, 2026', '₹ 8516.36', 'Paid', 'View Invoice'],
  [
    'SRF27HR000404559',
    'Freight',
    '30 Aug, 2026',
    '06 Sep, 2026',
    '₹ 53491.74',
    'Paid',
    'View Invoice',
  ],
];
const HEADERS = [...SR_INVOICE_HEADERS];

function fake(o: {
  tables: Table[];
  login?: boolean;
  nextEnabled?: boolean;
  link?: string | null;
  status?: number;
}): { page: Page; requested: string[] } {
  let reads = 0;
  const requested: string[] = [];
  const view = {
    waitForLoadState: async () => undefined,
    url: () => 'https://srbs.shiprocket.in/invoice/9842446?token=t0k',
    locator: () => ({
      first: () => ({
        waitFor: async () => {
          if ((o.link ?? null) === null) throw new Error('timeout');
        },
        getAttribute: async () => o.link ?? null,
      }),
    }),
    context: () => ({
      request: {
        get: async (url: string) => {
          requested.push(url);
          const status = o.status ?? 200;
          return {
            ok: () => status === 200,
            status: () => status,
            body: async () => Buffer.from('AWB Code,Order ID\n'),
            headers: () => ({ 'content-type': 'text/csv' }),
          };
        },
      },
    }),
    close: async () => undefined,
  };
  const locator = (sel: string) => ({
    first: () => ({
      waitFor: async () => undefined,
      getAttribute: async () =>
        sel.includes('next-btn')
          ? o.nextEnabled === true
            ? 'next-btn pagination-btn'
            : null
          : null,
      count: async () => 1,
      getByText: () => ({ first: () => ({ click: async () => undefined }) }),
    }),
  });
  const page = {
    goto: async () => null,
    waitForLoadState: async () => undefined,
    waitForTimeout: async () => undefined,
    url: () =>
      o.login === true
        ? 'https://app.shiprocket.in/newlogin'
        : 'https://app.shiprocket.in/seller/bills/invoices',
    locator,
    $$eval: async () => {
      const t = o.tables[Math.min(reads, o.tables.length - 1)] ?? null;
      reads += 1;
      return t;
    },
    context: () => ({ waitForEvent: async () => view }),
  };
  return { page: page as unknown as Page, requested };
}

describe('ShiprocketInvoicesPage.list', () => {
  it('returns the list once two looks in a row agree', async () => {
    const f = fake({
      tables: [
        null, // not drawn yet
        { headers: HEADERS, rows: [['SRV27HR000315314', 'VAS', '', '', '', '', '']] }, // mid-draw
        { headers: HEADERS, rows: ROWS },
        { headers: HEADERS, rows: ROWS },
      ],
    });
    await expect(
      new ShiprocketInvoicesPage(f.page).list('2026-May-14', '2026-Sep-11'),
    ).resolves.toEqual(ROWS);
  });

  it('an empty window is an empty answer — once it stays empty', async () => {
    const f = fake({ tables: [{ headers: HEADERS, rows: [] }] });
    await expect(new ShiprocketInvoicesPage(f.page).list('a', 'b')).resolves.toEqual([]);
  });

  it('refuses a list whose columns moved', async () => {
    const f = fake({
      tables: [{ headers: ['Invoice Id', 'Invoice Date', 'Service type'], rows: ROWS }],
    });
    await expect(new ShiprocketInvoicesPage(f.page).list('a', 'b')).rejects.toBeInstanceOf(
      ShiprocketInvoicesPageError,
    );
  });

  it('refuses a read that landed on their login page', async () => {
    const f = fake({ tables: [{ headers: HEADERS, rows: ROWS }], login: true });
    await expect(new ShiprocketInvoicesPage(f.page).list('a', 'b')).rejects.toThrow(
      /session has expired/,
    );
  });

  it('refuses a list with a further page rather than reading it short', async () => {
    const f = fake({ tables: [{ headers: HEADERS, rows: ROWS }], nextEnabled: true });
    await expect(new ShiprocketInvoicesPage(f.page).list('a', 'b')).rejects.toThrow(
      /more than one page/,
    );
  });
});

describe('ShiprocketInvoicesPage.itemizedFile', () => {
  it('fetches the file their "Download Now" link points at, resolved against the view', async () => {
    const f = fake({ tables: [], link: '?is_download=true&view=1&token=abc' });
    const file = await new ShiprocketInvoicesPage(f.page).itemizedFile('SRF27HR000404559');
    expect(file?.contentType).toBe('text/csv');
    expect(f.requested).toEqual([
      'https://srbs.shiprocket.in/invoice/9842446?is_download=true&view=1&token=abc',
    ]);
  });

  it('an invoice view with no itemized link is null, not an error', async () => {
    const f = fake({ tables: [], link: null });
    await expect(
      new ShiprocketInvoicesPage(f.page).itemizedFile('SRSI27HR00064789'),
    ).resolves.toBeNull();
  });

  it('a refused download is an error for that invoice', async () => {
    const f = fake({ tables: [], link: 'https://example-bucket/x.zip', status: 403 });
    await expect(
      new ShiprocketInvoicesPage(f.page).itemizedFile('SRV27HR000315314'),
    ).rejects.toThrow(/HTTP 403/);
  });
});
