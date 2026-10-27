'use client';

import { useId, type ReactElement, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { TooltipCard } from '@skydrop/ui/app/tooltip-card';
import type { CsvColumnGuideColumn, CsvColumnLevel } from '@skydrop/ui/app/csv-column-guide';
import './import-page.css';

/**
 * The compact view of the bulk-import page. Pure presentation: every
 * decision (which step, which columns, what is open) is passed in from
 * the panel's existing state and the importer's own column data.
 */

/** One slim row of four steps; collapses to "Step n of 4 · label" on a phone. */
export function ImportSteps({
  label,
  steps,
  current,
  doneThrough,
  mobileText,
}: {
  readonly label: string;
  readonly steps: readonly string[];
  /** 1-based index of the highlighted step. */
  readonly current: number;
  /** 1-based; every step up to and including this one shows a tick. */
  readonly doneThrough: number;
  readonly mobileText: string;
}): ReactElement {
  return (
    <div className="imp-steps">
      <ol className="imp-steps__list" aria-label={label}>
        {steps.map((s, i) => {
          const n = i + 1;
          const done = n <= doneThrough;
          return (
            <li
              key={s}
              className="imp-step"
              data-state={n === current ? 'current' : done ? 'done' : 'todo'}
              aria-current={n === current ? 'step' : undefined}
            >
              <span className="imp-step__dot" aria-hidden>
                {done ? <Check size={12} strokeWidth={3} /> : n}
              </span>
              <span className="imp-step__label">{s}</span>
              {n < steps.length ? (
                <ChevronRight size={14} className="imp-step__sep" aria-hidden />
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="imp-steps__mobile">{mobileText}</p>
    </div>
  );
}

export interface GuideChipLabels {
  readonly groupEvery: string;
  readonly groupOnce: string;
  readonly groupOptional: string;
  readonly example: (sample: string) => string;
  readonly important: string;
  readonly ignored: (count: number) => string;
  readonly fullGuide: string;
  readonly title: string;
}

const GROUPS: ReadonlyArray<{
  level: CsvColumnLevel;
  key: 'groupEvery' | 'groupOnce' | 'groupOptional';
  tone: 'accent' | 'neutral';
}> = [
  { level: 'EVERY_ROW', key: 'groupEvery', tone: 'accent' },
  { level: 'ONCE_PER_ORDER', key: 'groupOnce', tone: 'accent' },
  { level: 'OPTIONAL', key: 'groupOptional', tone: 'neutral' },
];

/**
 * The right-hand card. Groups are derived from the SAME `level` field the
 * full `CsvColumnGuide` table draws, so a column that becomes required
 * moves group by itself; nothing here lists a column. NOT_USED columns are
 * only counted. `warnFields` get a warning dot (Address Line2 is the most
 * common reason a whole file fails), with the reason in the tooltip.
 */
export function CompactColumnGuide({
  columns,
  notes,
  labels,
  warnFields,
  open,
  onToggle,
  panelId,
}: {
  readonly columns: readonly CsvColumnGuideColumn[];
  readonly notes: Readonly<Record<string, string>>;
  readonly labels: GuideChipLabels;
  readonly warnFields: readonly string[];
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly panelId: string;
}): ReactElement {
  const ignored = columns.filter((c) => c.level === 'NOT_USED').length;
  return (
    <section className="imp-card imp-guide" aria-label={labels.title}>
      <h2 className="imp-guide__title">{labels.title}</h2>
      <div className="imp-guide__groups">
        {GROUPS.map((g) => {
          const cols = columns.filter((c) => c.level === g.level);
          if (cols.length === 0) return null;
          return (
            <div key={g.level} className="imp-group">
              <h3 className="imp-group__label">{labels[g.key]}</h3>
              <ul className="imp-group__chips">
                {cols.map((c) => {
                  const warn = warnFields.includes(c.field);
                  const note = notes[c.field] ?? '';
                  const sample = c.sample !== undefined && c.sample !== '' ? c.sample : null;
                  return (
                    <li key={c.field} className="imp-chipwrap">
                      <TooltipCard
                        layer="fixed"
                        title={c.header}
                        description={
                          <>
                            {note}
                            {sample !== null ? (
                              <span className="imp-chip__eg">{labels.example(sample)}</span>
                            ) : null}
                          </>
                        }
                      >
                        <button
                          type="button"
                          className="imp-chip"
                          data-tone={g.tone}
                          data-warn={warn || undefined}
                        >
                          <span className="imp-chip__text">{c.header}</span>
                          {warn ? (
                            <>
                              <span className="imp-chip__dot" aria-hidden />
                              <span className="imp-sr">{labels.important}</span>
                            </>
                          ) : null}
                        </button>
                      </TooltipCard>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="imp-guide__foot">
        <span className="imp-guide__ignored">{labels.ignored(ignored)}</span>
        <button
          type="button"
          className="imp-guide__toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
        >
          {labels.fullGuide}
          <ChevronDown
            size={14}
            aria-hidden
            className="imp-guide__chev"
            data-open={open || undefined}
          />
        </button>
      </div>
    </section>
  );
}

/** Animated disclosure (grid rows 0fr to 1fr) holding the existing full guide. */
export function GuideDisclosure({
  open,
  id,
  children,
}: {
  readonly open: boolean;
  readonly id: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div id={id} className="imp-disclosure" data-open={open || undefined} inert={!open}>
      <div className="imp-disclosure__inner">{children}</div>
    </div>
  );
}

export function useGuidePanelId(): string {
  return `imp-guide-${useId()}`;
}
