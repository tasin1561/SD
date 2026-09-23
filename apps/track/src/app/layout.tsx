import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import localFont from 'next/font/local';
import { pinnedTheme, THEME_COOKIE_NAME, themeInitScript } from '@skydrop/ui/components';
import { getActiveLocale } from '@/lib/locale';
import './globals.css';

/**
 * Fonts are COMMITTED, not fetched at build time (a build must never depend
 * on a font CDN answering). Plus Jakarta Sans everywhere, JetBrains Mono for
 * the AWB only.
 *
 * Hindi: a Devanagari face (Poppins Devanagari 400 + 600, 39.7 + 39.3 KB, OFL) whose
 * @font-face is declared on every page but which is only NAMED in the font
 * stack when Hindi is active (`data-lang="hi"` → `--app-font` in
 * track.css). A browser downloads a web font only for text that asks for
 * it, so an English visitor never fetches it — even the "हिन्दी" label on
 * the switcher renders in the system font, exactly as it did before.
 */
const sans = localFont({
  src: './fonts/plus-jakarta-sans-latin.woff2',
  variable: '--font-sans-face',
  display: 'swap',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

const mono = localFont({
  src: './fonts/jetbrains-mono-latin.woff2',
  variable: '--font-mono-face',
  display: 'swap',
  preload: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

const devanagari = localFont({
  src: [
    { path: './fonts/poppins-devanagari-400.woff2', weight: '400', style: 'normal' },
    // A real 600 (39.3 KB) so Hindi headings are not synthesised bold.
    { path: './fonts/poppins-devanagari-600.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-deva-face',
  display: 'swap',
  preload: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0900-097F, U+1CD0-1CF9, U+200C-200D, U+20A8, U+20B9, U+20F0, U+25CC, U+A830-A839, U+A8E0-A8FF',
    },
  ],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://track.skydrop.online'),
  title: 'Skydrop tracking',
  description: 'Track your Skydrop parcel by AWB number.',
  robots: { index: true, follow: true },
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'Skydrop',
    title: 'Skydrop tracking',
    description: 'Track your Skydrop parcel by AWB number.',
    url: '/',
    images: [{ url: '/og.png' }],
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const locale = await getActiveLocale();
  // The no-flash theme script has to be inline — it must run before first
  // paint. Under the nonce CSP it needs the nonce, which middleware
  // forwards on the request as `x-nonce`.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  // A pinned theme is also server-rendered from the `sd-theme` cookie, so a
  // hydration recovery cannot drop it (FE-7).
  const theme = pinnedTheme((await cookies()).get(THEME_COOKIE_NAME)?.value);
  return (
    <html
      lang={locale}
      data-lang={locale}
      data-theme={theme}
      className={`${sans.variable} ${mono.variable}${locale === 'hi' ? ` ${devanagari.variable}` : ''}`}
      suppressHydrationWarning
    >
      <head>
        {/* `suppressHydrationWarning` on the SCRIPT too: the browser strips
            the nonce attribute once CSP is applied, so server and client
            disagree, and suppression does not cascade from <html>. */}
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
