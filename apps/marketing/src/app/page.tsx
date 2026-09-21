import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { FloatingContact } from '@/components/chrome/floating-contact';
import { MobileBottomBar } from '@/components/chrome/mobile-bottom-bar';
import { Nav } from '@/components/landing/nav';
import { Hero } from '@/components/landing/hero';
import { Problem } from '@/components/landing/problem';
import { HowItWorks } from '@/components/landing/how-it-works';
import { WhySkydrop } from '@/components/landing/why-skydrop';
import { Comparison } from '@/components/landing/comparison';
import { TrackWidget } from '@/components/landing/track-widget';
import { Faq } from '@/components/landing/faq';
import { FinalCta } from '@/components/landing/final-cta';
import { SiteFooter } from '@/components/landing/site-footer';

/** The canonical is per PAGE (a root-level one pointed every page at `/`). */
export const metadata: Metadata = { alternates: { canonical: '/' } };

export default function HomePage(): ReactElement {
  return (
    <>
      <Nav />
      <main id="main">
        <Hero />
        <Problem />
        <HowItWorks />
        <WhySkydrop />
        <Comparison />
        <TrackWidget />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
      <MobileBottomBar />
      <FloatingContact />
    </>
  );
}
