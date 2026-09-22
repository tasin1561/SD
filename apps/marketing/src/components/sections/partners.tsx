import type { ReactElement } from 'react';
import { Reveal } from '@/lib/reveal';
import { Truck } from 'lucide-react';
import { business } from '@/content/site';
import './sections.css';
import './partners.css';

/**
 * SECTION — the courier strip. Names only, as chips with a van glyph: the
 * companies whose vans actually carry the parcel. Server-rendered.
 */
export function Partners(): ReactElement {
  return (
    <section className="sec sec--band partners" aria-label="Couriers we book through">
      <div className="sec__inner safe-x sm:px-6">
        <p className="partners__k">Booked through</p>
        <ul className="partners__list">
          {business.partners.map((p, i) => (
            <Reveal as="li" key={p} delay={i * 60} className="partners__chip">
              <span className="partners__ico" aria-hidden>
                <Truck size={14} />
              </span>
              {p}
            </Reveal>
          ))}
          <li className="partners__more">— {business.partnersLine}</li>
        </ul>
      </div>
    </section>
  );
}
