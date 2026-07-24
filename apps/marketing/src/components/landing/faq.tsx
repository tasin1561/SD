'use client';

import { useState, type ReactElement } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Reveal } from '@/lib/reveal';
import { SectionHeader } from './section-header';

/**
 * SEC 07 — QUERIES. Accordion with mono indices. Panel expansion uses
 * the CSS grid-template-rows 0fr→1fr trick — no JS measurement, no
 * animation library, honors reduced-motion via the global override.
 */

interface QA {
  q: string;
  a: string;
}

const QA_LIST: QA[] = [
  {
    q: 'Who can join?',
    a: 'BD-registered sellers. Skydrop is invite-only during beta — email us and we get back within a working day.',
  },
  {
    q: 'What products work best?',
    a: 'Export-eligible goods with room for shipping and returns in the margin: apparel, handicrafts, beauty, packaged snacks.',
  },
  {
    q: 'How does money come back to Bangladesh?',
    a: 'COD is collected in India, accrued to your wallet ledger, and remitted on a schedule that suits you. GST-compliant invoicing is handled on our side.',
  },
  {
    q: 'What about returns?',
    a: 'Every RTO parcel is inspected at our warehouse. You decide restock or write-off per item; stock movements reconcile end-to-end.',
  },
  {
    q: 'Do I need Indian GST?',
    a: 'Not to start. We are the operational layer — stock is held and dispatched under our GST. When you outgrow that, we help you migrate to your own Indian entity.',
  },
];

export function Faq(): ReactElement {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: QA_LIST.map((qa) => ({
      '@type': 'Question',
      name: qa.q,
      acceptedAnswer: { '@type': 'Answer', text: qa.a },
    })),
  };

  return (
    <section className="bg-surface py-20 lg:py-28 border-t border-line">
      <div className="max-w-3xl mx-auto px-5 sm:px-8">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
        />

        <SectionHeader index="07" code="QUERIES" title="Questions we hear often." />

        <ul className="mt-12 divide-y divide-line border-y border-line list-none p-0">
          {QA_LIST.map((qa, i) => {
            const isOpen = openIdx === i;
            const idx = String(i + 1).padStart(2, '0');
            return (
              <Reveal as="li" key={qa.q} delay={i * 50}>
                <button
                  type="button"
                  onClick={() => setOpenIdx(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-panel-${i}`}
                  className="group flex w-full items-center gap-4 py-5 lg:py-6 text-left"
                >
                  <span className={cn('telemetry shrink-0', isOpen ? 'text-sky' : 'text-fg-muted')}>
                    Q.{idx}
                  </span>
                  <span className="flex-1 font-display text-base lg:text-lg font-semibold text-fg-strong pr-2">
                    {qa.q}
                  </span>
                  <ChevronDown
                    size={20}
                    aria-hidden="true"
                    className={cn(
                      'shrink-0 text-fg-muted transition-transform duration-200',
                      isOpen && 'rotate-180 text-sky',
                    )}
                  />
                </button>
                <div
                  id={`faq-panel-${i}`}
                  role="region"
                  className="faq-panel"
                  {...(isOpen ? { 'data-open': '' } : {})}
                >
                  <div>
                    <p className="pb-6 pl-12 text-[15px] text-fg-body leading-relaxed max-w-[62ch] m-0">
                      {qa.a}
                    </p>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
