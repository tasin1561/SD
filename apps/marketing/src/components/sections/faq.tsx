import type { ReactElement } from 'react';
import {
  CircleHelp,
  FileCheck,
  LayoutDashboard,
  Store,
  Truck,
  Undo2,
  Users,
  Wallet,
} from 'lucide-react';
import { faq, faqCategories, type FaqCategoryId } from '@/content/sections/faq';
import { jsonLd } from '@/lib/json-ld';
import { FaqTabsClient } from '@/components/islands/faq-tabs-client';
import { SectionHeading } from './section-heading';
import './sections.css';
import './faq.css';

/**
 * SECTION 15 — the FAQ (u19 accordion).
 *
 * Each question is a native `<details name="faq">`: the browser gives us
 * an exclusive accordion, keyboard support and a summary that is a button
 * for free, and a reader with no JavaScript still opens every answer. The
 * panel grows on `grid-template-rows: 0fr → 1fr`, so no JS measures a
 * height and nothing jumps when the answer reflows at another width.
 *
 * The CATEGORY tabs are the only client code, and they only put an
 * attribute on the wrapper — every Q&A is in the HTML whichever tab is
 * chosen. That matters twice: the FAQPage JSON-LD below is generated from
 * the SAME array the accordion renders, and it would be advertising
 * answers the page had hidden behind a filter otherwise.
 */

const ICONS: Record<FaqCategoryId, typeof CircleHelp> = {
  sending: Truck,
  sellers: Store,
  platform: LayoutDashboard,
  reseller: Users,
  money: Wallet,
  customs: FileCheck,
  returns: Undo2,
};

/** "All" first, then the seven categories in the order the content declares. */
const TABS = [
  { id: 'all', label: 'All', hue: 'blue' },
  ...faqCategories.map((c) => ({ id: c.id, label: c.label, hue: c.hue })),
];

const HUES: Record<FaqCategoryId, string> = Object.fromEntries(
  faqCategories.map((c) => [c.id, c.hue]),
) as Record<FaqCategoryId, string>;

const SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faq.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a },
  })),
};

export function Faq(): ReactElement {
  return (
    <section id="faq" className="sec sec--raised" aria-labelledby="faq-h2">
      <div className="sec__inner safe-x sm:px-6">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(SCHEMA) }} />

        <SectionHeading
          id="faq-h2"
          hue="blue"
          eyebrow="FAQ"
          icon={<CircleHelp size={14} />}
          title="The questions we are asked before the first shipment"
          sub="Answered as the system actually works, not as a brochure would put it. If yours is not here, write to us — a real answer beats a page that hedges."
        />

        <FaqTabsClient tabs={TABS} label="Filter questions by topic">
          <ul className="faq__list">
            {faq.map((item, i) => {
              const Icon = ICONS[item.category];
              return (
                <li
                  key={item.id}
                  id={`faq-${item.id}`}
                  className="faq__item"
                  data-category={item.category}
                  data-hue={HUES[item.category]}
                  style={{ '--i': i } as React.CSSProperties}
                >
                  <details className="faq__d" name="faq">
                    <summary className="faq__q">
                      <span className="faq__ico" aria-hidden>
                        <Icon size={17} />
                      </span>
                      <h3 className="faq__qt">{item.q}</h3>
                      <svg className="faq__pm" viewBox="0 0 20 20" aria-hidden>
                        <line className="faq__pm-h" x1="5" y1="10" x2="15" y2="10" />
                        <line className="faq__pm-v" x1="5" y1="10" x2="15" y2="10" />
                      </svg>
                    </summary>
                    <div className="faq__wrap">
                      <div className="faq__well">
                        <p className="faq__a">{item.a}</p>
                      </div>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </FaqTabsClient>
      </div>
    </section>
  );
}
