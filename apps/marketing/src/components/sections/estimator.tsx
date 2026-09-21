import type { ReactElement } from 'react';
import { Calculator } from 'lucide-react';
import { EstimatorLoader } from '@/components/islands/loaders/estimator-loader';
import { SectionHeading } from './section-heading';
import './sections.css';
import './estimator.css';

/**
 * SECTION — Pricing estimator (`#pricing`). Direction cards (u10),
 * cascading state → city selects (u18), parcel-type cards, weight and
 * dimension steppers (u12) with the volumetric rule explained in a tooltip
 * card (u35), a COD switch (u08), a multi-select of what is being sent
 * (u24), and the parachute (pattern 1) that lands on the estimate. The
 * island is a separate chunk that loads when the section is near.
 */
export function Estimator(): ReactElement {
  return (
    <section id="pricing" className="sec sec--mesh" data-hue="saffron" aria-labelledby="pricing-h2">
      <div className="sec__inner safe-x sm:px-6">
        <SectionHeading
          id="pricing-h2"
          hue="saffron"
          eyebrow="Pricing"
          icon={<Calculator size={14} />}
          title="Get an estimate in a minute"
          sub="One flat rate per weight slab, either direction, agreed before anything ships. Tell us where it is going and how big it is."
        />
        <EstimatorLoader />
      </div>
    </section>
  );
}
