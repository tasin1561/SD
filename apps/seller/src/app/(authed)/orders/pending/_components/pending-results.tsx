'use client';

import type { ReactElement } from 'react';
import { X } from 'lucide-react';
import type { BulkFixApplyResult, PendingBulkResponse } from '@skydrop/api-client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';
import { useT } from '@/i18n/client';

/**
 * What happened to each row in the last bulk step, kept on the page so it
 * can be shown ON the rows (and listed above them for rows that have since
 * left the list — imported or discarded).
 *
 * Tones: green = finished; amber = saved or looked at but the row still
 * needs a person ("Saved, but still needs…", or skipped); red = failed.
 * The words are the server's own whenever it sent any.
 */
export type OutcomeTone = 'good' | 'warn' | 'bad';

export interface RowOutcome {
  readonly rowId: string;
  /** The spreadsheet row number, when the page knew it. */
  readonly rowNumber: number | null;
  readonly tone: OutcomeTone;
  readonly text: string;
}

export interface LastAction {
  readonly name: string;
  readonly done: number;
  readonly skipped: number;
  readonly failed: number;
  readonly rows: readonly RowOutcome[];
  /** Said instead of the rows when nothing matched. */
  readonly note?: string;
}

type T = Translate<MessageKey>;

/** A tick-then-act answer (set field / import / discard). */
export function fromSelection(
  name: string,
  data: PendingBulkResponse,
  numberOf: (rowId: string) => number | null,
  t: T,
): LastAction {
  return {
    name,
    done: data.done,
    skipped: data.skipped,
    failed: data.failed,
    rows: data.results.map((r) => ({
      rowId: r.rowId,
      rowNumber: numberOf(r.rowId),
      tone:
        r.outcome === 'FAILED'
          ? 'bad'
          : r.outcome === 'SKIPPED' || (r.message !== undefined && r.message !== '')
            ? 'warn'
            : 'good',
      text:
        r.message !== undefined && r.message !== ''
          ? r.message
          : r.outcome === 'DONE'
            ? t('orderPending.resDone')
            : r.outcome === 'SKIPPED'
              ? t('orderPending.resSkipped')
              : t('orderPending.resFailed'),
    })),
  };
}

/** A "fix in bulk" answer. */
export function fromBulkFix(name: string, data: BulkFixApplyResult, t: T): LastAction {
  const rows: RowOutcome[] = data.results.map((r) => {
    if (r.importError !== null && r.importError !== '') {
      return { rowId: r.rowId, rowNumber: r.rowNumber, tone: 'bad', text: r.importError };
    }
    if (r.outcome === 'stillHasProblems') {
      return {
        rowId: r.rowId,
        rowNumber: r.rowNumber,
        tone: 'warn',
        text: t('orderPending.resStillNeeds', {
          problems: r.problems.map((p) => p.reason).join(' '),
        }),
      };
    }
    return {
      rowId: r.rowId,
      rowNumber: r.rowNumber,
      tone: 'good',
      text: r.imported ? t('orderPending.resImported') : t('orderPending.resFixed'),
    };
  });
  return {
    name,
    done: rows.filter((r) => r.tone === 'good').length,
    skipped: rows.filter((r) => r.tone === 'warn').length,
    failed: rows.filter((r) => r.tone === 'bad').length,
    rows,
    ...(data.matched === 0 ? { note: t('orderPending.fixNothing') } : {}),
  };
}

export function ResultChip({ outcome }: { readonly outcome: RowOutcome }): ReactElement {
  return (
    <span className="pend-chip" data-tone={outcome.tone}>
      {outcome.text}
    </span>
  );
}

/** The last step's totals and one chip per row, above the list. */
export function LastActionStrip({
  action,
  onDismiss,
}: {
  readonly action: LastAction;
  readonly onDismiss: () => void;
}): ReactElement {
  const t = useT();
  return (
    <div className="pend-last" role="status">
      <div className="pend-last__head">
        <strong className="pend-last__title">
          {action.note ??
            t('orderPending.lastResult', {
              action: action.name,
              done: action.done,
              skipped: action.skipped,
              failed: action.failed,
            })}
        </strong>
        <button type="button" className="pend-last__x" onClick={onDismiss}>
          <X size={14} aria-hidden />
          {t('orderPending.lastResultDismiss')}
        </button>
      </div>
      {action.rows.length > 0 && (
        <ul className="pend-last__rows" aria-label={t('orderPending.lastResultList')}>
          {action.rows.map((r) => (
            <li key={r.rowId} className="pend-last__row">
              <span className="pend-last__n sk-figure">
                {r.rowNumber === null ? '—' : t('orderPending.resRow', { n: r.rowNumber })}
              </span>
              <ResultChip outcome={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
