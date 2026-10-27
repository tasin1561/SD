import { clsx } from 'clsx';
import { Asterisk, CircleDashed, Layers } from 'lucide-react';
import type { ReactElement } from 'react';
import './csv-column-guide.css';

/**
 * CsvColumnGuide — which columns of a bulk-upload template are required
 * and which are optional, shown BEFORE the seller fills anything in.
 *
 * It draws what the API hands it (`GET .../template/columns`, derived
 * from the importer's own required sets) and keeps NO list of its own, so
 * a field that becomes required later changes the page with it. All words
 * come in through `labels` so each console owns its own catalogue keys.
 *
 * Required comes in two grains for orders: a column EVERY ROW must carry,
 * and one stated ONCE PER ORDER (later rows of the same order may blank
 * it). The two are separate groups on purpose; a flat "required" list
 * tells a seller to repeat the customer on every row.
 */
export type CsvColumnLevel = 'EVERY_ROW' | 'ONCE_PER_ORDER' | 'OPTIONAL';

export interface CsvColumnGuideColumn {
  readonly field: string;
  readonly header: string;
  readonly level: CsvColumnLevel;
  readonly uatControlled: boolean;
}

export interface CsvColumnGuideLabels {
  readonly title: string;
  readonly everyRow: string;
  readonly everyRowHint: string;
  readonly oncePerOrder: string;
  readonly oncePerOrderHint: string;
  readonly optional: string;
  readonly optionalHint: string;
  /** Badge on a column that a UAT setting switched on. */
  readonly uat: string;
}

export function CsvColumnGuide({
  columns,
  labels,
  notes,
  className,
}: {
  readonly columns: readonly CsvColumnGuideColumn[];
  readonly labels: CsvColumnGuideLabels;
  /** One short line under a specific field's chip, keyed by field. */
  readonly notes?: Readonly<Record<string, string>>;
  readonly className?: string;
}): ReactElement | null {
  if (columns.length === 0) return null;
  const groups: Array<{
    level: CsvColumnLevel;
    title: string;
    hint: string;
    icon: ReactElement;
  }> = [
    {
      level: 'EVERY_ROW',
      title: labels.everyRow,
      hint: labels.everyRowHint,
      icon: <Asterisk size={14} aria-hidden />,
    },
    {
      level: 'ONCE_PER_ORDER',
      title: labels.oncePerOrder,
      hint: labels.oncePerOrderHint,
      icon: <Layers size={14} aria-hidden />,
    },
    {
      level: 'OPTIONAL',
      title: labels.optional,
      hint: labels.optionalHint,
      icon: <CircleDashed size={14} aria-hidden />,
    },
  ];
  return (
    <section className={clsx('sk-csvg', className)} aria-label={labels.title}>
      <h3 className="sk-csvg__title">{labels.title}</h3>
      {groups.map((g) => {
        const cols = columns.filter((c) => c.level === g.level);
        if (cols.length === 0) return null;
        return (
          <div key={g.level} className="sk-csvg__group" data-level={g.level}>
            <p className="sk-csvg__head">
              <span className="sk-csvg__icon">{g.icon}</span>
              <span className="sk-csvg__name">{g.title}</span>
            </p>
            <p className="sk-csvg__hint">{g.hint}</p>
            <ul className="sk-csvg__list">
              {cols.map((c) => (
                <li key={c.field} className="sk-csvg__item">
                  <span className="sk-csvg__chip">
                    {c.header}
                    {c.uatControlled ? <span className="sk-csvg__uat">{labels.uat}</span> : null}
                  </span>
                  {notes?.[c.field] !== undefined ? (
                    <span className="sk-csvg__note">{notes[c.field]}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
