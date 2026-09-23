'use client';

import type { ReactElement } from 'react';
import { ArrowLeft, Info } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TBody, THead, TableEmpty, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { useBankAccountHistory, type BankAccountChangeView } from '@/lib/bank-account-hooks';
import { usePermission } from '@/lib/use-permission';
import { BackLink, MoCard, Notice } from '../../../treasury/_components/money-parts';
import './bank-account-history.css';

/**
 * Every change to the accounts sellers pay into.
 *
 * ── WHY THIS PAGE EXISTS ─────────────────────────────────────────────
 * A seller reads these digits off their screen and types them into
 * their bank. Change the account number and every payment from that
 * moment goes somewhere else — and until 2026-09-07 none of it was
 * recorded, so the only trace was a row quietly holding different
 * digits than it did yesterday, with nobody able to say who changed
 * them or when.
 *
 * Read straight off the audit trail rather than a table of its own: the
 * audit log IS the history, and a second copy is one more thing that
 * can disagree with it.
 */
function actionLabel(action: string): string {
  if (action.endsWith('.created')) return 'Added';
  if (action.endsWith('.updated')) return 'Edited';
  if (action.endsWith('.retired')) return 'Retired';
  // Not hidden. An action we have no words for is still a change
  // somebody made, and dropping it would make the history look quieter
  // than it was.
  return action;
}

/**
 * The fields somebody actually changed, in words.
 *
 * An edit that moved the ACCOUNT NUMBER is a different event from one
 * that fixed a label, and only one of them redirects money — so the
 * changed fields are named rather than left as two blobs to diff by eye.
 */
function ChangeSummary({ row }: { readonly row: BankAccountChangeView }): ReactElement {
  const changed = row.metadata?.changed ?? [];
  const before = row.metadata?.before ?? null;
  const after = row.metadata?.after ?? null;

  if (row.action.endsWith('.created')) {
    return (
      <span className="mo-muted">
        {String(after?.['label'] ?? 'Account')} · {String(after?.['currency'] ?? '')}
        {row.metadata?.openingBalance != null && row.metadata.openingBalance !== '' && (
          <> · opening balance {row.metadata.openingBalance}</>
        )}
      </span>
    );
  }
  if (row.action.endsWith('.retired')) {
    return (
      <span className="mo-muted">
        {String(before?.['label'] ?? 'Account')} — no longer offered to sellers
      </span>
    );
  }
  if (changed.length === 0) {
    return <span className="mo-faint">Saved with no field changed</span>;
  }
  return (
    <ul className="bh-changes">
      {changed.map((f) => (
        <li key={f}>
          <span className="bh-changes__field">{f}</span>{' '}
          <del className="bh-changes__before">{String(before?.[f] ?? '—')}</del>{' '}
          <span className="bh-changes__after">→ {String(after?.[f] ?? '—')}</span>
        </li>
      ))}
    </ul>
  );
}

export function BankAccountHistoryIndex(): ReactElement {
  const history = useBankAccountHistory(usePermission('money.view'));

  return (
    <div className="mo-page">
      <BackLink href="/bank-accounts" icon={<ArrowLeft size={14} aria-hidden />}>
        Back to bank accounts
      </BackLink>
      <PageHeader
        title="Bank account history"
        subtitle="Every account added, edited or retired — who did it, when, and exactly what changed."
      />

      {history.isLoading ? (
        <SkeletonRows rows={5} cols={4} label="Loading the history" />
      ) : history.isError || history.data === undefined ? (
        <ErrorState
          message={history.error?.message ?? 'Could not read the history.'}
          retry={() => void history.refetch()}
        />
      ) : (
        <>
          <Notice tone="info" icon={<Info size={16} />}>
            <p>
              Recording began on 7 September 2026. Changes made before that were never captured —
              this list is empty for them rather than complete, which is worth knowing before
              reading it as the whole story.
            </p>
          </Notice>

          <MoCard flush>
            <Table caption="Bank account changes">
              <THead>
                <Tr>
                  <Th>When</Th>
                  <Th>What</Th>
                  <Th>Changed</Th>
                  <Th>By</Th>
                </Tr>
              </THead>
              <TBody>
                {history.data.length === 0 ? (
                  <TableEmpty colSpan={4}>
                    <EmptyState
                      bare
                      title="Nothing recorded yet"
                      description="Every add, edit and retirement from here on appears in this list."
                    />
                  </TableEmpty>
                ) : (
                  history.data.map((r) => (
                    <Tr key={r.id}>
                      <Td className="mo-nowrap mo-muted">
                        {new Date(r.at).toLocaleString('en-IN')}
                      </Td>
                      <Td>
                        <StatusChip
                          // An account-number change is the one that
                          // redirects money, and it is audited CRITICAL —
                          // shown here as a failure tone so it does not
                          // read like an ordinary edit.
                          kind={
                            r.severity === 'CRITICAL'
                              ? 'failed'
                              : r.action.endsWith('.retired')
                                ? 'cancelled'
                                : 'confirmed'
                          }
                          label={actionLabel(r.action)}
                          size="sm"
                        />
                      </Td>
                      <Td>
                        <ChangeSummary row={r} />
                      </Td>
                      <Td className="mo-muted">{r.byName ?? 'System'}</Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          </MoCard>
        </>
      )}
    </div>
  );
}
