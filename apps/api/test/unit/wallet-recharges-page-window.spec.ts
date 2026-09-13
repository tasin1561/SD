import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WalletRechargesPage } from '../../src/modules/courier-portal/pages/wallet-recharges.page';

/**
 * The balance line's "Total Debit" is for the window their Finances page
 * has SELECTED, and it is compared against the wallet export — which is
 * taken over "Last 90 Days" (COST-1). Read on the page default instead,
 * production raised HIGH nightly: ₹1,07,303.22 stated against a ninety-day
 * export summing to ₹12,28,010.68 (13 Sep 2026).
 *
 * Faked at the Playwright-page boundary: the case is about WHEN the text
 * is read relative to the preset, not about Chromium.
 */
function fakePage(opts: { picker: boolean; preset: boolean }) {
  const state = { selected: false, committed: false, escapes: 0 };
  const DEFAULT_TEXT =
    'Current Balance ₹ 4,206.79 Total Credit ₹ 60,086.54 Total Debit ₹ 1,07,303.22';
  const NINETY_TEXT =
    'Current Balance ₹ 4,206.79 Total Credit ₹ 9,10,000.00 Total Debit ₹ 12,28,010.68';

  const locatorFor = (visible: boolean, onClick: () => void) => ({
    first: () => ({
      waitFor: async () => {
        if (!visible) throw new Error('not visible');
      },
      click: async () => onClick(),
    }),
  });

  const page = {
    goto: async () => undefined,
    url: () => 'https://one.delhivery.com/finances/unified/transactions',
    waitForLoadState: async () => undefined,
    waitForTimeout: async () => undefined,
    keyboard: {
      press: async () => {
        state.escapes += 1;
      },
    },
    locator: (sel: string) => ({
      waitFor: async () => undefined,
      innerText: async () => {
        if (sel !== 'body') return '';
        return state.committed ? NINETY_TEXT : DEFAULT_TEXT;
      },
    }),
    getByText: (re: RegExp) => {
      if (re.test('Date Range')) return locatorFor(opts.picker, () => undefined);
      if (re.test('Last 90 Days'))
        return locatorFor(opts.preset, () => {
          state.selected = true;
        });
      return locatorFor(false, () => undefined);
    },
    getByRole: () =>
      locatorFor(true, () => {
        // Done commits whatever was selected.
        if (state.selected) state.committed = true;
      }),
  };
  return { page, state };
}

describe('WalletRechargesPage.readBalance reads the totals over the export’s window', () => {
  it('selects "Last 90 Days" BEFORE reading, and says so', async () => {
    const { page } = fakePage({ picker: true, preset: true });
    const balance = await new WalletRechargesPage(page as never).readBalance();
    expect(balance).toEqual({
      balanceInr: '4206.79',
      totalCreditInr: '910000.00',
      totalDebitInr: '1228010.68',
      totalsWindow: 'LAST_90_DAYS',
    });
  });

  it('with no picker it reads the page default — and SAYS it is the default', async () => {
    const { page } = fakePage({ picker: false, preset: false });
    const balance = await new WalletRechargesPage(page as never).readBalance();
    expect(balance?.totalDebitInr).toBe('107303.22');
    expect(balance?.totalsWindow).toBe('PAGE_DEFAULT');
  });

  it('a picker without the preset is closed again and read as the default', async () => {
    const { page, state } = fakePage({ picker: true, preset: false });
    const balance = await new WalletRechargesPage(page as never).readBalance();
    expect(balance?.totalsWindow).toBe('PAGE_DEFAULT');
    expect(state.escapes).toBe(1);
  });
});

describe('both readers of the Finances page choose the range through ONE helper', () => {
  // The two readings drifted apart once (the export moved to ninety days,
  // the balance read did not). One implementation is what keeps them the
  // same window; a second copy of the clicks is how they drift again.
  const read = (f: string): string =>
    readFileSync(join(__dirname, '../../src/modules/courier-portal/pages', f), 'utf8');

  it.each(['wallet-ledger.page.ts', 'wallet-recharges.page.ts'])(
    '%s calls applyLast90DaysPreset and restates no preset of its own',
    (file) => {
      const src = read(file);
      expect(src).toMatch(/applyLast90DaysPreset\(this\.page\)/);
      expect(src).not.toMatch(/last 90 days\$\/i/);
    },
  );
});
