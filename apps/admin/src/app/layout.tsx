import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { themeInitScript } from '@skydrop/ui/components';
import { Geist, Geist_Mono } from 'next/font/google';
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

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
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
