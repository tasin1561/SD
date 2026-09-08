import type { Page } from 'playwright';

/**
 * `page.goto`, tolerant of the target redirecting to itself.
 *
 * ── THE FAILURE THIS EXISTS FOR ──────────────────────────────────────
 * Delhivery's portal is a single-page app that re-asserts its own route
 * on load. When it does that while our `goto` is still in flight,
 * Playwright aborts ours and throws:
 *
 *   Navigation to "https://one.delhivery.com/v2/login" is interrupted
 *   by another navigation to "https://one.delhivery.com/v2/login"
 *
 * Note both halves are the SAME url. Nothing went wrong — the page got
 * to where we asked, by its own route rather than ours — but the throw
 * killed the whole ticket sweep, five times in a day, and surfaced as
 * "Courier replies are not being collected". Sellers who raised an
 * issue saw no reply for as long as it lasted.
 *
 * ── WHY THIS IS NOT SWALLOWING AN ERROR ──────────────────────────────
 * It is narrow in two ways that matter. It only catches the
 * interrupted-navigation message, so a timeout, a DNS failure or a
 * refused connection still throws and still raises its issue. And after
 * catching, it WAITS for the interrupting navigation to settle and then
 * CHECKS where we actually landed — if the page ended up somewhere else
 * the original error is rethrown, because "it redirected me elsewhere"
 * is a real failure and looks nothing like this one.
 *
 * Use this for every portal navigation rather than `page.goto`: the race
 * is a property of their app, not of any one page of ours.
 */
export async function gotoPortal(
  page: Page,
  url: string,
  opts: { readonly timeout?: number } = {},
): Promise<void> {
  const timeout = opts.timeout ?? 45_000;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/interrupted by another navigation/i.test(message)) throw err;

    // Let whatever interrupted us finish. `domcontentloaded` rather
    // than `load`: their app streams for a while after the document is
    // ready, and every caller waits for its own selector anyway.
    await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => undefined);

    // Compared without the query or hash: their router appends its own
    // (`?src=`, `#/`), so a strict equality check would reject the very
    // case this exists to accept.
    if (!samePath(page.url(), url)) throw err;
  }
}

function samePath(actual: string, wanted: string): boolean {
  try {
    const a = new URL(actual);
    const b = new URL(wanted);
    return a.origin === b.origin && a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, '');
  } catch {
    return false;
  }
}
