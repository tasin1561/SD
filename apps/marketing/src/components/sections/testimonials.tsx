import type { ReactElement } from 'react';
import { MessageSquareQuote } from 'lucide-react';
import { business } from '@/content/site';
import { TestimonialsLoader } from '@/components/islands/loaders/testimonials-loader';
import { SectionHeading } from './section-heading';
import './sections.css';
import './testimonials.css';

/**
 * SECTION — Testimonials. A snap carousel (one card on a phone, three on
 * a desktop) with the u16 pager; every quote is the business's own and
 * marked as placeholder until it is.
 */
export function Testimonials(): ReactElement {
  return (
    <section id="testimonials" className="sec sec--band" aria-labelledby="testi-h2">
      <div className="sec__inner safe-x sm:px-6">
        <SectionHeading
          id="testi-h2"
          hue="blue"
          eyebrow="Sellers"
          icon={<MessageSquareQuote size={14} />}
          title="What sellers say"
          center
        />
        <TestimonialsLoader items={business.testimonials} />
      </div>
    </section>
  );
}
