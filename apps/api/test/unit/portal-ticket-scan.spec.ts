import { SupportTicketsPage } from '../../src/modules/courier-portal/pages/support-tickets.page';

/**
 * The scan, and the one reading of it that could do real damage.
 *
 * Closure is inferred from ABSENCE: a ticket of ours in neither Open nor
 * Resolved has been closed by Delhivery. That is what lets the sweep
 * skip their Closed tab, which grows without bound while the other two
 * are bounded by outstanding work.
 *
 * It inverts into a catastrophe on a partial read. An expired session
 * bounces to /v2/login and yields ZERO rows — observed on the real
 * portal, not imagined — and every ticket then looks absent. Acting on
 * that closes every seller's ticket in one sweep, silently, and each one
 * tells its seller the courier finished with them.
 *
 * So the scan reports whether it COMPLETED, and these pin the cases that
 * must set it false.
 */

interface FakePage {
  totals: (number | null)[];
  pages: string[][];
}

/** Enough of Playwright's locator surface to drive the scan. */
function fakePage(tabs: Record<string, FakePage>) {
  let tab = 'open';
  let pageIdx = 0;

  const cur = (): FakePage => tabs[tab] ?? { totals: [null], pages: [[]] };

  const locator = (sel: string): unknown => {
    if (sel.includes('ap-pagination__perpage')) {
      const total = cur().totals[pageIdx] ?? null;
      return {
        first: () => ({
          innerText: async () => (total === null ? '' : `Showing 1 - 30 of ${total}`),
        }),
      };
    }
    if (sel.includes('ap-pagination__next')) {
      const hasNext = pageIdx < cur().pages.length - 1;
      return {
        first: () => ({
          count: async () => 1,
          // Their next arrow carries the disabled class on the last page.
          getAttribute: async () =>
            hasNext ? 'ap-pagination__next' : 'ap-pagination__next ap-pagination__link--disabled',
          click: async () => {
            pageIdx += 1;
          },
        }),
      };
    }
    // The rows.
    const rows = cur().pages[pageIdx] ?? [];
    return {
      count: async () => rows.length,
      nth: (i: number) => ({ innerText: async () => rows[i] ?? '' }),
    };
  };

  return {
    goto: async (url: string) => {
      tab = url.includes('/resolved') ? 'resolved' : 'open';
      pageIdx = 0;
    },
    waitForLoadState: async () => undefined,
    waitForTimeout: async () => undefined,
    locator,
  };
}

const row = (id: string, awb: string, extra = 'Open') => `${id} ${awb} someone@x.com ${extra}`;

const scan = (p: unknown): SupportTicketsPage => new SupportTicketsPage(p as never);

describe('scanning the courier ticket list', () => {
  it('pages to the end of every tab and reports complete', async () => {
    const page = fakePage({
      open: {
        totals: [4, 4],
        pages: [
          [row('J111111111111', '38061110527796'), row('J222222222222', '38061110527797')],
          [row('J333333333333', '38061110527798'), row('J444444444444', '38061110527799')],
        ],
      },
      resolved: { totals: [0], pages: [[]] },
    });
    const res = await scan(page).listOpenAndResolved();
    expect(res.rows).toHaveLength(4);
    expect(res.complete).toBe(true);
  });

  it('is NOT complete when their stated total exceeds what was read', async () => {
    // 206 tickets and 30 rows is a scan that stopped paginating. Treating
    // it as whole would close the 176 that are simply on page two.
    const page = fakePage({
      open: { totals: [206], pages: [[row('J111111111111', '38061110527796')]] },
      resolved: { totals: [0], pages: [[]] },
    });
    const res = await scan(page).listOpenAndResolved();
    expect(res.rows).toHaveLength(1);
    expect(res.complete).toBe(false);
  });

  it('is NOT complete when a tab comes back empty against a real total', async () => {
    // The login-bounce shape: the page renders, no rows are found. Every
    // ticket looks closed. This is the reading that must never be acted
    // on.
    const page = fakePage({
      open: { totals: [206], pages: [[]] },
      resolved: { totals: [12], pages: [[]] },
    });
    const res = await scan(page).listOpenAndResolved();
    expect(res.rows).toHaveLength(0);
    expect(res.complete).toBe(false);
  });

  it('reads the waybill without mistaking the ticket id for one', async () => {
    const page = fakePage({
      open: { totals: [1], pages: [[row('J1788614822014912', '38061110527796')]] },
      resolved: { totals: [0], pages: [[]] },
    });
    const [only] = (await scan(page).listOpenAndResolved()).rows;
    expect(only?.externalTicketId).toBe('J1788614822014912');
    expect(only?.awbNumber).toBe('38061110527796');
  });

  it('hashes the whole row, so any change reopens the thread', async () => {
    const build = async (status: string) => {
      const page = fakePage({
        open: { totals: [1], pages: [[row('J111111111111', '38061110527796', status)]] },
        resolved: { totals: [0], pages: [[]] },
      });
      return (await scan(page).listOpenAndResolved()).rows[0]?.rowHash;
    };
    // A status move, a new reply, a re-categorisation — all move the
    // hash, and none of them has to be enumerated.
    expect(await build('Open 6 Sept 11:13')).not.toBe(await build('Open 6 Sept 12:40'));
    expect(await build('Open 6 Sept 11:13')).toBe(await build('Open 6 Sept 11:13'));
  });

  it('never reads their Closed tab', async () => {
    const visited: string[] = [];
    const page = fakePage({
      open: { totals: [0], pages: [[]] },
      resolved: { totals: [0], pages: [[]] },
    });
    const wrapped = {
      ...page,
      goto: async (url: string) => {
        visited.push(url);
        await page.goto(url);
      },
    };
    await scan(wrapped).listOpenAndResolved();
    // Closed grows without bound; absence from the other two says the
    // same thing for free.
    expect(visited.some((u) => u.includes('/closed'))).toBe(false);
    expect(visited.some((u) => u.includes('/open'))).toBe(true);
    expect(visited.some((u) => u.includes('/resolved'))).toBe(true);
  });
});
