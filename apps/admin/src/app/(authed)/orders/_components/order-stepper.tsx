'use client';

import { Check } from 'lucide-react';
import { useEffect, useRef, type ReactElement } from 'react';
import type { JourneyMilestoneView } from '@skydrop/ui/components';
import { useT } from '@/i18n/client';
import { fmtDate } from './order-detail-format';

/**
 * The order's progress as one compact row: every milestone the tracker
 * knows, a node each. Completed nodes are filled, the current one is
 * emphasised and carries `aria-current="step"`, future ones are muted, and
 * a SKIPPED one (a step a later one overtook — "Ready to dispatch" on a
 * parcel that went straight through) is dashed and hollow with a
 * screen-reader "Skipped", so it never reads as simply "not yet".
 *
 * Only the first, the current and the last steps print their name; the
 * rest are in the list for assistive tech and in `title`. The estimated
 * delivery sits at the right end. It is an `<ol>`, and below ~720px the
 * row scrolls sideways with the current step brought into view.
 */
export function OrderStepper({
  milestones,
}: {
  readonly milestones: readonly JourneyMilestoneView[];
}): ReactElement | null {
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  const currentKey = milestones.find((m) => m.state === 'CURRENT')?.key;

  // Bring the current step into view on a narrow screen. Smooth only when
  // the person has not asked for reduced motion.
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>('[aria-current="step"]');
    if (el === null || el === undefined || scroller.current === null) return;
    const box = scroller.current;
    if (box.scrollWidth <= box.clientWidth) return;
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const left = el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2;
    if (typeof box.scrollTo === 'function') {
      box.scrollTo({ left: Math.max(0, left), behavior: reduced ? 'auto' : 'smooth' });
    } else {
      box.scrollLeft = Math.max(0, left);
    }
  }, [currentKey, milestones.length]);

  if (milestones.length === 0) return null;
  const last = milestones.length - 1;
  // The furthest step reached: the line is filled up to it, so a skipped
  // step in the middle does not break the run.
  let reached = -1;
  milestones.forEach((m, i) => {
    if (m.state === 'DONE' || m.state === 'CURRENT') reached = i;
  });
  const estimate = milestones.find((m) => m.estimated && m.at !== null);

  return (
    <div className="od-stepper" ref={scroller}>
      <ol className="od-stepper__list" aria-label={t('orderDetail.tracker')}>
        {milestones.map((m, i) => {
          const current = m.state === 'CURRENT';
          const skipped = m.state === 'SKIPPED';
          const showLabel = current || i === 0 || (i === last && estimate === undefined);
          const text = current && m.detail !== null ? `${m.label} · ${m.detail}` : m.label;
          return (
            <li
              key={m.key}
              className="od-step"
              data-state={m.state.toLowerCase()}
              data-first={i === 0 ? '1' : undefined}
              data-last={i === last ? '1' : undefined}
              data-fill={i < reached ? '1' : '0'}
              aria-current={current ? 'step' : undefined}
              title={text}
            >
              <span className="od-step__node" aria-hidden>
                {m.state === 'DONE' ? <Check size={9} strokeWidth={4} /> : null}
              </span>
              {skipped ? <span className="od-sr">{t('orderDetail.stepper.skipped')}</span> : null}
              <span className={showLabel ? 'od-step__label' : 'od-step__label od-sr'}>{text}</span>
            </li>
          );
        })}
      </ol>
      {estimate !== undefined ? (
        <span className="od-stepper__eta">
          {t('orderDetail.estimated', { date: fmtDate(estimate.at) })}
        </span>
      ) : null}
    </div>
  );
}
