import type { ReactElement } from 'react';
import { Boxes, PackageCheck, PhoneCall, Route } from 'lucide-react';
import { platform } from '@/content/site';
import { HowItWorksClient } from '@/components/islands/how-it-works-client';
import { SectionHeading } from './section-heading';
import './sections.css';
import './how-it-works.css';

const ICONS = [Boxes, PhoneCall, PackageCheck, Route];

/**
 * SECTION — How it works. The four phases as a u34 progress stepper: the
 * connector fills to the current step, completed steps turn solid with
 * a check, the panel under it explains the step and lists what it does.
 * The steps advance on their own while in view; picking one holds it.
 */
export function HowItWorks(): ReactElement {
  return (
    <section id="how-it-works" className="sec sec--raised" aria-labelledby="how-h2">
      <div className="sec__inner safe-x sm:px-6">
        <SectionHeading
          id="how-h2"
          hue="blue"
          eyebrow="How it works"
          icon={<Route size={14} />}
          title="Four steps from your shelf in Dhaka to a doorstep in India"
          sub="Stock goes once. Every order after that is confirmed by phone, picked against the batch it was reserved from, scanned into the box, booked with a courier and tracked to the door."
        />
        <HowItWorksClient
          steps={platform.howItWorks.map((s, i) => ({ ...s, icon: i }))}
          icons={ICONS.map((I) => (
            <I key={I.displayName} size={20} />
          ))}
        />
      </div>
    </section>
  );
}
