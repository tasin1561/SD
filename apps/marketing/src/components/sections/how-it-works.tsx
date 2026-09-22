import type { ReactElement } from 'react';
import {
  Boxes,
  ClipboardList,
  Landmark,
  PackageCheck,
  PhoneCall,
  Route,
  Truck,
  Bike,
} from 'lucide-react';
import { platform } from '@/content/site';
import { HowItWorksLoader } from '@/components/islands/loaders/how-it-works-loader';
import { SectionHeading } from './section-heading';
import './sections.css';
import './how-it-works.css';

const PARCEL_ICONS = [ClipboardList, Truck, Landmark, Bike, PackageCheck];
const SELLER_ICONS = [Boxes, PhoneCall, PackageCheck, Route];

/**
 * SECTION — How it works. Two tracks under a bead toggle: sending a parcel
 * (Book → Pickup → Border & customs → Last-mile courier → Delivered — the
 * default, because this is a courier site first) and selling in India (the
 * seller's four steps). Each is a u34 progress stepper: the connector fills
 * to the current step, completed steps turn solid with a check, the panel
 * under it explains the step and lists what it does.
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
          title="From a door in Bangladesh to a door in India"
          sub="Sending a parcel is five steps and one agreed price. Selling in India is four: your stock goes once, and every order after that is confirmed by phone, picked, packed and tracked to the customer."
        />
        <HowItWorksLoader
          tracks={[
            {
              id: 'parcel',
              label: 'Sending a parcel',
              hue: 'saffron',
              steps: platform.howItWorksParcel,
              icons: PARCEL_ICONS.map((I, i) => <I key={i} size={20} />),
            },
            {
              id: 'seller',
              label: 'Selling in India',
              hue: 'blue',
              steps: platform.howItWorks,
              icons: SELLER_ICONS.map((I, i) => <I key={i} size={20} />),
            },
          ]}
        />
      </div>
    </section>
  );
}
