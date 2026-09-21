import type { ReactElement } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { PlatformTourLoader } from '@/components/islands/loaders/platform-tour-loader';
import { SectionHeading } from './section-heading';
import './sections.css';
import './platform-tour.css';

/**
 * SECTION 13 — the platform tour (`#platform`): six vignettes, one per
 * group of what the seller app does, each a storyboard in the app's own
 * words with the 3A bullets as a checklist beside the mock. Only the
 * active tab's vignette is mounted; every chunk is lazy.
 */
export function PlatformTour(): ReactElement {
  return (
    <section id="platform" className="sec sec--raised" aria-labelledby="platform-h2">
      <div className="sec__inner safe-x sm:px-6">
        <SectionHeading
          id="platform-h2"
          hue="blue"
          eyebrow="The seller platform"
          icon={<LayoutDashboard size={14} />}
          title="Everything the operation does, shown working"
          sub="Not a feature list. Six short scenes from the seller app — stock in, the shelf, orders, returns, money and your team — each in the words the app itself uses."
        />
        <PlatformTourLoader />
      </div>
    </section>
  );
}
