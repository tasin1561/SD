import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

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
  title: 'Skydrop — Cross-border courier aggregator for Bangladeshi sellers',
  description:
    'Sell into India from Bangladesh without Indian operations. Skydrop holds your inventory in India, confirms orders by phone, and ships via Delhivery.',
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Skydrop — Sell to India from Bangladesh',
    description:
      'We hold your stock in India, confirm every order by phone (COD-first), and dispatch via Delhivery. You just sell.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
