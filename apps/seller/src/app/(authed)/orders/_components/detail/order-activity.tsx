'use client';

import { Check, Minus } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import type { JourneyEntryView, JourneyMilestoneView } from '@skydrop/ui/components';
import { isCourierOwned, journeyOwnerLabel } from '@skydrop/ui/status';
import { useLocale, useT } from '@/i18n/client';
import { fmtDay, fmtFull, fmtWhen } from './format';
import { milestoneLabel } from './milestone-words';

const FIRST = 8;

type View = 'history' | 'milestones';

/**
 * Activity: the full history (our handling and the courier's scans as ONE
 * story, each line tagged with who did it) or the milestones. A segmented
 * control — a real `tablist` with arrow keys — wraps rather than scrolls.
 * The first eight rows show, then "Show all (N)" / "Show less".
 */
export function OrderActivity({
  entries,
  milestones,
}: {
  readonly entries: readonly JourneyEntryView[];
  readonly milestones: readonly JourneyMilestoneView[];
}): ReactElement {
  const t = useT();
  const uid = useId();
  const [view, setView] = useState<View>('history');
  const [all, setAll] = useState(false);
  const tabs = useRef<Record<View, HTMLButtonElement | null>>({ history: null, milestones: null });
  const items = view === 'history' ? entries : milestones;
  const shown = all ? items.length : Math.min(items.length, FIRST);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End')
      return;
    e.preventDefault();
    const next: View =
      e.key === 'Home'
        ? 'history'
        : e.key === 'End'
          ? 'milestones'
          : view === 'history'
            ? 'milestones'
            : 'history';
    setView(next);
    setAll(false);
    tabs.current[next]?.focus();
  };

  return (
    <div className="cod-act">
      <div
        className="cod-seg"
        role="tablist"
        aria-label={t('orderPage.act.view')}
        onKeyDown={onKey}
      >
        {(['history', 'milestones'] as const).map((v) => (
          <button
            key={v}
            ref={(el) => {
              tabs.current[v] = el;
            }}
            type="button"
            role="tab"
            id={`${uid}-${v}`}
            aria-selected={view === v}
            aria-controls={`${uid}-panel`}
            tabIndex={view === v ? 0 : -1}
            className="cod-seg__tab"
            onClick={() => {
              setView(v);
              setAll(false);
            }}
          >
            {t(v === 'history' ? 'orderPage.act.history' : 'orderPage.act.milestones', {
              count: v === 'history' ? entries.length : milestones.length,
            })}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-${view}`}>
        {items.length === 0 ? (
          <p className="cod-faint">{t('orderPage.act.empty')}</p>
        ) : view === 'history' ? (
          <HistoryList entries={entries.slice(0, shown)} />
        ) : (
          <MilestoneList milestones={milestones.slice(0, shown)} />
        )}
        {items.length > FIRST && (
          <button type="button" className="cod-more" onClick={() => setAll((v) => !v)}>
            {all
              ? t('orderPage.act.showLess')
              : t('orderPage.act.showAll', { count: items.length })}
          </button>
        )}
      </div>
    </div>
  );
}

function HistoryList({ entries }: { readonly entries: readonly JourneyEntryView[] }): ReactElement {
  const t = useT();
  const locale = useLocale();
  const words = { today: t('orderPage.today'), yesterday: t('orderPage.yesterday') };
  return (
    <ol className="cod-hist">
      {entries.map((e, i) => (
        <li key={`${e.at}-${i}`} className="cod-hist__row">
          <span
            aria-hidden
            className="cod-hist__dot"
            data-kind={e.attempt !== null ? 'attempt' : isCourierOwned(e.owner) ? 'courier' : 'us'}
          />
          <div className="cod-hist__body">
            <div className="cod-hist__head">
              <span className="cod-hist__title" data-attempt={e.attempt !== null ? '1' : undefined}>
                {e.title}
              </span>
              <span className="cod-hist__owner">{journeyOwnerLabel(e.owner, locale)}</span>
              <time className="cod-hist__time" dateTime={e.at} title={fmtFull(e.at, locale)}>
                {fmtWhen(e.at, locale, words)}
              </time>
            </div>
            {e.detail !== null && <div className="cod-hist__detail">{e.detail}</div>}
            {e.location !== null && <div className="cod-hist__loc">{e.location}</div>}
            {e.attempt !== null && <AttemptDetail attempt={e.attempt} />}
          </div>
        </li>
      ))}
    </ol>
  );
}

function MilestoneList({
  milestones,
}: {
  readonly milestones: readonly JourneyMilestoneView[];
}): ReactElement {
  const t = useT();
  const locale = useLocale();
  return (
    <ol className="cod-hist">
      {milestones.map((m) => (
        <li key={m.key} className="cod-hist__row" data-state={m.state.toLowerCase()}>
          <span className="cod-ms__node" aria-hidden data-state={m.state.toLowerCase()}>
            {m.state === 'DONE' ? <Check size={13} strokeWidth={3.5} /> : null}
            {m.state === 'SKIPPED' ? <Minus size={13} strokeWidth={3} /> : null}
          </span>
          <div className="cod-hist__body">
            <div className="cod-hist__head">
              <span
                className="cod-hist__title"
                data-muted={m.state === 'PENDING' || m.state === 'SKIPPED' ? '1' : undefined}
              >
                <span className="cod-sr">
                  {t(
                    m.state === 'DONE'
                      ? 'orderPage.step.done'
                      : m.state === 'CURRENT'
                        ? 'orderPage.step.current'
                        : m.state === 'SKIPPED'
                          ? 'orderPage.step.skipped'
                          : 'orderPage.step.todo',
                  )}{' '}
                </span>
                {milestoneLabel(m, t)}
              </span>
              <span className="cod-hist__owner">{journeyOwnerLabel(m.owner, locale)}</span>
              {m.state === 'SKIPPED' && (
                <span className="cod-hist__owner">{t('orderDetail.notNeeded')}</span>
              )}
              {m.at !== null && (
                <time className="cod-hist__time" dateTime={m.at} title={fmtFull(m.at, locale)}>
                  {m.estimated
                    ? t('orderPage.step.estimated', { date: fmtDay(m.at, locale) })
                    : fmtFull(m.at, locale)}
                </time>
              )}
            </div>
            {m.detail !== null && <div className="cod-hist__detail">{m.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Everything the courier told us about a failed delivery.
 *
 * Every field here was captured on every failed delivery and shown to nobody.
 * The driver's name and number in particular: Delhivery supplies them so the
 * shipper can follow up. The courier's NSL code is shown WITH its
 * interpretation, leading with what can be DONE; an unrecognised code prints as
 * itself rather than as a guess.
 */
function AttemptDetail({
  attempt,
}: {
  readonly attempt: NonNullable<JourneyEntryView['attempt']>;
}): ReactElement {
  const t = useT();
  const locale = useLocale();
  const words = { today: t('orderPage.today'), yesterday: t('orderPage.yesterday') };
  return (
    <div className="cod-attempt">
      <div className="cod-attempt__head">
        <span className="cod-attempt__title">
          {t('orderPage.act.attempt', { n: attempt.number })}
        </span>
        {attempt.reason !== null && <span>{humanise(attempt.reason)}</span>}
      </div>
      {attempt.notes !== null && <div>{attempt.notes}</div>}
      {attempt.contactedCustomer !== null && (
        <div>
          {attempt.contactedCustomer ? t('orderPage.act.reached') : t('orderPage.act.notReached')}
          {attempt.customerResponse !== null && ` — “${attempt.customerResponse}”`}
        </div>
      )}
      {attempt.nextAttemptAt !== null && (
        <div>
          {t('orderPage.act.nextAttempt', {
            when: fmtWhen(attempt.nextAttemptAt, locale, words),
          })}
        </div>
      )}
      {(attempt.agentName !== null || attempt.agentPhone !== null) && (
        <div>
          {t('orderPage.act.driver', { name: attempt.agentName ?? t('orderPage.act.unnamed') })}
          {attempt.agentPhone !== null && (
            <>
              {' · '}
              <a href={`tel:${attempt.agentPhone}`} className="cod-link">
                {attempt.agentPhone}
              </a>
            </>
          )}
        </div>
      )}
      {attempt.nsl !== null && (
        <div className="cod-attempt__nsl">
          <span className="sk-ident">{attempt.nsl.code}</span>
          {attempt.nsl.plain !== null ? (
            <> — {attempt.nsl.plain}</>
          ) : (
            <> — {t('orderPage.act.noMeaning')}</>
          )}
          {attempt.nsl.reAttemptable && ` · ${t('orderPage.act.reattempt')}`}
          {attempt.nsl.reschedulable && ` · ${t('orderPage.act.reschedule')}`}
        </div>
      )}
    </div>
  );
}

/** `CUSTOMER_UNAVAILABLE` → `Customer unavailable`. */
function humanise(v: string): string {
  const lower = v.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
