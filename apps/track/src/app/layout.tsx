import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Space_Grotesk, Inter, JetBrains_Mono } from 'next/font/google';
import { getActiveLocale } from '@/lib/locale';
import { themeInitScript } from '@/lib/theme-init';
import './globals.css';

// MISSION CONTROL type stack — matches apps/marketing.
const grotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-grotesk',
  weight: ['500', '600', '700'],
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  weight: ['400', '500'],
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  weight: ['400', '500'],
  display: 'swap',
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
