import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import localFont from 'next/font/local';
import './globals.css';
import { themeInitScript } from '@/lib/theme-init';

/**
 * PRECISION LOGISTICS type stack — the same two faces apps/seller runs,
 * so a seller who signs in is not handed to a different company.
 *
 *   IBM Plex Sans  — prose AND headings, separated by weight and size
 *                    rather than by a second display family.
 *   JetBrains Mono — anything that is an IDENTIFIER or a FIGURE: a
 *                    waybill, a rupee amount, a duration, a column
 *                    caption. It is doing work, not decorating — a
 *                    column of proportional digits does not line up.
 *
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
 * The unicode-range is written out TWICE, and it has to be.
 *
 * `next/font` is a compiler transform, not a runtime call: it reads the
 * options out of the AST at build time, so every value must be a literal
 * it can see. Lifting the range into a shared `LATIN_RANGE` const — the
 * obvious de-duplication — fails the BUILD with "Font loader values must
 * be explicitly written literals", which is a thing typecheck and lint
 * both pass over happily.
 */
const plexSans = localFont({
  src: './fonts/ibm-plex-sans-latin.woff2',
  variable: '--font-plex-sans',
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

const siteUrl = 'https://skydrop.online';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Skydrop — COD fulfillment, warehousing, remittance',
  description:
    'Selling into India is a six-headed problem. Skydrop holds your stock in India, confirms every order by phone, and dispatches through our courier partner — you just sell.',
  robots: { index: true, follow: true },
  alternates: { canonical: siteUrl },
  openGraph: {
    title: 'Skydrop — COD fulfillment, warehousing, remittance',
    description:
      'We hold your stock in India, confirm every order by phone (COD-first), and dispatch through our courier partner. You just sell.',
    url: siteUrl,
    siteName: 'Skydrop',
    type: 'website',
    locale: 'en_US',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'Skydrop — BD → IN cross-border fulfillment',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Skydrop — COD fulfillment, warehousing, remittance',
    description:
      'We hold your stock in India, confirm every order by phone, and dispatch through our courier partner.',
    images: ['/og.png'],
  },
};

const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Skydrop',
  url: siteUrl,
  // The mark itself, not the social card — a search engine rendering a
  // knowledge panel wants a logo, and the OG image is a 1200x630 poster.
  logo: `${siteUrl}/brand/skydrop-logo.png`,
  email: 'hello@skydrop.online',
  description:
    'Cross-border courier aggregator + light WMS. Bangladeshi e-commerce sellers ship into India: Skydrop handles warehousing, COD call-confirmation, courier dispatch, RTO, and remittance.',
  areaServed: ['BD', 'IN'],
  sameAs: [],
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
      </head>
      <body>
        <a href="#main" className="skip-to-content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
