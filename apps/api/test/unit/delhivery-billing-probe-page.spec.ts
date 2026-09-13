import { Readable } from 'node:stream';
import type { Page } from 'playwright';
import {
  DelhiveryBillingPage,
  INVOICE_LIST_PATH,
  menuItemsOnly,
  type BillingDom,
  type Control,
  type RawTable,
} from '../../src/modules/courier-portal/pages/delhivery-billing.page';
import {
  classifyListRows,
  latestPerServiceType,
  parseListRows,
} from '../../src/modules/courier-portal/services/delhivery-billing-probe-files';
import * as guard from '../../src/modules/courier-portal/services/portal-read-only-guard';
import { DLV_ITEMIZED_OPTION } from '../../src/modules/courier-portal/services/delhivery-invoice-rows';

/**
 * The billing probe against a fake of Delhivery ONE's invoice list, shaped
 * on what the first production run (12 Sep 2026) saw: skeleton rows while
 * the list loads, a "Date Range" picker whose "Last 90 Days" can fail to
 * draw, a "Download ⌄" MENU per row, and Credit / Debit Notes tabs.
 */

const GST = '19ANKPR2167C1ZU';
const INV_HEADERS = ['INVOICE ID', 'INVOICE DATE', 'GST NUMBER', 'SERVICE TYPE', 'INVOICE AMOUNT'];
const DEFAULT_ROWS = [
  ['EPVASH26125294', '15 Aug, 2026', GST, 'Communication VAS', '₹7,295.94', 'Download'],
  ['EPH26251703', '15 Aug, 2026', GST, 'Domestic', '₹1,28,909.20', 'Download'],
  ['EPVASH26140201', '31 Aug, 2026', GST, 'Communication VAS', '₹6,934.28', 'Download'],
  ['EPH26281228', '31 Aug, 2026', GST, 'Domestic', '₹1,35,494.28', 'Download'],
];
const OLDER_ROWS = [
  ['EPH26221000', '31 Jul, 2026', GST, 'Domestic', '₹1,10,000.00', 'Download'],
  ['EPVASH26110000', '31 Jul, 2026', GST, 'Communication VAS', '₹5,000.00', 'Download'],
];
const NOTE_HEADERS = ['CREDIT NOTE ID', 'CREDIT NOTE DATE', 'INVOICE ID', 'AMOUNT', ''];
const SKELETON: string[][] = Array.from({ length: 20 }, () => ['', '', '', '', '']);
const KNOWN_URL = `https://one.delhivery.com${INVOICE_LIST_PATH}`;

describe('reading their list', () => {
  it('skeleton rows are not data; a lone "no data" row is an empty list', () => {
    expect(classifyListRows(INV_HEADERS, SKELETON)).toEqual({
      real: [],
      skeleton: 20,
      emptyMessage: false,
    });
    expect(parseListRows(INV_HEADERS, SKELETON)).toEqual([]);
    expect(classifyListRows(INV_HEADERS, [['No data found', '', '', '', '']]).emptyMessage).toBe(
      true,
    );
  });

  it('parses id, date, GST number, service type and the amount in rupees', () => {
    const rows = parseListRows([...INV_HEADERS, ''], DEFAULT_ROWS);
    expect(rows[1]).toEqual(
      expect.objectContaining({
        key: 'EPH26251703',
        invoiceId: 'EPH26251703',
        date: '2026-08-15',
        gstNumber: GST,
        serviceType: 'Domestic',
        amountInr: '128909.20',
      }),
    );
  });

  it('picks the latest invoice of each service type', () => {
    const picks = latestPerServiceType(parseListRows([...INV_HEADERS, ''], DEFAULT_ROWS));
    expect(picks.map((p) => p.key).sort()).toEqual(['EPH26281228', 'EPVASH26140201']);
  });
});

// ── The fake portal ─────────────────────────────────────────────────────

interface El {
  readonly label: string;
  readonly text?: string;
  readonly tag: string;
  readonly onClick: () => void;
}

interface Opts {
  readonly loadingPolls?: number;
  readonly ninetyNeverDraws?: boolean;
  readonly knownHasNoTable?: boolean;
  readonly options?: readonly string[];
  readonly creditRows?: readonly string[][];
  readonly debitRows?: readonly string[][];
  /**
   * `byText` behaves as the first production run found the page: it hits
   * the FIRST matching option on the page, which belongs to another row.
   */
  readonly byTextHitsFirstRow?: boolean;
}

function fakePortal(o: Opts = {}) {
  const s = {
    path: '',
    range: 'default' as 'default' | '90',
    tab: 'invoices' as 'invoices' | 'credit' | 'debit',
    loading: 0,
    pickerOpen: false,
    menuFor: null as string | null,
    menuSeen: false,
  };
  const gotos: string[] = [];
  const clicks: string[] = [];
  const writes: string[] = [];
  const reg = new Map<string, El>();
  let seq = 0;
  let listeners: ((d: unknown) => void)[] = [];
  const options = o.options ?? ['Invoice PDF', 'Annexure', 'Raise dispute'];

  const register = (el: El): Control => {
    seq += 1;
    const id = `p${seq}`;
    reg.set(id, el);
    return { id, label: el.label, text: el.text ?? el.label, href: null, tag: el.tag };
  };
  const onList = (): boolean => s.path === INVOICE_LIST_PATH && o.knownHasNoTable !== true;
  const drawn = (): { headers: string[]; rows: readonly string[][] } => {
    if (s.tab === 'credit') return { headers: NOTE_HEADERS, rows: o.creditRows ?? [] };
    if (s.tab === 'debit') return { headers: NOTE_HEADERS, rows: o.debitRows ?? [] };
    if (s.range === '90' && o.ninetyNeverDraws === true)
      return { headers: INV_HEADERS, rows: SKELETON };
    return {
      headers: [...INV_HEADERS, ''],
      rows: s.range === '90' ? [...OLDER_ROWS, ...DEFAULT_ROWS] : DEFAULT_ROWS,
    };
  };
  const table = (headers: string[], rows: readonly string[][]): RawTable => ({
    headers,
    rowCount: rows.length,
    rows: rows.map((cells) => ({ cells: [...cells], controls: [] })),
  });
  const emit = (name: string): void => {
    const d = {
      createReadStream: async () => Readable.from([Buffer.from(`AWB,Freight Charge\n1,10.00\n`)]),
      suggestedFilename: () => name,
      url: () => '',
    };
    const ls = listeners;
    listeners = [];
    for (const l of ls) l(d);
  };
  const statics = (): El[] => [
    {
      label:
        s.range === '90' ? 'Date Range : Last 90 Days' : 'Date Range : 13 Aug 2026 to 12 Sept 2026',
      tag: 'button',
      onClick: () => {
        s.pickerOpen = true;
      },
    },
    ...(s.pickerOpen
      ? [
          {
            label: 'Last 90 Days',
            tag: 'li',
            onClick: () => {
              s.range = '90';
              s.pickerOpen = false;
              s.loading = 2;
            },
          },
        ]
      : []),
    ...(['Invoice List', 'Credit Notes', 'Debit Notes'] as const).map((label) => ({
      label,
      tag: 'div',
      onClick: () => {
        s.tab =
          label === 'Credit Notes' ? 'credit' : label === 'Debit Notes' ? 'debit' : 'invoices';
        s.loading = 1;
      },
    })),
  ];
  const optionEl = (t: string): El => ({
    label: t,
    text: t,
    tag: 'li',
    onClick: () => {
      const forKey = s.menuFor ?? '?';
      s.menuFor = null;
      if (guard.WRITE_LOOKING.test(t)) writes.push(t);
      else emit(`${forKey}-${t.replace(/\s+/g, '_')}.${/pdf/i.test(t) ? 'pdf' : 'csv'}`);
    },
  });

  const dom: BillingDom = {
    snapshot: async () => ({ title: 'Invoices', headings: [], links: [], menu: [], buttons: [] }),
    tables: async () => {
      if (!onList()) return [];
      if (s.loading > 0) {
        s.loading -= 1;
        return [table(INV_HEADERS, SKELETON)];
      }
      const d = drawn();
      return [table(d.headers, d.rows)];
    },
    bodyText: async () => 'Showing 1 - 4 of 4',
    tagOne: async (_sel, rx) => {
      const r = new RegExp(rx.source, 'i');
      const hit = statics()
        .filter((e) => r.test(e.label))
        .sort((a, b) => a.label.length - b.label.length)[0];
      return hit === undefined ? null : register(hit);
    },
    tagAll: async () => [],
    candidate: async (id) => {
      const el = reg.get(id);
      return el === undefined ? null : { label: el.label, tag: el.tag, type: '', inForm: false };
    },
    rowTrigger: async (key) => {
      if (!onList() || s.loading > 0 || !drawn().rows.some((r) => r[0] === key)) return null;
      return register({
        label: 'Download fal fa-download fal fa-angle-down',
        tag: 'div',
        onClick: () => {
          s.menuFor = s.menuFor === key ? null : key;
        },
      });
    },
    markSeen: async () => {
      s.menuSeen = s.menuFor !== null;
    },
    newlyVisible: async () =>
      s.menuFor !== null && !s.menuSeen ? options.map((t) => register(optionEl(t))) : [],
    byText: async (text) => {
      if (s.menuFor === null || !options.includes(text)) return null;
      if (o.byTextHitsFirstRow !== true) return register(optionEl(text));
      const first = drawn().rows[0]?.[0] ?? '?';
      return register({
        ...optionEl(text),
        onClick: () => {
          s.menuFor = null;
          emit(`${first}-${text.replace(/\s+/g, '_')}.csv`);
        },
      });
    },
    menuOption: async (key, text) =>
      s.menuFor === key && options.includes(text) ? register(optionEl(text)) : null,
  };

  const page = {
    setDefaultTimeout: () => undefined,
    goto: async (url: string) => {
      gotos.push(url);
      s.path = new URL(url).pathname;
      s.tab = 'invoices';
      s.range = 'default';
      s.loading = o.loadingPolls ?? 0;
      s.menuFor = null;
      return null;
    },
    waitForLoadState: async () => undefined,
    waitForTimeout: async () => undefined,
    url: () => `https://one.delhivery.com${s.path}`,
    screenshot: async () => Buffer.from('png'),
    keyboard: {
      press: async () => {
        s.menuFor = null;
        s.pickerOpen = false;
      },
    },
    locator: (sel: string) => ({
      first: () => ({
        click: async () => {
          const id = /data-sd-probe="([^"]+)"/.exec(sel)?.[1] ?? '';
          const el = reg.get(id);
          if (el === undefined) throw new Error(`no element ${id}`);
          clicks.push(el.label);
          el.onClick();
        },
      }),
    }),
    waitForEvent: (name: string) =>
      new Promise((resolve, reject) => {
        if (name !== 'download') return reject(new Error('unexpected event'));
        const t = setTimeout(() => reject(new Error('timeout')), 20);
        listeners.push((d) => {
          clearTimeout(t);
          resolve(d);
        });
      }),
    context: () => ({
      waitForEvent: () => new Promise((_r, reject) => setTimeout(() => reject(new Error('t')), 20)),
      request: {
        get: async () => {
          throw new Error('no plain GET expected');
        },
      },
    }),
  };

  const make = () =>
    new DelhiveryBillingPage(
      page as unknown as Page,
      new guard.ProbeBudget({ maxPages: 14, maxDownloads: 12 }, Date.now() + 60_000),
      dom,
    );
  const explore = () => make().explore();
  const readForCheck = (option: RegExp) =>
    make().readForInvoiceCheck({ wanted: () => true, option });
  return { explore, readForCheck, gotos, clicks, writes };
}

describe('menuItemsOnly', () => {
  it('drops the box whose text is two of its items run together', () => {
    expect(menuItemsOnly(['Invoice Transaction list', 'Invoice', 'Transaction list'])).toEqual([
      'Invoice',
      'Transaction list',
    ]);
  });

  it('keeps a menu with no box, and an item that merely contains one other', () => {
    expect(menuItemsOnly(['Invoice PDF', 'Annexure', 'Raise dispute'])).toEqual([
      'Invoice PDF',
      'Annexure',
      'Raise dispute',
    ]);
    expect(menuItemsOnly(['Invoice', 'Invoice PDF'])).toEqual(['Invoice', 'Invoice PDF']);
  });
});

describe('DelhiveryBillingPage', () => {
  afterEach(() => jest.restoreAllMocks());

  it('goes to the known invoice url first, and reads rows only once they have drawn', async () => {
    const f = fakePortal({ loadingPolls: 4 });
    const r = await f.explore();

    expect(f.gotos[0]).toBe(KNOWN_URL);
    const list = r.invoiceList;
    expect(list?.loaded).toBe('rows');
    expect(list?.range).toEqual(
      expect.objectContaining({
        applied: true,
        fellBack: false,
        label: 'Date Range : Last 90 Days',
      }),
    );
    // Skeletons were on screen, and none of them became a row.
    expect(r.pages.some((p) => p.finding.tables[0]?.sampleRows[0]?.every((c) => c === ''))).toBe(
      true,
    );
    expect(list?.rows.every((cells) => cells.some((c) => c !== ''))).toBe(true);
    expect(list?.parsedRows.map((p) => p.invoiceId)).toEqual([
      ...OLDER_ROWS.map((row) => row[0]),
      ...DEFAULT_ROWS.map((row) => row[0]),
    ]);
    expect(list?.parsedRows.find((p) => p.invoiceId === 'EPH26251703')?.amountInr).toBe(
      '128909.20',
    );
  });

  it('falls back to the default range when "Last 90 days" never draws, and says so', async () => {
    const f = fakePortal({ ninetyNeverDraws: true });
    const r = await f.explore();

    expect(r.invoiceList?.range).toEqual(
      expect.objectContaining({ applied: false, fellBack: true, ninetyDayState: 'timeout' }),
    );
    expect(r.invoiceList?.rangeApplied).toBe(false);
    expect(r.invoiceList?.parsedRows.map((p) => p.invoiceId)).toEqual(
      DEFAULT_ROWS.map((row) => row[0]),
    );
    expect(f.gotos).toEqual([KNOWN_URL, KNOWN_URL]);
  });

  it('records each row menu, clicks every option through judgeClick, and never a write', async () => {
    const judge = jest.spyOn(guard, 'judgeClick');
    const f = fakePortal();
    const r = await f.explore();

    const menus = r.downloadMenus.filter((m) => m.list === 'invoices');
    expect(menus.map((m) => m.invoiceId).sort()).toEqual(['EPH26281228', 'EPVASH26140201']);
    for (const m of menus) expect(m.options).toEqual(['Invoice PDF', 'Annexure', 'Raise dispute']);

    // The write-looking option is refused by name and never clicked.
    expect(f.writes).toEqual([]);
    expect(f.clicks.some((c) => /raise/i.test(c))).toBe(false);
    expect(r.refused).toEqual(
      expect.arrayContaining([{ label: 'Raise dispute', reason: expect.any(String) }]),
    );
    // Every click the page made was judged on that element's own label first.
    const judged = judge.mock.calls.map((c) => c[0].label);
    for (const label of f.clicks) expect(judged).toContain(label);

    const files = r.downloads.filter((d) => d.list === 'invoices');
    expect(files.map((d) => `${d.forInvoice}/${d.option}`).sort()).toEqual([
      'EPH26281228/Annexure',
      'EPH26281228/Invoice PDF',
      'EPVASH26140201/Annexure',
      'EPVASH26140201/Invoice PDF',
    ]);
  });

  it('reads the Credit Notes and Debit Notes tabs', async () => {
    const f = fakePortal({
      creditRows: [['CN2600001', '05 Sep, 2026', 'EPH26281228', '₹1,200.00', 'Download']],
      debitRows: [],
    });
    const r = await f.explore();

    expect(r.creditNotes).toEqual(
      expect.objectContaining({
        loaded: 'rows',
        headers: NOTE_HEADERS,
        latest: 'CN2600001',
        rows: [['CN2600001', '05 Sep, 2026', 'EPH26281228', '₹1,200.00', 'Download']],
      }),
    );
    expect(r.creditNotes?.parsedRows[0]?.amountInr).toBe('1200.00');
    expect(r.debitNotes).toEqual(expect.objectContaining({ loaded: 'empty', rows: [] }));
    expect(
      r.downloadMenus.some((m) => m.list === 'creditNotes' && m.invoiceId === 'CN2600001'),
    ).toBe(true);
    expect(
      r.downloads
        .filter((d) => d.list === 'creditNotes')
        .map((d) => d.option)
        .sort(),
    ).toEqual(['Annexure', 'Invoice PDF']);
  });

  it('clicks an option in THAT row’s menu, never the first match on the page', async () => {
    // The first production run asked for credit note CD1737653806876's PDF
    // and got CD1737653801365's: the option was found page-wide.
    const f = fakePortal({ byTextHitsFirstRow: true });
    const r = await f.explore();
    const files = r.downloads.filter((d) => d.forInvoice !== null);
    expect(files.length).toBeGreaterThan(0);
    for (const d of files) expect(d.fileName.startsWith(`${d.forInvoice ?? ''}-`)).toBe(true);
  });

  it('reads what the nightly invoice check needs: every wanted invoice’s file by option, and the notes lists', async () => {
    const judge = jest.spyOn(guard, 'judgeClick');
    const f = fakePortal({
      creditRows: [['CN2600001', '05 Sep, 2026', 'EPH26281228', '-₹1,200.00', 'Download']],
      debitRows: [],
    });
    const r = await f.readForCheck(/^annexure$/i);

    expect(r.found).toBe(true);
    expect(r.error).toBeNull();
    expect(r.invoices.map((i) => i.invoiceId)).toEqual([
      ...OLDER_ROWS.map((row) => row[0]),
      ...DEFAULT_ROWS.map((row) => row[0]),
    ]);
    for (const id of DEFAULT_ROWS.map((row) => row[0] ?? '')) {
      const file = r.files.get(id);
      expect(Buffer.isBuffer(file)).toBe(true);
    }
    // Only the option asked for: no PDF, and never the write-looking one.
    expect(f.clicks.some((c) => /invoice pdf|raise/i.test(c))).toBe(false);
    expect(f.writes).toEqual([]);
    for (const label of f.clicks) expect(judge.mock.calls.map((c) => c[0].label)).toContain(label);
    // Notes are listed, not downloaded.
    expect(r.creditNotes?.parsedRows[0]?.amountInr).toBe('-1200.00');
    expect(r.debitNotes?.loaded).toBe('empty');
  });

  it('an invoice whose menu offers no such option is null, not an error', async () => {
    const f = fakePortal();
    const r = await f.readForCheck(/^invoice transaction list$/i);
    expect(r.files.get('EPH26281228')).toBeNull();
  });

  it('clicks the "Transaction list" item, never the box that holds the menu', async () => {
    // Production, 13 Sep 2026: their menu reads "Invoice" and "Transaction
    // list", and the box around them read "Invoice Transaction list". The
    // check asked for the box, so the click landed wherever its middle was —
    // the CSV on 31 Aug, nothing on 15 Aug.
    const f = fakePortal({ options: ['Invoice Transaction list', 'Invoice', 'Transaction list'] });
    const r = await f.readForCheck(DLV_ITEMIZED_OPTION);
    expect(Buffer.isBuffer(r.files.get('EPH26281228'))).toBe(true);
    expect(f.clicks).toContain('Transaction list');
    expect(f.clicks).not.toContain('Invoice Transaction list');
    expect(f.clicks).not.toContain('Invoice');
  });

  it('falls back to discovery when the known url shows no invoice table', async () => {
    const f = fakePortal({ knownHasNoTable: true });
    const r = await f.explore();
    expect(f.gotos[0]).toBe(KNOWN_URL);
    expect(f.gotos[1]).toBe('https://one.delhivery.com/finances/unified/transactions');
    expect(r.invoiceList).toBeNull();
    expect(r.notFound.join(' ')).toMatch(/No table with an "invoice" column/);
  });
});
