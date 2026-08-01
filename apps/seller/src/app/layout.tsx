import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { themeInitScript } from '@skydrop/ui/components';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

/**
 * Root layout — applies the design tokens + Geist typography to every
 * page. Same shape as apps/admin (FE-6 token system shared from
 * @skydrop/ui; per-app shell deferred until the (authed) layout).
 * Dark theme primary; a future theme toggle sets [data-theme='light']
 * on <html>.
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
