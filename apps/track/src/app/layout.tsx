import type { Metadata } from 'next';
import { headers } from 'next/headers';
import localFont from 'next/font/local';
import { getActiveLocale } from '@/lib/locale';
import { themeInitScript } from '@/lib/theme-init';
import './globals.css';

// MISSION CONTROL type stack — matches apps/marketing.
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
const grotesk = localFont({
  src: './fonts/space-grotesk-latin.woff2',
  variable: '--font-grotesk',
  display: 'swap',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

const inter = localFont({
  src: './fonts/inter-latin.woff2',
  variable: '--font-inter',
  display: 'swap',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

const jetbrains = localFont({
  src: './fonts/jetbrains-mono-latin.woff2',
  variable: '--font-jetbrains',
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
  title: 'Skydrop tracking',
  description: 'Track your Skydrop parcel by AWB number.',
  robots: { index: true, follow: true },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const locale = await getActiveLocale();
  // The no-flash theme script has to be inline — it must run before first
  // paint, and an external file would be a round-trip of white screen. Under
  // the nonce CSP that means it needs the nonce, which middleware forwards on
  // the request as `x-nonce`. Next stamps its OWN scripts automatically; a
  // hand-written one like this is on us.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html
      lang={locale}
      className={`${grotesk.variable} ${inter.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* `suppressHydrationWarning` on the SCRIPT, not just on <html>:
            the browser STRIPS the nonce attribute from the DOM once CSP
            has been applied (it stops a nonce being read back out via a
            CSS attribute selector), so the server renders nonce="…" and
            the client reads "". React flags that as a mismatch, and
            suppression does not cascade from <html>. */}
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
