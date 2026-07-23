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
  const prefersReduced = useReducedMotion();

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
    <section className="bg-surface py-16 lg:py-24">
      <div className="max-w-3xl mx-auto px-5 sm:px-8">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
        />

        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          variants={fadeUp}
        >
          <div className="inline-flex items-center gap-2 rounded-full bg-surface-2 border border-line px-3 py-1 text-[11px] font-mono uppercase tracking-wide text-fg-muted">
            FAQ
          </div>
          <h2
            className="mt-4 font-display font-semibold text-fg-strong"
            style={{ fontSize: 'clamp(1.75rem, 3.5vw, 2.75rem)', letterSpacing: '-0.02em' }}
          >
            Questions we hear often.
          </h2>
        </motion.div>

        <motion.ul
          className="mt-10 lg:mt-14 divide-y divide-line border-y border-line"
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
                  <span className="font-display text-base lg:text-lg font-semibold text-fg-strong pr-4">
                    {qa.q}
                  </span>
                  <ChevronDown
                    size={20}
                    aria-hidden="true"
                    className={cn(
                      'shrink-0 text-fg-muted transition-transform duration-200',
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
                        ease: revealEase as unknown as number[],
                      }}
                      className="overflow-hidden"
                    >
                      <p className="pb-6 text-[15px] text-fg-muted leading-relaxed max-w-[62ch]">
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
