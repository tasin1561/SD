'use client';

import type { ReactElement } from 'react';
import { Quote } from 'lucide-react';
import { Carousel } from '@/components/micro/carousel';
import type { business } from '@/content/site';

type T = (typeof business.testimonials)[number];

export function TestimonialsClient({ items }: { items: readonly T[] }): ReactElement {
  return (
    <Carousel
      label="Seller testimonials"
      items={items.map((t) => ({
        id: t.name,
        node: (
          <figure className="testi__card sec-card">
            <span className="testi__mark" aria-hidden>
              <Quote size={18} />
            </span>
            <blockquote className="testi__quote">“{t.quote}”</blockquote>
            <figcaption className="testi__who">
              <span className="testi__name">{t.name}</span>
              <span>
                {t.role}, {t.company}
              </span>
            </figcaption>
          </figure>
        ),
      }))}
    />
  );
}
