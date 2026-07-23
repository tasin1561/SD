import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import { Instrument_Sans, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

// Fonts — subset latin, display: swap, next/font auto-hosts them locally.
// No external font request at runtime; no FOIT.
const instrument = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-instrument',
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
  variable: '--font-mono',
  weight: ['400', '500'],
  display: 'swap',
});

const siteUrl = 'https://skydrop.online';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Skydrop — Sell to India from Bangladesh | COD fulfillment, warehousing, remittance',
  description:
    'Selling into India is a six-headed problem. Skydrop holds your stock in India, confirms every COD order by phone, and dispatches via Delhivery — you just sell.',
  robots: { index: true, follow: true },
  alternates: { canonical: siteUrl },
  openGraph: {
    title: 'Skydrop — Sell to India from Bangladesh',
    description:
      'We hold your stock in India, confirm every order by phone (COD-first), and dispatch via Delhivery. You just sell.',
    url: siteUrl,
    siteName: 'Skydrop',
    type: 'website',
    locale: 'en_US',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Skydrop — BD → IN cross-border fulfillment' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Skydrop — Sell to India from Bangladesh',
    description:
      'We hold your stock in India, confirm every order by phone, and dispatch via Delhivery.',
    images: ['/og.png'],
  },
};

// JSON-LD: Organization schema. FAQPage lives in the FAQ section itself so
// its questions/answers stay co-located with the visible content.
const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Skydrop',
  url: siteUrl,
  logo: `${siteUrl}/og.png`,
  email: 'hello@skydrop.online',
  description:
    'Cross-border courier aggregator + light WMS. Bangladeshi e-commerce sellers ship into India: Skydrop handles warehousing, COD call-confirmation, Delhivery dispatch, RTO, and remittance.',
  areaServed: ['BD', 'IN'],
  sameAs: [],
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return (
    <html
      lang="en"
      className={`${instrument.variable} ${inter.variable} ${jetbrains.variable}`}
    >
      <head>
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
      </head>
      <body>
        <a href="#main" className="skip-to-content">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
