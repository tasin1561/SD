import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import './csv-column-guide.css';

/**
 * CsvColumnGuide — the Glossary of a bulk-upload template: one row per
 * column with TITLE, MANDATORY, DESCRIPTION and SAMPLE, shown BEFORE the
 * seller fills anything in.
 *
 * It draws what the API hands it (`GET .../template/columns`, derived from
 * the importer's own required sets and the template's own sample row) and
 * keeps NO column list of its own, so a field that becomes required later
 * changes the page with it. All words come in through `labels` so each
 * console owns its own catalogue keys.
 *
 * MANDATORY has THREE states, not two. A column we ship but deliberately
 * ignore is `NOT_USED`: calling it "optional" would tell a seller it does
 * something. Required orders columns keep their two grains as a caption
 * under the Yes pill: every row, or once per order.
 */
export type CsvColumnLevel = 'EVERY_ROW' | 'ONCE_PER_ORDER' | 'OPTIONAL' | 'NOT_USED';

export interface CsvColumnGuideColumn {
  readonly field: string;
  readonly header: string;
  readonly level: CsvColumnLevel;
  readonly uatControlled: boolean;
  /** The template's own sample cell. */
  readonly sample?: string;
  /** Why the column is not used (NOT_USED only), written for a person. */
  readonly description?: string | null;
}

export interface CsvColumnGuideLabels {
  readonly title: string;
  readonly colTitle: string;
  readonly colMandatory: string;
  readonly colDescription: string;
  readonly colSample: string;
  readonly yes: string;
  readonly no: string;
  readonly notUsed: string;
  readonly everyRow: string;
  readonly everyRowHint: string;
  readonly oncePerOrder: string;
  readonly oncePerOrderHint: string;
  /** Badge on a column that a UAT setting switched on. */
  readonly uat: string;
}

/** The pill's word and tone for each level. Exported so tests can pin the three states. */
export function mandatoryState(level: CsvColumnLevel): 'yes' | 'no' | 'notUsed' {
  if (level === 'NOT_USED') return 'notUsed';
  return level === 'OPTIONAL' ? 'no' : 'yes';
}

export function CsvColumnGuide({
  columns,
  labels,
  notes,
  className,
}: {
  readonly columns: readonly CsvColumnGuideColumn[];
  readonly labels: CsvColumnGuideLabels;
  /** Description for a mapped field, keyed by field (NOT_USED rows use the API's reason). */
  readonly notes?: Readonly<Record<string, string>>;
  readonly className?: string;
}): ReactElement | null {
  if (columns.length === 0) return null;
  const hasOnce = columns.some((c) => c.level === 'ONCE_PER_ORDER');
  const hasEvery = columns.some((c) => c.level === 'EVERY_ROW');
  const word = { yes: labels.yes, no: labels.no, notUsed: labels.notUsed } as const;
  return (
    <section className={clsx('sk-csvg', className)} aria-label={labels.title}>
      <h3 className="sk-csvg__title">{labels.title}</h3>
      {hasEvery || hasOnce ? (
        <ul className="sk-csvg__legend">
          {hasEvery ? (
            <li>
              <strong>{labels.everyRow}</strong> {labels.everyRowHint}
            </li>
          ) : null}
          {hasOnce ? (
            <li>
              <strong>{labels.oncePerOrder}</strong> {labels.oncePerOrderHint}
            </li>
          ) : null}
        </ul>
      ) : null}
      <div className="sk-csvg__table" role="table" aria-label={labels.title}>
        <div className="sk-csvg__row sk-csvg__row--head" role="row">
          <span role="columnheader">{labels.colTitle}</span>
          <span role="columnheader">{labels.colMandatory}</span>
          <span role="columnheader">{labels.colDescription}</span>
          <span role="columnheader">{labels.colSample}</span>
        </div>
        {columns.map((c) => {
          const state = mandatoryState(c.level);
          const description =
            c.level === 'NOT_USED' ? (c.description ?? '') : (notes?.[c.field] ?? '');
          return (
            <div key={c.field} className="sk-csvg__row" role="row" data-level={c.level}>
              <span role="cell" className="sk-csvg__cell sk-csvg__cell--title">
                {c.header}
                {c.uatControlled ? <span className="sk-csvg__uat">{labels.uat}</span> : null}
              </span>
              <span role="cell" className="sk-csvg__cell sk-csvg__cell--flag">
                <span className="sk-csvg__pill" data-state={state}>
                  {word[state]}
                </span>
                {c.level === 'EVERY_ROW' || c.level === 'ONCE_PER_ORDER' ? (
                  <span className="sk-csvg__grain">
                    {c.level === 'EVERY_ROW' ? labels.everyRow : labels.oncePerOrder}
                  </span>
                ) : null}
              </span>
              <span role="cell" className="sk-csvg__cell sk-csvg__cell--desc">
                {description}
              </span>
              <span role="cell" className="sk-csvg__cell sk-csvg__cell--sample">
                {c.sample !== undefined && c.sample !== '' ? c.sample : null}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
