'use client';

import { useMemo, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Ident, Num } from '@skydrop/ui/components';
import { earlyReviewStatusKind, statusLabel } from '@skydrop/ui/status';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { ChoiceCards } from '@skydrop/ui/app/choice-cards';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Tabs } from '@skydrop/ui/app/tabs';
import { TextArea } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import { Gavel, Lock, PackageCheck, PhoneCall, RotateCw, Unlock } from 'lucide-react';
import {
  AreaPage,
  AreaSection,
  Dash,
  InlineError,
  KpiGrid,
  MetaFact,
  MetaFacts,
  Panel,
  PanelPad,
  mutationPhase,
  rawCount,
} from '@/app/(authed)/inventory/_components/stock-ui';
import { EarlyReservationReviewStatus } from '@skydrop/db';
import { useDecideHoldReview, useHoldReviews, type ReviewView } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { useRouter } from 'next/navigation';

/**
 * Held stock awaiting the seller's call.
 *
 * When an order comes in, stock can be held immediately — before anyone
 * has spoken to the customer. If the call centre then exhausts its
 * attempts without reaching them, that stock is still held against an
 * order that may never happen, and only the seller can say whether to
 * keep holding it.
 *
 * Doing nothing has a cost, so the screen leads with how much is held.
 *
 * ── WHAT THE CONSOLE COMPS SHOW THAT IS NOT HERE ────────────────────
 *   VALUE OF HELD STOCK   the review carries a held QUANTITY and the
 *                         order it belongs to; it carries no cost, and
 *                         a per-unit cost is not on this endpoint. A
 *                         rupee figure would have to be invented, on a
 *                         screen whose whole job is to make the cost of
 *                         doing nothing legible.
 *   HOW LONG IT HAS SAT   there is a TTL sweep behind this (72h by
 *                         default), but the deadline is not returned,
 *                         and `updatedAt` is not when the hold started
 *                         (rule 4b). The date the review was raised is
 *                         what IS true, so that is the column.
 */
export function HoldReviewsIndex(): ReactElement {
  const router = useRouter();
  const [status, setStatus] = useState<string>(EarlyReservationReviewStatus.OPEN);
  const [selected, setSelected] = useState<ReviewView | null>(null);
  const list = useHoldReviews(status === '' ? {} : { status });

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const openRows = useMemo(
    () => rows.filter((r) => r.status === EarlyReservationReviewStatus.OPEN),
    [rows],
  );
  const heldUnits = openRows.reduce((sum, r) => sum + r.heldQty, 0);
  const callsMade = rows.reduce((sum, r) => sum + r.attemptCount, 0);
  const loaded = !list.isLoading && !list.isError;
  const filtered = status !== '';

  return (
    <AreaPage>
      <PageHeader
        breadcrumbs={[{ label: 'Seller console' }, { label: 'Stock' }, { label: 'Held stock' }]}
        Link={Link}
        title="Held stock"
        subtitle="Orders where we held your stock at placement but could not reach the customer. Release it, or ask us to keep trying."
        meta={
          !loaded ? undefined : openRows.length > 0 ? (
            <MetaFacts>
              <MetaFact tone="warn" dot>
                {openRows.length} waiting on you
              </MetaFact>
              <MetaFact>
                {heldUnits} {heldUnits === 1 ? 'unit' : 'units'} held
              </MetaFact>
            </MetaFacts>
          ) : (
            <MetaFact tone="good">Nothing waiting on you</MetaFact>
          )
        }
      />

      {/* ── What is actually being held ─────────────────────────────
             Three tiles, each counted off the rows below. The units
             figure counts OPEN reviews only, because a decided one is
             no longer holding anything — totalling every row would
             report stock back on the shelf as still locked away. */}
      <KpiGrid>
        <KpiCard
          label="Units held pending your decision"
          icon={<Lock size={14} />}
          figure={loaded ? <Num value={heldUnits} /> : <Dash />}
          {...(loaded ? { unit: heldUnits === 1 ? 'unit' : 'units' } : {})}
          tone={loaded && heldUnits > 0 ? 'pending' : 'neutral'}
          hint="Unavailable to your other orders until you decide."
        />
        {loaded ? (
          <KpiCard
            label="Awaiting you"
            icon={<PackageCheck size={14} />}
            value={openRows.length}
            format={rawCount}
            unit={openRows.length === 1 ? 'order' : 'orders'}
            tone={openRows.length > 0 ? 'pending' : 'neutral'}
            hint="Each one needs release, or another round of calls."
          />
        ) : (
          <KpiCard
            label="Awaiting you"
            icon={<PackageCheck size={14} />}
            figure={<Dash />}
            tone="neutral"
            hint="Each one needs release, or another round of calls."
          />
        )}
        <KpiCard
          label="Calls already made"
          icon={<PhoneCall size={14} />}
          figure={loaded ? <Num value={callsMade} /> : <Dash />}
          {...(loaded ? { unit: 'attempts' } : {})}
          tone="neutral"
          hint={
            filtered
              ? `Across the ${humanise(status).toLowerCase()} reviews shown.`
              : 'Across every review shown.'
          }
        />
      </KpiGrid>

      <AreaSection
        title="Held stock register"
        note={loaded ? `${rows.length} ${rows.length === 1 ? 'review' : 'reviews'}` : undefined}
      >
        <Panel flush>
          <PanelPad>
            <Tabs
              label="Review status"
              size="sm"
              value={status === '' ? 'ALL' : status}
              onChange={(id) => setStatus(id === 'ALL' ? '' : id)}
              items={[
                { id: 'ALL', label: 'All' },
                ...Object.values(EarlyReservationReviewStatus).map((s) => ({
                  id: s,
                  label: humanise(s),
                })),
              ]}
            />
          </PanelPad>

          {list.isError ? (
            <PanelPad>
              <InlineError
                message={list.error?.message ?? 'Failed to load held stock.'}
                retry={() => void list.refetch()}
              />
            </PanelPad>
          ) : list.isLoading ? (
            <PanelPad>
              <SkeletonRows rows={3} cols={5} />
            </PanelPad>
          ) : rows.length === 0 ? (
            <PanelPad>
              <EmptyState
                bare
                tone={status === EarlyReservationReviewStatus.OPEN ? 'positive' : 'neutral'}
                title={
                  status === EarlyReservationReviewStatus.OPEN
                    ? 'Nothing waiting on you'
                    : 'No matching reviews'
                }
                description={
                  status === EarlyReservationReviewStatus.OPEN
                    ? 'No stock is being held against an unreachable customer right now.'
                    : 'Try a different status.'
                }
                action={
                  status === EarlyReservationReviewStatus.OPEN ? undefined : (
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={() => setStatus(EarlyReservationReviewStatus.OPEN)}
                    >
                      Show open reviews
                    </Button>
                  )
                }
              />
            </PanelPad>
          ) : (
            <Table caption="Held stock register">
              <THead>
                <Tr>
                  <Th>Order</Th>
                  <Th align="right">Units held</Th>
                  <Th align="right">Calls made</Th>
                  <Th>Status</Th>
                  <Th align="right">Decision</Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <Tr key={r.id} onActivate={() => router.push(`/orders/${r.orderId}`)}>
                    <Td>
                      <Link href={`/orders/${r.orderId}`} className="inv-link">
                        <Ident value={`${r.orderId.slice(0, 8)}…`} />
                      </Link>
                      <span className="inv-sub sk-figure">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    </Td>
                    <Td align="right">
                      <Num value={r.heldQty} />
                    </Td>
                    <Td align="right">
                      <Num value={r.attemptCount} />
                    </Td>
                    <Td>
                      <StatusChip
                        kind={earlyReviewStatusKind(r.status)}
                        label={statusLabel(r.status)}
                        size="sm"
                      />
                    </Td>
                    <Td align="right">
                      {r.status === EarlyReservationReviewStatus.OPEN ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<Gavel size={14} />}
                          onClick={() => setSelected(r)}
                        >
                          Decide
                        </Button>
                      ) : (
                        <span className="inv-faint sk-figure">
                          {r.resolvedAt === null
                            ? '—'
                            : new Date(r.resolvedAt).toLocaleDateString()}
                        </span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Panel>

        {loaded && rows.length > 0 && (
          <MetaFacts>
            <MetaFact tone={heldUnits > 0 ? 'warn' : 'good'}>
              Units held <Num value={heldUnits} />
            </MetaFact>
            <MetaFact>Awaiting you {openRows.length}</MetaFact>
            <MetaFact>Shown {`${rows.length} reviews`}</MetaFact>
          </MetaFacts>
        )}
      </AreaSection>

      <DecideModal review={selected} onClose={() => setSelected(null)} />
    </AreaPage>
  );
}

function DecideModal({
  review,
  onClose,
}: {
  readonly review: ReviewView | null;
  readonly onClose: () => void;
}): ReactElement {
  const toast = useToast();
  const decide = useDecideHoldReview();
  const [decision, setDecision] = useState<'RELEASE' | 'REQUEST_MORE_ATTEMPTS'>('RELEASE');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (review === null) return;
    setError(null);
    try {
      const result = await decide.mutateAsync({
        reviewId: review.id,
        decision,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });
      toast.success(
        decision === 'RELEASE'
          ? `${review.heldQty} unit${review.heldQty === 1 ? '' : 's'} released back to available stock.`
          : result.orderMoved
            ? 'We will keep trying to reach the customer.'
            : 'Recorded. The order had already moved on, so calling did not restart.',
      );
      setNote('');
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  // It already asked; it now RESTATES the order and the units, above
  // the two choices, so a release is never made without seeing which
  // order's stock goes back on the shelf.
  return (
    <Dialog
      open={review !== null}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          onClose();
        }
      }}
      size="md"
      icon={<Lock size={18} />}
      locked={decide.isPending}
      title="Keep holding this stock?"
      description={
        review === null ? undefined : (
          <>
            We held {review.heldQty} unit
            {review.heldQty === 1 ? '' : 's'} when this order came in, and have tried the customer{' '}
            {review.attemptCount} time
            {review.attemptCount === 1 ? '' : 's'} without reaching them.
          </>
        )
      }
      footer={
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={onClose} disabled={decide.isPending}>
            Cancel
          </Button>
          <AsyncButton
            variant={decision === 'RELEASE' ? 'destructive' : 'primary'}
            size="md"
            icon={decision === 'RELEASE' ? <Unlock size={16} /> : <RotateCw size={16} />}
            labels={{
              idle: decision === 'RELEASE' ? 'Release stock' : 'Keep trying',
              busy: 'Saving…',
            }}
            state={mutationPhase(decide)}
            disabled={decide.isPending}
            onClick={() => void submit()}
          />
        </DialogFooter>
      }
    >
      <div className="inv-stack">
        {review !== null && (
          <div className="inv-callout" data-tone="warn">
            <span>
              Order <Ident value={`${review.orderId.slice(0, 8)}…`} /> ·{' '}
              <Num value={review.heldQty} /> {review.heldQty === 1 ? 'unit' : 'units'} held
            </span>
          </div>
        )}

        <ChoiceCards
          label="Decision"
          hideLegend
          name="hold-decision"
          columns={1}
          value={decision}
          onChange={(v) => setDecision(v as 'RELEASE' | 'REQUEST_MORE_ATTEMPTS')}
          options={[
            {
              value: 'RELEASE',
              title: 'Release the stock',
              description:
                'Returns the units to available stock so other orders can use them. This order stays closed.',
              icon: <Unlock size={16} />,
            },
            {
              value: 'REQUEST_MORE_ATTEMPTS',
              title: 'Keep trying',
              description:
                'We keep the hold and put the order back in the call queue. The units stay unavailable to your other orders in the meantime.',
              icon: <RotateCw size={16} />,
            },
          ]}
        />

        <TextArea
          label="Note"
          id="hold-note"
          hint="Optional."
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        {error !== null && <InlineError message={error} />}
      </div>
    </Dialog>
  );
}

function humanise(value: string): string {
  const lower = value.replaceAll('_', ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
