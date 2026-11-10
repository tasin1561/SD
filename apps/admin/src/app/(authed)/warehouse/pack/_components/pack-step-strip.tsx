'use client';

import type { ReactElement } from 'react';
import { Check, PackageCheck, PackagePlus, ScanBarcode } from 'lucide-react';
import { useT } from '@/i18n/client';

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
 * It is presentation only. It derives its state from what the bench
 * already knows and decides nothing.
 */
export function PackStepStrip({ current }: { current: 1 | 2 | 3 }): ReactElement {
  const t = useT();
  const steps = [
    { n: 1, icon: <ScanBarcode />, label: t('warehousePackSteps.one') },
    { n: 2, icon: <PackagePlus />, label: t('warehousePackSteps.two') },
    { n: 3, icon: <PackageCheck />, label: t('warehousePackSteps.three') },
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
            <span className="wh-step__label">{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
