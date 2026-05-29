import type { Metadata } from 'next';
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
