import type { ReactElement } from 'react';
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
        <p className="partners__k">Booked through the couriers India already trusts</p>
        <ul className="partners__list">
          {business.partners.map((p) => (
            <li key={p} className="partners__chip">
              <span className="partners__ico" aria-hidden>
                <Truck size={14} />
              </span>
              {p}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
