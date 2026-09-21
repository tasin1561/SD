import type { Metadata, Viewport } from 'next';
import type { ReactElement, ReactNode } from 'react';
import localFont from 'next/font/local';
import './globals.css';
import { PlaceholderRibbon } from '@/components/chrome/placeholder-ribbon';
import { platform } from '@/content/site';
import { jsonLd } from '@/lib/json-ld';
import { PAGE_BG } from '@/lib/theme-colors';
import { themeInitScript } from '@/lib/theme-init';

/**
 * Type stack — the COURIER redesign (2026-09-21).
 *
 *   Plus Jakarta Sans — headings AND body, one family (PROVISIONAL: the
 *                       owner is choosing between it and Manrope from the
 *                       swatch specimens; swapping is this file + one
 *                       woff2, because everything reads `--font-sans`).
 *   JetBrains Mono    — IDENTIFIERS and FIGURES only: waybills, serials,
 *                       SKUs. `preload: false` — a 40 KB file for a handful
 *                       of identifiers must not sit on the critical path.
 *
 * Fonts are COMMITTED, not fetched at build time. `next/font/google`
 * self-hosts at RUNTIME but downloads during `next build`, and that made
 * every build and deploy depend on fonts.gstatic.com answering — it
 * failed three CI runs in one day. These are the variable latin subsets,
 * so the rendered result is identical; `declarations` pins the
 * unicode-range the CDN's own @font-face carried and self-hosting loses.
 *
 * The unicode-range literal is written out TWICE, and it has to be:
 * `next/font` is a compiler transform that reads literals only, so a
 * shared const fails the BUILD with "Font loader values must be
 * explicitly written literals" while typecheck and lint both pass.
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

const jetbrains = localFont({
  src: './fonts/jetbrains-mono-latin.woff2',
  variable: '--font-jetbrains',
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

const siteUrl = `https://${platform.brand.domain}`;

/**
 * No `alternates.canonical` HERE — each page declares its own, because a
 * root-level canonical is inherited verbatim and pointed `/privacy` and
 * `/request-invite` at the home page for months.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Skydrop — courier and fulfilment, Bangladesh ⇄ India',
  description:
    'Skydrop holds your stock in India, confirms every COD order by phone, and delivers through India’s couriers — with returns, tracking and your money itemised in one place.',
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Skydrop — courier and fulfilment, Bangladesh ⇄ India',
    description:
      'We hold your stock in India, confirm every COD order by phone, and dispatch through our courier partners. You sell; we carry the rest.',
    url: siteUrl,
    siteName: 'Skydrop',
    type: 'website',
    locale: 'en_US',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'Skydrop — Bangladesh ⇄ India courier and fulfilment',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Skydrop — courier and fulfilment, Bangladesh ⇄ India',
    description:
      'We hold your stock in India, confirm every COD order by phone, and deliver through our courier partners.',
    images: ['/og.png'],
  },
};

/**
 * `theme-color` per OS scheme, from the SAME hex pair theme.css uses for
 * `--page` (check:theme pins the two). A PINNED theme rewrites both metas
 * from the init script and the toggle.
 */
export const viewport: Viewport = {
  colorScheme: 'dark light',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: PAGE_BG.dark },
    { media: '(prefers-color-scheme: light)', color: PAGE_BG.light },
  ],
};

const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: platform.brand.name,
  url: siteUrl,
  // The mark itself, not the social card — a knowledge panel wants a logo.
  logo: `${siteUrl}/brand/skydrop-logo.png`,
  email: platform.brand.email,
  description:
    'Cross-border courier and fulfilment for Bangladeshi e-commerce sellers shipping to India: warehousing, COD call-confirmation, courier dispatch, returns, tracking and payouts.',
  areaServed: ['BD', 'IN'],
  sameAs: [],
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en" className={`${sans.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript(PAGE_BG) }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd(organizationJsonLd) }}
        />
      </head>
      <body>
        <a href="#main" className="skip-to-content">
          Skip to content
        </a>
        {children}
        <PlaceholderRibbon />
      </body>
    </html>
  );
}
