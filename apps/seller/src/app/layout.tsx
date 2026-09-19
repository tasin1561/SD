import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { pinnedTheme, THEME_COOKIE_NAME, themeInitScript } from '@skydrop/ui/components';
import localFont from 'next/font/local';
import './globals.css';

/**
 * Root layout — applies the design tokens + IBM Plex typography to every
 * page. Same shape as apps/admin (FE-6 token system shared from
 * @skydrop/ui; per-app shell deferred until the (authed) layout).
 * Dark is the default; the ThemeToggle in the app shell pins
 * [data-theme] on <html> and stores the choice in localStorage AND the
 * `sd-theme` cookie, which this layout renders from (see below).
 */

/**
 * Fonts are COMMITTED, not fetched at build time.
 *
 * `next/font/google` self-hosts at RUNTIME, which is the part everyone
 * checks — but it downloads the file during `next build`, and that made
 * every build and every deploy depend on fonts.gstatic.com answering.
 * It failed three CI runs in one day, each time on a different family,
 * each time with nothing wrong in the diff. The same outage during a
 * deploy is worse: it fails the deploy for a reason no one changed.
 *
 * These are the latin subsets of the same variable faces, so the
 * rendered result is identical. `declarations` pins unicode-range to
 * what latin actually covers, which is what the CDN's own @font-face
 * carried and is otherwise lost when self-hosting.
 */
/*
 * PRECISION LOGISTICS uses IBM Plex Sans and JetBrains Mono (the comps'
 * `typography.fontFamily`, every block). Both are the LATIN SUBSET of
 * the same VARIABLE faces Google serves — one file each covering 400–700
 * — fetched once and committed here, 77KB for the pair. Nothing is
 * downloaded at build time and nothing is fetched at runtime.
 *
 * `unicode-range` is the CDN's own, for the reason above: self-hosting
 * silently drops it, and without it the browser will pull a face down
 * for text it cannot render. It differs from Geist's by one codepoint
 * (no U+2074), which is what the latin subset actually covers.
 *
 * The MONO face is load-bearing here rather than incidental. In this
 * design every identifier and every figure is set in it — waybills,
 * order numbers, SKUs, amounts, timestamps, column captions — because a
 * column of proportional digits does not line up and a waybill in a
 * humanist sans is a waybill somebody misreads down a phone.
 */
const plexSans = localFont({
  src: './fonts/ibm-plex-sans-latin.woff2',
  variable: '--font-plex-sans',
  display: 'swap',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

const jetbrainsMono = localFont({
  src: './fonts/jetbrains-mono-latin.woff2',
  variable: '--font-jetbrains-mono',
  display: 'swap',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

export const metadata: Metadata = {
  title: 'Skydrop Seller',
  description: 'Skydrop seller portal — manage catalog, orders, and shipments.',
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  // The pinned theme is SERVER-rendered from the `sd-theme` cookie. When
  // React 19 recovers from a hydration mismatch it resets <html>'s
  // attributes to these server props, which used to wipe the pin the init
  // script had stamped — a light console turning dark mid-session.
  const theme = pinnedTheme((await cookies()).get(THEME_COOKIE_NAME)?.value);
  return (
    // `suppressHydrationWarning`: the init script below stamps
    // `data-theme` on this element BEFORE hydration (from localStorage,
    // which can be ahead of the cookie on a first load), so the server
    // HTML and the client tree can legitimately differ by that one
    // attribute. React does not descend, so this does not mask
    // mismatches in the app tree.
    <html
      lang="en"
      suppressHydrationWarning
      data-theme={theme}
      className={`${plexSans.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        {/* `suppressHydrationWarning` on the SCRIPT, not just on
            <html>: the browser STRIPS the nonce attribute from the DOM
            once CSP has been applied (it stops a nonce being read back
            out via a CSS attribute selector), so the server renders
            nonce="…" and the client reads "". React flags that as a
            mismatch, and suppression does not cascade from <html>. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
