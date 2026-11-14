'use client';

import type { ReactElement } from 'react';
import { Check, PackageCheck, PackagePlus, ScanBarcode } from 'lucide-react';
import { useLocale, useT } from '@/i18n/client';

/**
 * The whole pack job, as three numbered steps, permanently on screen.
 *
 * ── WHY ──────────────────────────────────────────────────────────────
 * The packers here are amateurs, often barely literate, and may read no
 * English. The bench used to be a wall of small grey sentences, so the
 * only way to know what to do next was to read one. This strip answers
 * "where am I and what do I do now" from across a bench:
 *
 *   1  scan the box label   2  scan every product   3  scan the label again
 *
 * The TEST of it is that it is followable with the words covered up. The
 * big numeral, the icon and the fill carry the meaning; the words are a
 * bonus. Done steps turn into a tick, the current one is filled and
 * breathes gently, and the connector between them fills up to where you
 * are — so colour is never the only signal (a colour-blind packer reads
 * the numeral, the tick and the position).
 *
 * ── ONE LANGUAGE: THE ONE THE CONSOLE IS SET TO (2026-11-14, owner) ──
 * From 2026-11-10 the words under each step were English, বাংলা and हिन्दी
 * stacked together. The owner asked for only the chosen language: with
 * English selected the strip reads in English, and so on. Three stacked
 * lines under three steps was a lot of small text on a bench screen, and
 * the numeral, the icon and the fill already carry the step for someone
 * who reads none of them.
 *
 * The three short wordings are kept, one per language, and stay SHORTER
 * than the catalogue sentences they echo so a step fits a 360px phone.
 * The catalogue sentence is still the step's ACCESSIBLE name.
 *
 * The refusal dialog (`pack-error-copy.ts`) is a different thing and still
 * shows all three languages: it appears when something has gone wrong,
 * which is the moment a packer most needs to be able to read it.
 *
 * It is presentation only. It derives its state from what the bench
 * already knows and decides nothing.
 */

/** One step's words, short, one per language. Western numerals everywhere. */
export interface PackStepTriple {
  readonly en: string;
  readonly bn: string;
  readonly hi: string;
}

/**
 * Step 1, 2, 3 — three words per language at most.
 *
 * The verb is kept in every language rather than trimmed to a noun
 * phrase: "label again" reads as a riddle to somebody who is reading
 * slowly, and the whole point of the strip is to be followable by them.
 */
export const PACK_STEP_TRIPLES: readonly [PackStepTriple, PackStepTriple, PackStepTriple] = [
  {
    en: 'Scan box label',
    bn: 'বাক্সের লেবেল স্ক্যান করুন',
    hi: 'डिब्बे का लेबल स्कैन करें',
  },
  {
    en: 'Scan each product',
    bn: 'প্রতিটি পণ্য স্ক্যান করুন',
    hi: 'हर सामान स्कैन करें',
  },
  {
    en: 'Scan label again',
    bn: 'আবার লেবেল স্ক্যান করুন',
    hi: 'लेबल दोबारा स्कैन करें',
  },
];

export function PackStepStrip({ current }: { current: 1 | 2 | 3 }): ReactElement {
  const t = useT();
  const locale = useLocale();
  // Only the three languages the strip is written in; anything else reads English.
  const lang: keyof PackStepTriple = locale === 'bn' || locale === 'hi' ? locale : 'en';
  const steps = [
    { n: 1, icon: <ScanBarcode />, label: t('warehousePackSteps.one'), tri: PACK_STEP_TRIPLES[0] },
    { n: 2, icon: <PackagePlus />, label: t('warehousePackSteps.two'), tri: PACK_STEP_TRIPLES[1] },
    {
      n: 3,
      icon: <PackageCheck />,
      label: t('warehousePackSteps.three'),
      tri: PACK_STEP_TRIPLES[2],
    },
  ] as const;

  return (
    <ol className="wh-steps" aria-label={t('warehousePackSteps.theThreeStepsOfPacking')}>
      {steps.map((s) => {
        const state = s.n < current ? 'done' : s.n === current ? 'now' : 'todo';
        return (
          <li key={s.n} className="wh-step" data-state={state} aria-current={state === 'now'}>
            <span className="wh-step__rail" aria-hidden />
            <span className="wh-step__chip" aria-hidden>
              {/* The numeral stays BEHIND the icon on a done step as a tick:
                  two signals, never one. */}
              <span className="wh-step__num">{state === 'done' ? <Check /> : s.n}</span>
            </span>
            <span className="wh-step__icon" aria-hidden>
              {s.icon}
            </span>
            {/* The translated sentence is for assistive tech; the short
                wording below is what the eye reads, in the chosen language. */}
            <span className="wh-sr">{s.label}</span>
            <span className="wh-step__label wh-step__tri" aria-hidden>
              <span className="wh-step__line wh-step__line--lead wh-step__line--only" lang={lang}>
                {s.tri[lang]}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
