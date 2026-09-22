import type { ReactElement } from 'react';
import { PackageSearch } from 'lucide-react';
import { TrackBandLoader } from '@/components/islands/loaders/track-band-loader';
import { SectionHeading } from './section-heading';
import './sections.css';
import './track-band.css';

/**
 * SECTION — Track a parcel. The waybill field (u33) with the rolling-label
 * button (pattern 5) that reads "Track → Finding…" as ≤ 350 ms press
 * feedback and then navigates to the tracking site — there is no "found",
 * because we never learn the result here. Beside it, the sample tracking
 * card (u17), labelled Sample.
 */
export function TrackBand(): ReactElement {
  return (
    <section
      id="track"
      className="sec sec--band sec--mesh"
      data-hue="blue"
      aria-labelledby="track-h2"
    >
      <div className="sec__inner safe-x sm:px-6">
        <div className="trk">
          <div>
            <SectionHeading
              id="track-h2"
              hue="blue"
              eyebrow="Track a parcel"
              icon={<PackageSearch size={14} />}
              title="Where is it now?"
              sub="Every parcel has a public tracking page in English and Hindi, driven by the courier's own scans. Type the waybill number from your label or your order."
            />
            <TrackBandLoader />
          </div>
          <TrackBandLoader sample />
        </div>
      </div>
    </section>
  );
}
