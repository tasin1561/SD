import type { ReactElement } from 'react';
import { Reveal } from '@/lib/reveal';
import { MapPin } from 'lucide-react';
import { business, platform } from '@/content/site';
import { CoverageLoader } from '@/components/islands/loaders/coverage-loader';
import { RowLink } from '@/components/micro/list-row';
import { EmptyState } from '@/components/micro/empty-state';
import { SectionHeading } from './section-heading';
import './sections.css';
import './coverage.css';

/**
 * SECTION — Coverage. A segmented PIN / postcode checker (pattern 10: the
 * boxes link and merge into a shield when the code is served) beside the
 * six named lanes as u21 rows with their transit time, and a u27 empty
 * state pointing anyone else at a person.
 */
export function Coverage(): ReactElement {
  return (
    <section id="coverage" className="sec" aria-labelledby="coverage-h2">
      <div className="sec__inner safe-x sm:px-6">
        <SectionHeading
          id="coverage-h2"
          hue="green"
          eyebrow="Coverage"
          icon={<MapPin size={14} />}
          title="Check a PIN code or a postcode"
          sub="We deliver across India and Bangladesh through integrated couriers. Type the destination code and we tell you at once whether we deliver there and roughly how long it takes."
        />
        <div className="cov">
          <div className="cov__check sec-card" data-hue="green">
            <CoverageLoader serviceability={business.serviceability} />
          </div>
          <div className="cov__lanes">
            <h3 className="cov__lanes-h">The lanes most parcels take</h3>
            <ul className="cov__list">
              {platform.coverageCities.map((c, i) => (
                <Reveal as="li" key={c} delay={i * 50}>
                  <RowLink
                    href="/#pricing"
                    hue={i === 0 ? 'green' : 'saffron'}
                    icon={<MapPin size={16} />}
                    title={c}
                    helper={i === 0 ? 'Bangladesh · origin' : 'India · destination'}
                    meta={business.coverageTransit[c as keyof typeof business.coverageTransit]}
                  />
                </Reveal>
              ))}
            </ul>
            <EmptyState
              tone="green"
              title="Somewhere else?"
              body="Most of India and Bangladesh is covered through our couriers. Tell us the town and we will confirm before you book."
              action={
                <a
                  href={business.whatsappHref}
                  className="cov__talk"
                  target="_blank"
                  rel="noreferrer"
                >
                  Talk to us on WhatsApp
                </a>
              }
            />
          </div>
        </div>
      </div>
    </section>
  );
}
