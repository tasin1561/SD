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
 * The track carries only dots; one caption row under it prints the
 * current step (ellipsised, full text in `title`) and, at the right, the
 * estimated delivery or the final step. Every name is in the list for
 * assistive tech and in each dot's `title`. It is an `<ol>`, and below ~720px the
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

  const current = milestones.find((m) => m.state === 'CURRENT');
  const caption = current !== undefined ? stepText(current) : null;
  const tail =
    estimate !== undefined
      ? t('orderDetail.estimated', { date: fmtDate(estimate.at) })
      : (milestones[last]?.label ?? null);

  return (
    <div className="od-stepper-box">
      <div className="od-stepper" ref={scroller}>
        <ol className="od-stepper__list" aria-label={t('orderDetail.tracker')}>
          {milestones.map((m, i) => {
            const isCurrent = m.state === 'CURRENT';
            const skipped = m.state === 'SKIPPED';
            const text = isCurrent ? stepText(m) : m.label;
            return (
              <li
                key={m.key}
                className="od-step"
                data-state={m.state.toLowerCase()}
                data-last={i === last ? '1' : undefined}
                data-fill={i < reached ? '1' : '0'}
                aria-current={isCurrent ? 'step' : undefined}
                title={text}
              >
                <span className="od-step__node" aria-hidden>
                  {m.state === 'DONE' ? <Check size={9} strokeWidth={4} /> : null}
                </span>
                {skipped ? <span className="od-sr">{t('orderDetail.stepper.skipped')}</span> : null}
                <span className="od-step__label od-sr">{text}</span>
              </li>
            );
          })}
        </ol>
      </div>
      {/* The words live on their own row, never under the dots: a long
          courier location used to run into the estimate (owner,
          2026-11-12). The current step shrinks with an ellipsis; the
          estimate never does. Hidden from assistive tech — the list above
          already says all of it. */}
      <div className="od-stepper__caption" aria-hidden>
        <span className="od-stepper__now" title={caption ?? undefined}>
          {caption ?? milestones[0]?.label}
        </span>
        {tail !== null ? <span className="od-stepper__eta">{tail}</span> : null}
      </div>
    </div>
  );
}

/**
 * "Out for delivery · Kolkata_Baranagar_D" — not "Out for delivery · Out
 * for delivery · Kolkata…" when the courier's detail already starts with
 * the step's own name.
 */
export function stepText(m: Pick<JourneyMilestoneView, 'label' | 'detail'>): string {
  if (m.detail === null || m.detail.trim() === '') return m.label;
  const detail = m.detail.trim();
  if (detail.toLowerCase().startsWith(m.label.toLowerCase())) return detail;
  return `${m.label} · ${detail}`;
}
