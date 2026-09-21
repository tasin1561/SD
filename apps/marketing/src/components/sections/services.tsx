import type { ReactElement } from 'react';
import { Sparkles } from 'lucide-react';
import { platform } from '@/content/site';
import { ServicesClient } from '@/components/islands/services-client';
import { SectionHeading } from './section-heading';
import './sections.css';
import './services.css';

/**
 * SECTION — the four services as one scene switcher (pattern 11): picking a
 * thumbnail swaps the art, the copy, the ghost word and the tint in one
 * move. Under it, who we serve — three liquid-bead tabs (u09), each a
 * true statement about the product today.
 */
export function Services(): ReactElement {
  return (
    <section id="services" className="sec sec--band" aria-labelledby="services-h2">
      <div className="sec__inner safe-x sm:px-6">
        <SectionHeading
          id="services-h2"
          hue="saffron"
          eyebrow="What we do"
          icon={<Sparkles size={14} />}
          title="One corridor, four services"
          sub="Parcels either way across the border, stock held in India, and the whole selling operation run for you: phone-confirmed COD, a warehouse, couriers and money sent home."
        />
        <ServicesClient services={platform.services} whoWeServe={platform.whoWeServe} />
      </div>
    </section>
  );
}
