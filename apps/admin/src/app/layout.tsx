import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { themeInitScript } from '@skydrop/ui/components';
import localFont from 'next/font/local';
import './globals.css';

/**
 * Root layout — applies the design tokens + Geist typography to
 * every page. Dark is the default; the ThemeToggle in the app shell
 * pins [data-theme='light'] on <html> and stores the choice.
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
const geistSans = localFont({
  src: './fonts/geist-latin.woff2',
  variable: '--font-geist-sans',
  display: 'swap',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

const geistMono = localFont({
  src: './fonts/geist-mono-latin.woff2',
  variable: '--font-geist-mono',
  display: 'swap',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
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
  return (
    // `suppressHydrationWarning`: the init script below stamps
    // `data-theme` on this element BEFORE hydration, so the server HTML
    // and the client tree legitimately differ by that one attribute.
    // React does not descend, so this does not mask mismatches in the
    // app tree.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable}`}
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
