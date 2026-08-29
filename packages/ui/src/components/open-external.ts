/**
 * Open a URL that is not known yet, in a new tab, without losing it to
 * a popup blocker.
 *
 * ── WHY THIS IS NOT A ONE-LINER ──────────────────────────────────────
 * `window.open(url)` after an `await` has left the user-gesture window,
 * and browsers block it — so a document fetched and then opened is a
 * tab that silently never appears.
 *
 * The fix is to open SYNCHRONOUSLY inside the click and point the tab
 * at the URL once it arrives. That has its own trap, which cost a real
 * bug: passing `noopener` to `window.open` makes it return NULL, so the
 * handle you need in order to fill the tab does not exist and the user
 * is left looking at about:blank. The opener has to be severed on the
 * handle instead.
 *
 * Prefer a plain `<a href>` to a URL your server can mint on demand —
 * see the invoice PDF redirect. Use this only when the URL genuinely
 * cannot be known before the click.
 */
export async function openExternalWhenReady(resolve: () => Promise<string | null>): Promise<void> {
  // Opened inside the gesture, so the blocker allows it. NO `noopener`
  // here: with it, `window.open` returns null and there is nothing to
  // navigate.
  const tab = typeof window === 'undefined' ? null : window.open('', '_blank');
  // Severed manually — same protection `noopener` would have given,
  // without giving up the handle.
  if (tab !== null) tab.opener = null;

  try {
    const url = await resolve();
    if (url === null || url === '') {
      tab?.close();
      return;
    }
    if (tab === null) {
      // The blocker took it anyway (or there is no window). Navigating
      // the current tab is better than the click doing nothing at all.
      window.location.href = url;
      return;
    }
    tab.location.href = url;
  } catch (err) {
    // A tab we cannot fill is worse than no tab: it strands the user on
    // a blank page with no way to know what failed.
    tab?.close();
    throw err;
  }
}
