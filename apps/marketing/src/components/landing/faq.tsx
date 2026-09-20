'use client';

import { useState, type ReactElement } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Chip, SectionHead } from './chrome';

/**
 * SEC 07 — QUERIES.
 *
 * Panel expansion uses the CSS grid-template-rows 0fr→1fr trick: no JS
 * measures a height, so nothing jumps when the answer reflows at a
 * different width, and reduced-motion is handled by the global
 * override rather than by a branch in here.
 *
 * The FAQPage JSON-LD is generated from the SAME array the accordion
 * renders — a second hand-written copy is how the structured data ends
 * up advertising an answer the page no longer gives.
 */

interface QA {
  q: string;
  a: string;
}

const QA_LIST: QA[] = [
  {
    q: 'Who can join?',
    a: 'Sellers registered in Bangladesh. Skydrop is invite-only through the beta — write to us with a little about your store and we reply within one working day.',
  },
  {
    q: 'What kind of products work in this corridor?',
    a: 'Export-eligible goods with enough margin to absorb shipping and the occasional return: apparel, handicrafts, beauty, packaged snacks. Anything heavy, fragile or restricted at the border is a poor fit, and we will say so rather than let you find out with a consignment.',
  },
  {
    q: 'How does the money get back to Bangladesh?',
    a: 'COD is collected in rupees in India and credited to your ledger as the courier settles it, net of the charges for those orders. It is then remitted to you on a schedule that suits you. GST-compliant invoicing is handled on our side.',
  },
  {
    q: 'What happens to a parcel that comes back?',
    a: 'Every returned parcel is received and opened at our warehouse and inspected item by item. You decide whether each unit is restocked or written off, and the stock ledger moves to match — so what you are told you own is what is actually on the shelf.',
  },
  {
    q: 'Do I need an Indian GST registration?',
    a: 'Not to start. We are the operational layer: stock is held and dispatched under ours. If you grow to the point where your own Indian entity makes more sense, we help you move to it rather than holding you there.',
  },
  {
    q: 'What does it cost?',
    a: 'A flat delivery fee per order, agreed with you before you ship anything, plus a fee on a parcel that has to come back. There is no Indian company to register and no warehouse to lease. The exact figures depend on what you are sending, so they are settled when we talk rather than guessed at on this page.',
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
    <section id="faq" className="border-t border-line bg-surface py-16 lg:py-24">
      <div className="mx-auto max-w-4xl px-5 sm:px-6">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
        />

        <SectionHead
          index="07"
          code="queries"
          flag={<Chip>{`${QA_LIST.length} answered`}</Chip>}
          title="Questions we are asked often."
          sub="If yours is not here, write to us — a real answer beats a page that hedges."
        />

        <ul className="m-0 list-none overflow-hidden rounded-lg border border-line bg-surface-2 p-0">
          {QA_LIST.map((qa, i) => {
            const isOpen = openIdx === i;
            const idx = String(i + 1).padStart(2, '0');
            return (
              <li key={qa.q} className={i > 0 ? 'border-t border-line' : ''}>
                <h3 className="m-0">
                  <button
                    type="button"
                    onClick={() => setOpenIdx(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    aria-controls={`faq-panel-${i}`}
                    className="flex w-full items-center gap-3.5 px-4 py-4 text-left transition-colors hover:bg-surface-3/50 sm:px-5"
                  >
                    <span
                      className={cn('mono-caps shrink-0', isOpen ? 'text-sky' : 'text-fg-faint')}
                    >
                      q.{idx}
                    </span>
                    <span className="flex-1 pr-2 text-[15px] font-bold text-fg-strong sm:text-[16px]">
                      {qa.q}
                    </span>
                    <Plus
                      size={18}
                      aria-hidden="true"
                      className={cn(
                        'shrink-0 transition-transform duration-200',
                        isOpen ? 'rotate-45 text-sky' : 'text-fg-muted',
                      )}
                    />
                  </button>
                </h3>
                <div
                  id={`faq-panel-${i}`}
                  role="region"
                  className="faq-panel"
                  {...(isOpen ? { 'data-open': '' } : {})}
                >
                  <div>
                    <p className="m-0 max-w-[68ch] px-4 pb-5 pl-4 text-[14px] leading-relaxed text-fg-body sm:pl-[4.6rem] sm:pr-5">
                      {qa.a}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
