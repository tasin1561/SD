'use client';

import { useMemo, useState, type ReactElement } from 'react';
import Link from 'next/link';
import {
  BandBody,
  Button,
  Crumbs,
  EarlyReviewStatusBadge,
  EmptyState,
  ErrorNote,
  FilterChip,
  FormField,
  Ident,
  MetaChip,
  Modal,
  ModalFooter,
  Num,
  PageHeader,
  SectionBand,
  SkeletonRows,
  Stat,
  StripFact,
  TBody,
  Table,
  Td,
  Textarea,
  THead,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { Lock, PhoneCall, PackageCheck } from 'lucide-react';
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
    <div>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[{ label: 'Seller console' }, { label: 'Stock' }, { label: 'Held stock' }]}
            Link={Link}
          />
        }
        title="Held stock"
        subtitle="Orders where we held your stock at placement but could not reach the customer. Release it, or ask us to keep trying."
        meta={
          !loaded ? undefined : openRows.length > 0 ? (
            <>
              <MetaChip tone="warn" dot>
                {openRows.length} waiting on you
              </MetaChip>
              <MetaChip>
                {heldUnits} {heldUnits === 1 ? 'unit' : 'units'} held
              </MetaChip>
            </>
          ) : (
            <MetaChip tone="good">Nothing waiting on you</MetaChip>
          )
        }
      />

      {/* ── What is actually being held ─────────────────────────────
             Three tiles, each counted off the rows below. The units
             figure counts OPEN reviews only, because a decided one is
             no longer holding anything — totalling every row would
             report stock back on the shelf as still locked away. */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Units held pending your decision"
          icon={<Lock size={13} aria-hidden />}
          value={loaded ? <Num value={heldUnits} /> : <span className="text-text-faint">—</span>}
          unit={loaded ? (heldUnits === 1 ? 'unit' : 'units') : undefined}
          tone={loaded && heldUnits > 0 ? 'warn' : 'neutral'}
          hint="Unavailable to your other orders until you decide."
        />
        <Stat
          label="Awaiting you"
          icon={<PackageCheck size={13} aria-hidden />}
          value={loaded ? openRows.length : <span className="text-text-faint">—</span>}
          unit={loaded ? (openRows.length === 1 ? 'order' : 'orders') : undefined}
          tone={loaded && openRows.length > 0 ? 'warn' : 'neutral'}
          hint="Each one needs release, or another round of calls."
        />
        <Stat
          label="Calls already made"
          icon={<PhoneCall size={13} aria-hidden />}
          value={loaded ? <Num value={callsMade} /> : <span className="text-text-faint">—</span>}
          unit={loaded ? 'attempts' : undefined}
          tone="neutral"
          hint={
            filtered
              ? `Across the ${humanise(status).toLowerCase()} reviews shown.`
              : 'Across every review shown.'
          }
        />
      </div>

      <SectionBand
        index="01"
        title="Held stock register"
        note={loaded ? `${rows.length} ${rows.length === 1 ? 'review' : 'reviews'}` : undefined}
      />

      <BandBody flush>
        <div className="border-border flex flex-wrap items-center gap-1.5 border-b px-3 py-2.5">
          <FilterChip label="All" active={status === ''} onClick={() => setStatus('')} />
          {Object.values(EarlyReservationReviewStatus).map((s) => (
            <FilterChip
              key={s}
              label={humanise(s)}
              active={status === s}
              onClick={() => setStatus(s)}
            />
          ))}
        </div>

        {list.isError ? (
          <div className="p-3">
            <ErrorNote
              message={list.error?.message ?? 'Failed to load held stock.'}
              retry={() => void list.refetch()}
            />
          </div>
        ) : list.isLoading ? (
          <SkeletonRows rows={3} cols={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            bare
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
          />
        ) : (
          <Table>
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
                    <Link href={`/orders/${r.orderId}`} className="text-accent hover:underline">
                      <Ident value={`${r.orderId.slice(0, 8)}…`} />
                    </Link>
                    <div className="text-text-faint mt-0.5 text-xs">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </div>
                  </Td>
                  <Td align="right">
                    <Num value={r.heldQty} />
                  </Td>
                  <Td align="right">
                    <Num value={r.attemptCount} />
                  </Td>
                  <Td>
                    <EarlyReviewStatusBadge status={r.status} />
                  </Td>
                  <Td align="right">
                    {r.status === EarlyReservationReviewStatus.OPEN ? (
                      <Button variant="secondary" size="sm" onClick={() => setSelected(r)}>
                        Decide
                      </Button>
                    ) : (
                      <span className="text-text-faint text-xs">
                        {r.resolvedAt === null ? '—' : new Date(r.resolvedAt).toLocaleDateString()}
                      </span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </BandBody>

      {loaded && rows.length > 0 && (
        <div className="text-text-faint border-border mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3 font-mono text-[11px]">
          <StripFact
            label="Units held"
            value={<Num value={heldUnits} />}
            tone={heldUnits > 0 ? 'warn' : 'good'}
          />
          <StripFact label="Awaiting you" value={openRows.length} />
          <StripFact label="Shown" value={`${rows.length} reviews`} />
        </div>
      )}

      <DecideModal review={selected} onClose={() => setSelected(null)} />
    </div>
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

  return (
    <Modal
      open={review !== null}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          onClose();
        }
      }}
      size="md"
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
    >
      <div className="space-y-3">
        <fieldset>
          <legend className="sr-only">Decision</legend>
          <div className="space-y-2">
            <label className="border-border hover:bg-surface-hover flex cursor-pointer items-start gap-2 rounded-[var(--radius-2)] border px-3 py-2">
              <input
                type="radio"
                name="hold-decision"
                checked={decision === 'RELEASE'}
                onChange={() => setDecision('RELEASE')}
                className="mt-1"
              />
              <span>
                <span className="text-text-strong block text-sm">Release the stock</span>
                <span className="text-text-muted block text-xs leading-relaxed">
                  Returns the units to available stock so other orders can use them. This order
                  stays closed.
                </span>
              </span>
            </label>

            <label className="border-border hover:bg-surface-hover flex cursor-pointer items-start gap-2 rounded-[var(--radius-2)] border px-3 py-2">
              <input
                type="radio"
                name="hold-decision"
                checked={decision === 'REQUEST_MORE_ATTEMPTS'}
                onChange={() => setDecision('REQUEST_MORE_ATTEMPTS')}
                className="mt-1"
              />
              <span>
                <span className="text-text-strong block text-sm">Keep trying</span>
                <span className="text-text-muted block text-xs leading-relaxed">
                  We keep the hold and put the order back in the call queue. The units stay
                  unavailable to your other orders in the meantime.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        <FormField label="Note" htmlFor="hold-note" hint="Optional.">
          <Textarea
            id="hold-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>

        {error !== null && <ErrorNote message={error} />}
      </div>

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          disabled={decide.isPending}
          onClick={() => void submit()}
        >
          {decide.isPending ? 'Saving…' : decision === 'RELEASE' ? 'Release stock' : 'Keep trying'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function humanise(value: string): string {
  const lower = value.replaceAll('_', ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
