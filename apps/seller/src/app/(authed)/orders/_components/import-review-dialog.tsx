'use client';

import { FileSpreadsheet, FileWarning } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';
import './import-page.css';

/**
 * The check result, in a modal. Pure presentation of the preview the panel
 * already holds: nothing here parses, validates, groups or calls the API.
 * `orderCount` is the number of orders that ASSEMBLED CLEANLY (the importer's
 * own grouping puts a rejected order in `problems`, not in `orderCount`),
 * so the verdict says "will be created", never "found".
 */

export interface ReviewProblem {
  readonly rowNumber: number;
  readonly field: string;
  readonly reason: string;
}

export interface ImportReviewDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly t: Translate<MessageKey>;
  readonly kind: 'orders' | 'catalogue';
  readonly fileName: string;
  readonly rowCount: number;
  /** Orders that will be created (orders), rows that will be imported (catalogue). */
  readonly willCreate: number;
  readonly rejectedCount: number;
  /** The first rows the server listed; may be fewer than `rejectedCount`. */
  readonly problems: readonly ReviewProblem[];
  /** The panel's own blocking notices (missing columns, row limit), verbatim. */
  readonly blockers?: ReactNode;
  readonly blocked: boolean;
  readonly busy: boolean;
  readonly importing: boolean;
  readonly importLabel: string;
  readonly onImport: () => void;
}

function countText(t: Translate<MessageKey>, kind: 'orders' | 'catalogue', n: number): string {
  if (kind === 'orders') {
    return t(n === 1 ? 'orderImport.reviewOrderOne' : 'orderImport.reviewOrderMany', { count: n });
  }
  return t(n === 1 ? 'orderImport.reviewRowOne' : 'orderImport.reviewRowMany', { count: n });
}

export function importReviewVerdict(
  t: Translate<MessageKey>,
  kind: 'orders' | 'catalogue',
  willCreate: number,
  rejected: number,
  blocked: boolean,
): string {
  if (blocked) return t('orderImport.reviewVerdictBlocked');
  const created = countText(t, kind, willCreate);
  if (rejected === 0) return t('orderImport.reviewVerdictClean', { created });
  const rows = t(rejected === 1 ? 'orderImport.reviewRowsOne' : 'orderImport.reviewRowsMany', {
    count: rejected,
  });
  if (willCreate === 0) return t('orderImport.reviewVerdictNone', { rejected: rows });
  return t('orderImport.reviewVerdictMixed', { created, rejected: rows });
}

export function ImportReviewDialog(p: ImportReviewDialogProps): ReactElement {
  const { t } = p;
  const verdict = importReviewVerdict(t, p.kind, p.willCreate, p.rejectedCount, p.blocked);
  const unlisted = Math.max(0, p.rejectedCount - p.problems.length);
  return (
    <Dialog
      open={p.open}
      onOpenChange={p.onOpenChange}
      size="lg"
      className="imp-review"
      locked={p.importing}
      icon={
        p.rejectedCount > 0 || p.blocked ? <FileWarning size={18} /> : <FileSpreadsheet size={18} />
      }
      title={verdict}
      description={
        <>
          <span className="sk-ident">{p.fileName}</span>
          {' · '}
          {t(p.rowCount === 1 ? 'orderImport.reviewRowsOne' : 'orderImport.reviewRowsMany', {
            count: p.rowCount,
          })}
          {' · '}
          {t('orderImport.nothingHasBeenImported')}
        </>
      }
      footer={
        <DialogFooter>
          <Button variant="secondary" disabled={p.busy} onClick={() => p.onOpenChange(false)}>
            {t('orderImport.reviewClose')}
          </Button>
          <AsyncButton
            variant="primary"
            icon={<FileSpreadsheet size={15} />}
            state={p.importing ? 'busy' : undefined}
            labels={{ idle: p.importLabel, busy: t('orderImport.queuing') }}
            disabled={p.busy || p.blocked}
            onClick={p.onImport}
          />
        </DialogFooter>
      }
    >
      <div className="imp-review__body" aria-live="polite">
        {p.blockers}
        {p.rejectedCount > 0 ? (
          <section aria-label={t('orderImport.reviewRejectedHeading')}>
            <h3 className="imp-review__h">{t('orderImport.reviewRejectedHeading')}</h3>
            <ul className="imp-review__list">
              {p.problems.map((r) => (
                <li key={`${r.rowNumber}-${r.field}`} className="imp-review__item">
                  <span className="imp-review__row sk-figure">
                    {t('orderImport.reviewRowNo', { rowNumber: r.rowNumber })}
                  </span>
                  <span className="imp-review__why">{r.reason}</span>
                </li>
              ))}
            </ul>
            {unlisted > 0 ? (
              <p className="ord-p">{t('orderImport.reviewMoreRejected', { count: unlisted })}</p>
            ) : null}
            {p.willCreate > 0 ? <p className="ord-p">{t('orderImport.reviewRestImport')}</p> : null}
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}
