import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { resolvedTheme, THEME_COOKIE_NAME, themeInitScript } from '@skydrop/ui/components';
import { langInitScript, localeDir } from '@skydrop/ui/app/i18n';
import { motionInitScript } from '@skydrop/ui/app/motion-init';
import localFont from 'next/font/local';
import { AppLocaleProvider } from '@/i18n/client';
import { getLocale, getT } from '@/i18n/server';
import './globals.css';

/**
 * Root layout — applies the brand skin and Plus Jakarta Sans to every
 * page. Same shape as the other consoles (FE-6 token system shared from
 * @skydrop/ui; the app shell mounts in the (authed) layout).
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

// Mono is for identifiers only (order no, AWB, SKU): not preloaded.
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

/**
 * Bangla: Noto Sans Bengali (OFL, licence beside the file), ONE variable woff2
 * (wght 400-700, 69.9 KB) subset to Bengali + danda, ZWJ/ZWNJ, ₹ and the dotted
 * circle. Same shape as track's Devanagari face: the @font-face is declared
 * everywhere, but the family is only NAMED in the font stack under
 * `html[lang='bn']` (globals.css), and `unicode-range` is Bengali-only, so an
 * English visitor never requests the file. Not preloaded for the same reason.
 * It is listed BEFORE Plus Jakarta there so ZWJ/ZWNJ stay with the Bengali run
 * (Jakarta's range also covers U+200C-D, which would split a conjunct).
 */
const bengali = localFont({
  src: [
    {
      path: './fonts/noto-sans-bengali-400-700.woff2',
      weight: '400 700',
      style: 'normal',
    },
  ],
  variable: '--font-bn-face',
  display: 'swap',
  preload: false,
  declarations: [
    {
      prop: 'unicode-range',
      value: 'U+0964-0965, U+0980-09FF, U+200C-200D, U+20B9, U+25CC',
    },
  ],
});

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    title: t('shell.meta.title'),
    description: t('shell.meta.description'),
    robots: { index: false, follow: false },
  };
}

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
  // No pin means LIGHT (owner, 2026-10-26) — the System position is
  // gone and nothing reads the operating system any more. Rendered
  // here as well as stamped by the init script so a hydration-mismatch
  // recovery cannot reset <html> to an unthemed state.
  const theme = resolvedTheme((await cookies()).get(THEME_COOKIE_NAME)?.value);
  // The UI language, from the `sd-lang` cookie, rendered on <html> for the same
  // reason as the theme: React 19 resets <html>'s attributes to its SERVER props on
  // a hydration-mismatch recovery, so a client-only `lang` would silently revert to
  // English. English when there is no cookie.
  const locale = await getLocale();
  return (
    // `suppressHydrationWarning`: the init script below stamps
    // `data-theme` on this element BEFORE hydration (from localStorage,
    // which can be ahead of the cookie on a first load), so the server
    // HTML and the client tree can legitimately differ by that one
    // attribute. React does not descend, so this does not mask
    // mismatches in the app tree.
    <html
      lang={locale}
      dir={localeDir(locale)}
      suppressHydrationWarning
      data-theme={theme}
      className={`${sans.variable} ${mono.variable}${locale === 'bn' ? ` ${bengali.variable}` : ''}`}
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
        {/* The UI language: repairs the `sd-lang` cookie from localStorage and
            stamps `lang` before first paint. Nonce'd like the theme script. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: langInitScript }}
        />
        {/* The per-user "Reduce motion" choice (localStorage only), applied
            before first paint like the theme. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: motionInitScript }}
        />
      </head>
      <body>
        <AppLocaleProvider initialLocale={locale}>{children}</AppLocaleProvider>
      </body>
    </html>
  );
}
