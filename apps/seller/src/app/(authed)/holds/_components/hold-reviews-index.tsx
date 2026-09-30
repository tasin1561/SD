'use client';

import { useMemo, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Ident, Num } from '@skydrop/ui/components';
import { earlyReviewStatusKind, statusLabel } from '@skydrop/ui/status';
import { Button } from '@skydrop/ui/app/button';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Tabs } from '@skydrop/ui/app/tabs';
import { Gavel, Lock, PackageCheck, PhoneCall } from 'lucide-react';
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
  rawCount,
} from '@/app/(authed)/inventory/_components/stock-ui';
import { EarlyReservationReviewStatus } from '@skydrop/db';
import { HoldDecisionDialog } from '@/components/hold-decision-dialog';
import { useHoldReviews, type ReviewView } from '@/lib/ops-hooks';
import { useRouter } from 'next/navigation';

/**
 * Orders our agents could not confirm on the phone, waiting on the seller.
 *
 * ── WHY THIS IS NOT CALLED "HELD STOCK" ANY MORE (2026-09-27) ────────
 * It was, under the Stock group, subtitled "Orders where we held your
 * stock at placement but could not reach the customer" — and a seller
 * looking for "the customer did not answer, what do I do?" would never
 * open it. Worse, the page LED with the held-unit count, and an
 * at-placement hold is opt-in (RES-2): for a seller who has not turned
 * it on, `heldQty` is 0 on every row, so the one thing waiting on them
 * rendered as "0 units" under a title about stock. The review is raised
 * whatever the hold setting says, because the question is about CALLING.
 *
 * So: named for the situation, grouped under Selling beside Needs
 * attention, and every sentence about units is conditional on there
 * being units. The stock framing SURVIVES where it is true — a seller
 * who does hold stock still sees the units held, because for them that
 * is the cost of doing nothing.
 *
 * The decision itself lives on the ORDER page too, from the same
 * `HoldDecisionDialog` (one component, two mounts). This page is the
 * register: the open ones, and what was decided before.
 *
 * ── WHAT IS NOT HERE, AND WHY ───────────────────────────────────────
 *   VALUE OF HELD STOCK   the review carries a held QUANTITY and the
 *                         order it belongs to; it carries no cost, and
 *                         a per-unit cost is not on this endpoint. A
 *                         rupee figure would have to be invented.
 *   THE DEADLINE          there IS a TTL sweep (`inventory.
 *                         early_reservation_review_ttl_hours`, 72 by
 *                         default) but it is SELLER-OVERRIDABLE and no
 *                         seller endpoint exposes it, so a date here
 *                         would be a guess printed as a fact. The
 *                         consequence is stated in words instead. And
 *                         `updatedAt` is not when the review was raised
 *                         (rule 4b) — `createdAt` is, so that is the
 *                         column.
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
        breadcrumbs={[
          { label: 'Seller console' },
          { label: 'Selling' },
          { label: 'Unreachable customers' },
        ]}
        Link={Link}
        title="Unreachable customers"
        subtitle="Orders our agents rang without reaching anybody. Tell us to keep trying, or let the order go — nothing happens to these until you say."
        meta={
          !loaded ? undefined : openRows.length > 0 ? (
            <MetaFacts>
              <MetaFact tone="warn" dot>
                {openRows.length} waiting on you
              </MetaFact>
              {/* Only when something IS held. "0 units held" beside a
                  list of orders that need a decision reads as an empty
                  screen, and for most sellers it is always 0. */}
              {heldUnits > 0 && (
                <MetaFact>
                  {heldUnits} {heldUnits === 1 ? 'unit' : 'units'} held
                </MetaFact>
              )}
            </MetaFacts>
          ) : (
            <MetaFact tone="good">Nothing waiting on you</MetaFact>
          )
        }
      />

      {/* ── What is waiting, and what it is costing ─────────────────
             AWAITING YOU LEADS. It used to be the held-unit count, and
             for a seller who has not turned at-placement holds on that
             is 0 on every row — so the page opened with a zero while
             orders sat undecided underneath it.

             The units tile is rendered ONLY when something is held. An
             absent tile says "no stock is tied up in this"; a tile
             reading 0 says "this screen is empty", which was the whole
             defect. Counted off OPEN reviews only — a decided one is no
             longer holding anything. */}
      <KpiGrid>
        {loaded ? (
          <KpiCard
            label="Waiting on your decision"
            icon={<PackageCheck size={14} />}
            value={openRows.length}
            format={rawCount}
            unit={openRows.length === 1 ? 'order' : 'orders'}
            tone={openRows.length > 0 ? 'pending' : 'neutral'}
            hint="Each one needs another round of calls, or letting go."
          />
        ) : (
          <KpiCard
            label="Waiting on your decision"
            icon={<PackageCheck size={14} />}
            figure={<Dash />}
            tone="neutral"
            hint="Each one needs another round of calls, or letting go."
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
        {loaded && heldUnits > 0 && (
          <KpiCard
            label="Units held pending your decision"
            icon={<Lock size={14} />}
            figure={<Num value={heldUnits} />}
            unit={heldUnits === 1 ? 'unit' : 'units'}
            tone="pending"
            hint="Unavailable to your other orders until you decide."
          />
        )}
      </KpiGrid>

      <AreaSection
        title="Decision register"
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
                message={list.error?.message ?? 'Failed to load these orders.'}
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
                    ? 'Every order our agents rang was answered. Nothing is waiting on a decision from you.'
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
            <Table caption="Unreachable-customer decisions">
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
                      {/* The NUMBER, not eight characters of a uuid. A
                          seller cannot read a uuid down a phone, match
                          it against their order list, or search for it
                          — the order search takes a number, a ref, an
                          AWB, a name or a phone. `/needs-attention`
                          lists these same orders by their number, so
                          the two screens disagreed about how to name
                          one thing. The id is still what the link
                          uses. */}
                      <Link href={`/orders/${r.orderId}`} className="inv-link">
                        <Ident value={r.orderNumber ?? `${r.orderId.slice(0, 8)}…`} />
                      </Link>
                      <span className="inv-sub sk-figure">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    </Td>
                    {/* A dash, not a zero: the column is meaningful for
                        a seller who holds stock at placement, and 0 on a
                        row that never held any is a figure rather than
                        the absence of one. */}
                    <Td align="right">{r.heldQty > 0 ? <Num value={r.heldQty} /> : <Dash />}</Td>
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
            <MetaFact tone={openRows.length > 0 ? 'warn' : 'good'}>
              Awaiting you {openRows.length}
            </MetaFact>
            {heldUnits > 0 && (
              <MetaFact tone="warn">
                Units held <Num value={heldUnits} />
              </MetaFact>
            )}
            <MetaFact>
              Shown {`${rows.length} ${rows.length === 1 ? 'review' : 'reviews'}`}
            </MetaFact>
          </MetaFacts>
        )}
      </AreaSection>

      <HoldDecisionDialog
        review={selected}
        {...(selected?.orderNumber == null ? {} : { orderNumber: selected.orderNumber })}
        onClose={() => setSelected(null)}
      />
    </AreaPage>
  );
}

function humanise(value: string): string {
  const lower = value.replaceAll('_', ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
