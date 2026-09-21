import type { ReactElement, ReactNode } from 'react';
import { Check, Minus, X } from 'lucide-react';
import './data-table.css';

/** The BENEFIT to the reader — colour never means the literal yes/no. */
export type CellKind = 'good' | 'bad' | 'mixed' | 'text';
export interface TableCell {
  kind: CellKind;
  label?: string;
  /** An estimate rather than something we measure — marked so. */
  estimate?: boolean;
}

/**
 * 30 · Data table (u07). An accent-tinted header row, chips coloured by the
 * BENEFIT to the reader — good / bad / mixed (icon + word, never colour alone), row hover that tints and
 * lifts the row, the first column sticky on a narrow screen. Below `md`
 * the SAME markup becomes swipe cards — one card per column — through
 * CSS only.
 */
export function DataTable({
  columns,
  rows,
  caption,
  className,
}: {
  columns: readonly { key: string; name: string; note?: string; primary?: boolean }[];
  rows: readonly { label: string; cells: Record<string, TableCell> }[];
  caption: string;
  className?: string;
}): ReactElement {
  return (
    <div className={`dt ${className ?? ''}`}>
      <table className="dt__table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="dt__corner" />
            {columns.map((c) => (
              <th key={c.key} scope="col" className="dt__col" data-primary={c.primary || undefined}>
                <span className="dt__col-name">{c.name}</span>
                {c.note ? <span className="dt__col-note">{c.note}</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="dt__row">
              <th scope="row" className="dt__label">
                {r.label}
              </th>
              {columns.map((c) => (
                <td key={c.key} className="dt__cell" data-primary={c.primary || undefined}>
                  <Cell cell={r.cells[c.key] ?? { kind: 'text', label: '—' }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dt__cards" aria-hidden>
        {columns.map((c) => (
          <div key={c.key} className="dt__card" data-primary={c.primary || undefined}>
            <div className="dt__card-head">
              <span className="dt__col-name">{c.name}</span>
              {c.note ? <span className="dt__col-note">{c.note}</span> : null}
            </div>
            {rows.map((r) => (
              <div key={r.label} className="dt__card-row">
                <span className="dt__card-label">{r.label}</span>
                <Cell cell={r.cells[c.key] ?? { kind: 'text', label: '—' }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Cell({ cell }: { cell: TableCell }): ReactElement {
  const icon: ReactNode =
    cell.kind === 'good' ? (
      <Check size={13} strokeWidth={3} />
    ) : cell.kind === 'bad' ? (
      <X size={13} strokeWidth={3} />
    ) : cell.kind === 'mixed' ? (
      <Minus size={13} strokeWidth={3} />
    ) : null;
  return (
    <span className="dt__chip" data-kind={cell.kind}>
      {icon ? <span className="dt__chip-ico">{icon}</span> : null}
      <span>
        {cell.label ?? (cell.kind === 'good' ? 'Yes' : cell.kind === 'bad' ? 'No' : 'Partly')}
      </span>
      {cell.estimate ? <span className="dt__est">est.</span> : null}
    </span>
  );
}
