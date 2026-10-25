'use client';

import type { ReactElement } from 'react';

const DEFAULT_SOURCE = 'skydrop.global';

/**
 * "Built by solustation" credit for the footer's legal bar. Self-contained
 * markup (no external script, no image request), so it adds nothing to the
 * CSP surface. Colours come from the footer's tokens (`--fg-strong` as the
 * logo's ink, `--surface-band` as its paper) plus one scoped variable for
 * Solustation's brand orange, declared on `.sol-credit` in chrome.css —
 * the SVG parts are coloured from CSS, never by hex attributes.
 *
 * Why `'use client'` for markup with no state: as a server component its
 * whole tree is serialised into the RSC payload — twice on `/`, as well as
 * the HTML — and those copies sit too far apart for gzip to share, which
 * put `out/index.html` over its MKT-5 budget (+0.55 KB gz against 0.5 KB of
 * headroom). As a client reference the payload carries one short reference
 * per use; the HTML is still server-rendered, and the module is a few
 * hundred bytes of first-load JS, where the budget has room.
 */
export function SolustationCredit({
  source = DEFAULT_SOURCE,
}: {
  /** The app's own domain, sent as `utm_source`. */
  source?: string;
}): ReactElement {
  const href = `https://solustation.site/?utm_source=${encodeURIComponent(
    source,
  )}&utm_medium=footer_credit&utm_campaign=built_by`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      aria-label="Built by Solustation — visit solustation.site"
      className="sol-credit"
    >
      <svg width="22" height="28" viewBox="12 6 40 52" aria-hidden="true">
        <path d="M42 22A10 10 0 1 0 32 32a10 10 0 1 1-10 10" />
        <circle cx="42" cy="22" r="4.6" />
        <circle cx="22" cy="42" r="4.6" />
        <circle cx="32" cy="32" r="6.2" />
      </svg>
      Built by <b>solustation</b>
    </a>
  );
}
