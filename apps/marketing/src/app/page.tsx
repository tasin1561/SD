import type { ReactElement } from 'react';
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
    </>
  );
}
