import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { pinnedTheme, THEME_COOKIE_NAME, themeInitScript } from '@skydrop/ui/components';
import { motionInitScript } from '@skydrop/ui/app/motion-init';
import localFont from 'next/font/local';
import './globals.css';

/**
 * Root layout — the brand skin and Plus Jakarta Sans on every page (apps
 * restyle, Phase 5). The theme follows the OS until somebody pins one;
 * the theme switch in the shell and on the sign-in frame pins
 * [data-theme] on <html> and stores the choice.
 *
 * The init script below runs BEFORE hydration so a light-theme user
 * does not get a dark flash on every navigation. It is a hand-written
 * inline script, so it needs the CSP nonce — middleware forwards it on
 * the request as `x-nonce`. Next stamps its OWN scripts automatically;
 * this one is on us. Omitting it fails silently (the browser just
 * refuses to run it), which is exactly how apps/track shipped a blocked
 * theme script.
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
 * Plus Jakarta Sans everywhere (the brand face, as on the marketing site and
 * the tracking page); JetBrains Mono ONLY for identifiers — AWB, order ID,
 * SKU, serial — and not preloaded. Figures are tabular Plus Jakarta.
 */
const sans = localFont({
  src: './fonts/plus-jakarta-sans-latin.woff2',
  variable: '--font-sans-face',
  display: 'swap',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

// Mono is for identifiers only (AWB, order ID, SKU, serial): not preloaded.
const mono = localFont({
  src: './fonts/jetbrains-mono-latin.woff2',
  variable: '--font-mono-face',
  display: 'swap',
  preload: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

export const metadata: Metadata = {
  title: 'Skydrop Admin',
  description: 'Skydrop staff dashboard',
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
      className={`${sans.variable} ${mono.variable}`}
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
        {/* The per-user "Motion: reduced" preference (localStorage only),
            applied before first paint like the theme. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: motionInitScript }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
