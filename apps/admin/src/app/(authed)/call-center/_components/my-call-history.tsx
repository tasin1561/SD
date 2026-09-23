'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Button } from '@skydrop/ui/app/button';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { Pagination } from '@skydrop/ui/app/pagination';
import { Table, TableEmpty, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { OoCard } from '../../orders/_components/order-ops-parts';
import './call-center.css';
import { serverVerdict } from '@/lib/server-verdict';
import { useAgentCallHistory } from '@/lib/api-hooks';

/**
 * What this agent has already done.
 *
 * The endpoint shipped with the call station and nothing called it, so
 * an agent's own work was write-only: they logged an outcome and it
 * vanished. Two questions go unanswered by that, and both come up
 * during a shift — "what did I tell this customer last time" when the
 * same number comes round again, and "did that actually save" after the
 * page hiccuped mid-attempt.
 *
 * Scoped to the caller by the server, so it needs no permission beyond
 * `callcenter.work` — the same one that lets them take a call. It is
 * their own work, not a view of the floor.
 *
 * `call_attempts` is append-only (CC-1): every row here is a historical
 * fact and nothing on this screen can change one. Collapsed by default
 * because the live call is the job; this is what you open between calls.
 */

const PAGE_SIZE = 10;

function duration(seconds: number | null): string {
  if (seconds === null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m === 0 ? `${s}s` : `${m}m ${s}s`;
}

export function MyCallHistory(): ReactElement {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const history = useAgentCallHistory(page, PAGE_SIZE);

  const data = history.data;

  return (
    <section className="oo-section">
      <SectionHeading
        title="My calls"
        note="Everything you have logged, newest first. Opening it loads your own history."
        action={
          <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : 'Show'}
          </Button>
        }
      />
      {open && (
        <OoCard>
          {history.isLoading ? (
            <SkeletonRows rows={4} cols={5} label="Loading your calls…" />
          ) : history.isError ? (
            <ErrorState
              message={serverVerdict(history.error)}
              retry={() => void history.refetch()}
            />
          ) : (
            <>
              <Table caption="My calls">
                <THead>
                  <Tr>
                    <Th>When</Th>
                    <Th>Outcome</Th>
                    <Th>Length</Th>
                    <Th>Order</Th>
                    <Th>Notes</Th>
                  </Tr>
                </THead>
                <TBody>
                  {(data?.items.length ?? 0) === 0 ? (
                    <TableEmpty colSpan={5}>
                      No calls logged yet. Pull one from the queue above to start.
                    </TableEmpty>
                  ) : (
                    (data?.items ?? []).map((r) => (
                      <Tr key={r.attemptId}>
                        <Td className="oo-nowrap">{new Date(r.startedAt).toLocaleString()}</Td>
                        <Td>{r.outcome.toLowerCase().replace(/_/g, ' ')}</Td>
                        <Td className="sk-figure">{duration(r.durationSeconds)}</Td>
                        <Td>
                          {/* The order, not the attempt: the attempt is a
                              fact about the past and has no page of its
                              own — what an agent wants is where the order
                              got to afterwards. */}
                          <Link href={`/orders/${r.orderId}`} className="oo-link">
                            open
                          </Link>
                        </Td>
                        <Td className="oo-clip">
                          {r.outcomeNotes ?? '—'}
                          {r.rescheduledFor !== null && (
                            <span className="oo-sub">
                              call back {new Date(r.rescheduledFor).toLocaleString()}
                            </span>
                          )}
                        </Td>
                      </Tr>
                    ))
                  )}
                </TBody>
              </Table>

              {(data?.total ?? 0) > PAGE_SIZE && (
                <Pagination
                  className="cc-history-pager"
                  label="My calls pages"
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={data?.total ?? 0}
                  showJump={false}
                  onPageChange={setPage}
                />
              )}
            </>
          )}
        </OoCard>
      )}
    </section>
  );
}
