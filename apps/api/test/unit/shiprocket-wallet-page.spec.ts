import type { Page } from 'playwright';
import {
  SR_WALLET_HEADERS,
  ShiprocketWalletPage,
  ShiprocketWalletPageError,
} from '../../src/modules/courier-portal/pages/shiprocket-wallet.page';

/**
 * How the reader pages through Shiprocket's wallet tabs, against a fake of
 * their page that behaves the way theirs does (measured 2026-09-11):
 * "Next" greys out on the passbook's last page but NOT on Recharge
 * History's, where pressing it draws an empty table; a table can be caught
 * mid-draw; and their login page can appear at any point.
 *
 * The first production run failed on exactly the Recharge History case —
 * refusing, correctly, to guess — which is why this exists.
 */
type Row = string[];

interface FakeOptions {
  /** The pages their server holds, in order. */
  pages: Row[][];
  /** Their Next greys out on the last page (passbook) or does not (recharges). */
  nextGreysOut: boolean;
  headers?: readonly string[];
  /** How many reads of each page come back empty before it draws. */
  slowDraws?: number;
  loginAfterPage?: number;
}

function fakePage(o: FakeOptions): { page: Page; clicks: () => number } {
  let current = 0;
  let clicks = 0;
  let reads = 0;
  let url = 'https://app.shiprocket.in/seller/wallet-transactions/recharge-history';
  const pageRows = (): Row[] => {
    if (reads < (o.slowDraws ?? 0)) {
      reads += 1;
      return [];
    }
    return o.pages[current] ?? [];
  };
  const onLastOrPast = (): boolean => current >= o.pages.length - 1;
  const locator = (sel: string) => {
    const api = {
      first: () => api,
      waitFor: async () => undefined,
      click: async () => {
        if (sel.includes('next-btn')) {
          clicks += 1;
          current += 1;
          reads = 0;
          if (o.loginAfterPage !== undefined && current >= o.loginAfterPage) {
            url = 'https://app.shiprocket.in/newlogin';
          }
        }
      },
      getAttribute: async () => {
        if (!sel.includes('next-btn')) return null;
        return o.nextGreysOut && onLastOrPast()
          ? 'next-btn pagination-btn btndisable'
          : 'next-btn pagination-btn';
      },
      innerText: async () => 'Current Usable Balance ₹ 1,646.63',
    };
    return api;
  };
  const page = {
    goto: async () => null,
    waitForLoadState: async () => undefined,
    waitForTimeout: async () => undefined,
    url: () => url,
    locator,
    $$eval: async (sel: string) =>
      sel.includes('thead')
        ? [...(o.headers ?? SR_WALLET_HEADERS['recharge-history'])]
        : pageRows(),
  };
  return { page: page as unknown as Page, clicks: () => clicks };
}

const recharge = (i: number): Row => [
  '03 Sep, 2026',
  `85624178842${String(i).padStart(4, '0')}`,
  '₹ 5000.00',
  'Success',
  'UPI',
  `Bank ReferenceNo: pay_${i}`,
];
const rowsOf = (n: number, from = 0): Row[] =>
  Array.from({ length: n }, (_, i) => recharge(from + i));

describe('ShiprocketWalletPage.readTab — paging their way', () => {
  it('reads Recharge History, whose Next stays enabled on its short last page', async () => {
    // 27 rows at 100 a page, Next still enabled, and the page after it empty.
    const f = fakePage({ pages: [rowsOf(27)], nextGreysOut: false });
    const rows = await new ShiprocketWalletPage(f.page).readTab('recharge-history', 'a', 'b');
    expect(rows).toHaveLength(27);
    expect(f.clicks()).toBe(1); // it PROVED the end by pressing Next once
  });

  it('reads a tab whose Next greys out on the last page, without pressing it', async () => {
    const f = fakePage({
      pages: [rowsOf(100), rowsOf(100, 100), rowsOf(38, 200)],
      nextGreysOut: true,
    });
    const rows = await new ShiprocketWalletPage(f.page).readTab('recharge-history', 'a', 'b');
    expect(rows).toHaveLength(238);
    expect(f.clicks()).toBe(2);
  });

  it('reads an exact multiple of a page, ending on the empty page after it', async () => {
    const f = fakePage({ pages: [rowsOf(100), rowsOf(100, 100)], nextGreysOut: false });
    const rows = await new ShiprocketWalletPage(f.page).readTab('recharge-history', 'a', 'b');
    expect(rows).toHaveLength(200);
  });

  it('REFUSES a short page when a real page follows it', async () => {
    // A page cut short mid-read, with more after it: importing that would
    // be importing a short ledger.
    const f = fakePage({ pages: [rowsOf(40), rowsOf(100, 40)], nextGreysOut: false });
    await expect(
      new ShiprocketWalletPage(f.page).readTab('recharge-history', 'a', 'b'),
    ).rejects.toThrow(/refusing a partial read/);
  });

  it('waits out a table that is slow to draw rather than taking it as empty', async () => {
    // Three empty reads, then the rows: an empty table is believed only
    // when it STAYS empty, or the oldest movements would be cut off.
    const f = fakePage({ pages: [rowsOf(27)], nextGreysOut: false, slowDraws: 3 });
    const rows = await new ShiprocketWalletPage(f.page).readTab('recharge-history', 'a', 'b');
    expect(rows).toHaveLength(27);
  });

  it('an empty window is an empty answer', async () => {
    const f = fakePage({ pages: [[]], nextGreysOut: true });
    await expect(
      new ShiprocketWalletPage(f.page).readTab('recharge-history', 'a', 'b'),
    ).resolves.toEqual([]);
  });

  it('refuses a page whose columns moved', async () => {
    const f = fakePage({
      pages: [rowsOf(3)],
      nextGreysOut: true,
      headers: [
        'Transaction Date',
        'Amount (₹)',
        'Transaction ID',
        'Status',
        'Payment Mode',
        'Description',
      ],
    });
    await expect(
      new ShiprocketWalletPage(f.page).readTab('recharge-history', 'a', 'b'),
    ).rejects.toBeInstanceOf(ShiprocketWalletPageError);
  });

  it('refuses a read that lands on their login page mid-way', async () => {
    const f = fakePage({
      pages: [rowsOf(100), rowsOf(100, 100)],
      nextGreysOut: false,
      loginAfterPage: 1,
    });
    await expect(
      new ShiprocketWalletPage(f.page).readTab('recharge-history', 'a', 'b'),
    ).rejects.toThrow(/session has expired/);
  });
});
