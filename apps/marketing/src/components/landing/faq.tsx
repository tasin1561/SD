'use client';

import { useState, type ReactElement } from 'react';
import { ChevronDown } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/cn';
import { revealEase, fadeUp, staggerContainer, viewportOnce } from '@/lib/motion';

interface QA {
  q: string;
  a: string;
}

const QA_LIST: QA[] = [
  {
    q: 'Who can join?',
    a: 'BD-registered sellers. Skydrop is invite-only during beta — email hello@skydrop.online with a short pitch and we get back within a working day.',
  },
  {
    q: 'What products work best?',
    a: 'Apparel, handicrafts, beauty, packaged snacks — export-eligible goods with margin room for shipping and returns.',
  },
  {
    q: 'How does money come back to BD?',
    a: 'COD collected in India → accrued to your wallet ledger → remitted on a schedule that suits you. GST-compliant invoicing is handled on our side.',
  },
  {
    q: 'What about returns?',
    a: 'Every RTO parcel is inspected at our warehouse. You decide restock or write-off per item; stock movements are transparent and traceable.',
  },
  {
    q: 'Do I need Indian GST?',
    a: 'No — not to start. We are the operational layer, holding stock and dispatching under our GST. When you grow into needing your own Indian entity, we help you migrate.',
  },
];

export function Faq(): ReactElement {
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  const prefersReduced = useReducedMotion();

  // FAQPage JSON-LD, colocated with the visible content.
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
    <section className="bg-paper py-16 lg:py-24">
      <div className="max-w-3xl mx-auto px-5 sm:px-8">
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
        />

        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          variants={fadeUp}
        >
          <div className="inline-flex items-center gap-2 rounded-full bg-white border border-border-light px-3 py-1 text-[11px] font-mono uppercase tracking-wide text-muted">
            FAQ
          </div>
          <h2
            className="mt-4 font-display font-semibold text-ink"
            style={{ fontSize: 'clamp(1.75rem, 3.5vw, 2.75rem)', letterSpacing: '-0.02em' }}
          >
            Questions we hear often.
          </h2>
        </motion.div>

        <motion.ul
          className="mt-10 lg:mt-14 divide-y divide-border-light border-y border-border-light"
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          variants={staggerContainer}
        >
          {QA_LIST.map((qa, i) => {
            const isOpen = openIdx === i;
            return (
              <motion.li key={qa.q} variants={fadeUp}>
                <button
                  type="button"
                  onClick={() => setOpenIdx(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-panel-${i}`}
                  className="group flex w-full items-center justify-between gap-4 py-5 lg:py-6 text-left"
                >
                  <span className="font-display text-base lg:text-lg font-semibold text-ink pr-4">
                    {qa.q}
                  </span>
                  <ChevronDown
                    size={20}
                    aria-hidden="true"
                    className={cn(
                      'shrink-0 text-muted transition-transform duration-200',
                      isOpen && 'rotate-180 text-sky-deep',
                    )}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {isOpen ? (
                    <motion.div
                      id={`faq-panel-${i}`}
                      role="region"
                      key="content"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{
                        duration: prefersReduced ? 0 : 0.25,
                        ease: revealEase,
                      }}
                      className="overflow-hidden"
                    >
                      <p className="pb-6 text-[15px] text-muted leading-relaxed max-w-[62ch]">
                        {qa.a}
                      </p>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </motion.li>
            );
          })}
        </motion.ul>
      </div>
    </section>
  );
}
