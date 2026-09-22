import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { FloatingContact } from '@/components/chrome/floating-contact';
import { MobileBottomBar } from '@/components/chrome/mobile-bottom-bar';
import { Nav } from '@/components/landing/nav';
import { Hero } from '@/components/sections/hero';
import { Services } from '@/components/sections/services';
import { ImportExport } from '@/components/sections/import-export';
import { Coverage } from '@/components/sections/coverage';
import { HowItWorks } from '@/components/sections/how-it-works';
import { TrackBand } from '@/components/sections/track-band';
import { PlatformTour } from '@/components/sections/platform-tour';
import { ResellerStores } from '@/components/sections/reseller-stores';
import { Estimator } from '@/components/sections/estimator';
import { Goods } from '@/components/sections/goods';
import { Partners } from '@/components/sections/partners';
import { Compare } from '@/components/sections/compare';
import { Why } from '@/components/sections/why';
import { Trust } from '@/components/sections/trust';
import { Testimonials } from '@/components/sections/testimonials';
import { Faq } from '@/components/sections/faq';
import { Contact } from '@/components/sections/contact';
import { FinalCta } from '@/components/sections/final-cta';
import { SiteFooter } from '@/components/landing/site-footer';

/** The canonical is per PAGE (a root-level one pointed every page at `/`). */
export const metadata: Metadata = { alternates: { canonical: '/' } };

/**
 * Section order follows docs/design-direction.md §6: hero · services ·
 * import & export · coverage · how it works · track band · platform tour · reseller stores ·
 * pricing estimator · what you can send · partners · compare ·
 * credentials & trust · testimonials · FAQ · contact · final CTA. The track band sits after how-it-works
 * so a customer who scrolled past the hero's Track tab meets it again.
 */
export default function HomePage(): ReactElement {
  return (
    <>
      <Nav />
      <main id="main">
        <Hero />
        <Services />
        <ImportExport />
        <Coverage />
        <HowItWorks />
        <TrackBand />
        <PlatformTour />
        <ResellerStores />
        <Estimator />
        <Goods />
        <Partners />
        <Compare />
        <Why />
        <Trust />
        <Testimonials />
        <Faq />
        <Contact />
        <FinalCta />
      </main>
      <SiteFooter />
      <MobileBottomBar />
      <FloatingContact />
    </>
  );
}
