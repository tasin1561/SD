'use client';

import { Check, ChevronDown, Minus } from 'lucide-react';
import { useId, useState, type ReactElement } from 'react';
import type { JourneyMilestoneView } from '@skydrop/ui/components';
import { journeyOwnerLabel } from '@skydrop/ui/status';
import { useLocale, useT } from '@/i18n/client';
import { fmtDay, fmtFull, fmtWhen } from './format';
import { milestoneLabel } from './milestone-words';

/**
 * The order's progress. Wide: every step a node on one line, the owner group
 * ("Skydrop" / "Courier") above the steps it owns, a short time under each
 * reached step, and the labels of the last finished, the current and the next
 * step always in full (the rest fold away on a narrow container, but stay in
 * the list for assistive tech and in each step's title). Narrow: "Step 2 of 9:
 * Confirmed by phone" with a progress bar and a "See all steps" disclosure.
 * Never scrolls sideways.
 *
 * An `<ol>`; the current step carries `aria-current="step"`, and every step
 * says its state in words ("Completed:", "Current step:", "Still to come:",
 * "Skipped:") so colour is never the only signal.
 */
export function OrderStepper({
  milestones,
}: {
  readonly milestones: readonly JourneyMilestoneView[];
}): ReactElement | null {
  const t = useT();
  const locale = useLocale();
  const uid = useId();
  const [showAll, setShowAll] = useState(false);
  if (milestones.length === 0) return null;
  const words = { today: t('orderPage.today'), yesterday: t('orderPage.yesterday') };

  let reached = -1;
  milestones.forEach((m, i) => {
    if (m.state === 'DONE' || m.state === 'CURRENT') reached = i;
  });
  const currentIdx = milestones.findIndex((m) => m.state === 'CURRENT');
  const focusIdx = currentIdx >= 0 ? currentIdx : Math.max(reached, 0);
  const nextIdx = milestones.findIndex((m, i) => i > focusIdx && m.state === 'PENDING');
  const lastDoneIdx = (() => {
    for (let i = focusIdx - 1; i >= 0; i--) if (milestones[i]?.state === 'DONE') return i;
    return -1;
  })();
  const isKey = (i: number): boolean => i === focusIdx || i === nextIdx || i === lastDoneIdx;
  const focus = milestones[focusIdx];

  // Contiguous runs of the same owner, for the group labels above the steps.
  const groups: Array<{ owner: JourneyMilestoneView['owner']; span: number }> = [];
  for (const m of milestones) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.owner === m.owner) last.span += 1;
    else groups.push({ owner: m.owner, span: 1 });
  }

  const stateWord = (m: JourneyMilestoneView): string =>
    m.state === 'DONE'
      ? t('orderPage.step.done')
      : m.state === 'CURRENT'
        ? t('orderPage.step.current')
        : m.state === 'SKIPPED'
          ? t('orderPage.step.skipped')
          : t('orderPage.step.todo');

  const timeOf = (m: JourneyMilestoneView): string | null => {
    if (m.state === 'SKIPPED') return t('orderDetail.notNeeded');
    if (m.at === null) return null;
    return m.estimated
      ? t('orderPage.step.estimated', { date: fmtDay(m.at, locale) })
      : fmtWhen(m.at, locale, words);
  };

  return (
    <section className="cod-stepper" aria-label={t('orderPage.step.label')}>
      {/* WIDE */}
      <div className="cod-stepper__wide" style={{ ['--n' as string]: milestones.length }}>
        <div className="cod-stepper__groups" aria-hidden>
          {groups.map((g, i) => (
            <span
              key={`${g.owner}-${i}`}
              className="cod-stepper__group"
              style={{ gridColumn: `span ${g.span}` }}
            >
              {journeyOwnerLabel(g.owner, locale)}
            </span>
          ))}
        </div>
        <ol className="cod-stepper__list">
          {milestones.map((m, i) => {
            const label = milestoneLabel(m, t);
            const time = timeOf(m);
            return (
              <li
                key={m.key}
                className="cod-step"
                data-state={m.state.toLowerCase()}
                data-key={isKey(i) ? '1' : '0'}
                data-fill={i < reached ? '1' : '0'}
                data-first={i === 0 ? '1' : undefined}
                aria-current={m.state === 'CURRENT' ? 'step' : undefined}
                title={m.at !== null ? `${label} — ${fmtFull(m.at, locale)}` : label}
              >
                <span className="cod-step__node" aria-hidden>
                  {m.state === 'DONE' ? <Check size={13} strokeWidth={3.5} /> : null}
                  {m.state === 'SKIPPED' ? <Minus size={13} strokeWidth={3} /> : null}
                </span>
                <span className="cod-step__label">
                  <span className="cod-sr">{stateWord(m)} </span>
                  {label}
                  <span className="cod-sr">, {journeyOwnerLabel(m.owner, locale)}</span>
                </span>
                {time !== null ? <span className="cod-step__time">{time}</span> : null}
                {m.state === 'CURRENT' && m.detail !== null ? (
                  <span className="cod-step__detail" title={m.detail}>
                    {m.detail}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>

      {/* NARROW */}
      <div className="cod-stepper__narrow">
        <p className="cod-stepper__of">
          {t('orderPage.step.of', {
            n: focusIdx + 1,
            total: milestones.length,
            label: focus === undefined ? '' : milestoneLabel(focus, t),
          })}
        </p>
        <div className="cod-stepper__bar" aria-hidden>
          <span
            className="cod-stepper__barfill"
            style={{ transform: `scaleX(${(focusIdx + 1) / milestones.length})` }}
          />
        </div>
        {focus !== undefined && timeOf(focus) !== null ? (
          <p className="cod-stepper__sub">
            {timeOf(focus)}
            {focus.detail !== null ? ` · ${focus.detail}` : ''}
          </p>
        ) : null}
        <button
          type="button"
          className="cod-disc__btn"
          aria-expanded={showAll}
          aria-controls={`${uid}-all`}
          onClick={() => setShowAll((v) => !v)}
        >
          <ChevronDown size={16} aria-hidden />
          {showAll ? t('orderPage.step.hideAll') : t('orderPage.step.seeAll')}
        </button>
        <div className="cod-card__wrap" id={`${uid}-all`} data-open={showAll ? '1' : '0'}>
          <div className="cod-card__inner" {...(showAll ? {} : { inert: true })}>
            <ol className="cod-stepper__full">
              {milestones.map((m) => {
                const time = timeOf(m);
                return (
                  <li
                    key={m.key}
                    data-state={m.state.toLowerCase()}
                    aria-current={m.state === 'CURRENT' ? 'step' : undefined}
                  >
                    <span className="cod-step__node" aria-hidden>
                      {m.state === 'DONE' ? <Check size={13} strokeWidth={3.5} /> : null}
                      {m.state === 'SKIPPED' ? <Minus size={13} strokeWidth={3} /> : null}
                    </span>
                    <span className="cod-stepper__fulltext">
                      <span className="cod-stepper__fulllabel">
                        <span className="cod-sr">{stateWord(m)} </span>
                        {milestoneLabel(m, t)}
                      </span>
                      <span className="cod-stepper__fullmeta">
                        {journeyOwnerLabel(m.owner, locale)}
                        {time !== null ? ` · ${time}` : ''}
                        {m.detail !== null ? ` · ${m.detail}` : ''}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
