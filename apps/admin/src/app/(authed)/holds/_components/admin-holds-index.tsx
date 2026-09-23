'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Hourglass, PackageCheck, Timer, Users } from 'lucide-react';
import { Ident, Num } from '@skydrop/ui/components';
import { earlyReviewStatusKind, statusLabel } from '@skydrop/ui/status';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { FilterBar, FilterField } from '@skydrop/ui/app/filter-bar';
import { Select } from '@skydrop/ui/app/select';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { AgeChip, Notice, OoSection } from '../../orders/_components/order-ops-parts';
import { EarlyReservationReviewStatus } from '@skydrop/db';
import { useAdminHoldReviews } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/** Whole days a hold has been sitting, for the ageing column. */
function ageDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/**
 * Held stock waiting on a seller's answer, across every seller.
 *
 * These arise when the call centre exhausts its attempts on an order
 * whose stock was claimed at placement: the units are frozen against an
 * order that may never happen, and only the seller can say whether to
 * keep holding them.
 *
 * **Read-only, deliberately.** There is no Release button here. That
 * decision is the seller's (R5); an unanswered review is resolved by the
 * TTL sweep rather than left to rot; and an admin who genuinely must
 * intervene has god mode, which records itself as the invariant-breaking
 * act it is. A routine Release control would make "we released your
 * stock" an ordinary, unaudited thing to do to someone else's inventory.
 *
 * What an operator gets instead is the thing they actually need: who is
 * sitting on holds, how old, how many units — enough to make the phone
 * call that resolves it.
 */
export function AdminHoldsIndex(): ReactElement {
  const [status, setStatus] = useState<string>(EarlyReservationReviewStatus.OPEN);
  const list = useAdminHoldReviews(status === '' ? {} : { status });

  const rows = list.data ?? [];
  const open = rows.filter((r) => r.status === EarlyReservationReviewStatus.OPEN);
  const heldUnits = open.reduce((n, r) => n + r.heldQty, 0);
  const oldest = open.length === 0 ? 0 : Math.max(...open.map((r) => ageDays(r.createdAt)));

  const dash = <span className="oo-faint">—</span>;

  return (
    <div className="oo-page">
      <PageHeader
        title="Held stock"
        subtitle="Orders where stock was claimed at placement and the customer could not be reached. The seller decides; this is the view that tells you who to chase."
      />

      <div className="oo-kpis">
        <KpiCard
          label="Units frozen"
          icon={<Hourglass size={14} />}
          tone={heldUnits > 0 ? 'pending' : 'credit'}
          hint="Unavailable to any other order until decided"
          {...(list.isLoading ? { figure: dash } : { figure: <Num value={heldUnits} /> })}
        />
        <KpiCard
          label="Awaiting a seller"
          icon={<Users size={14} />}
          tone="neutral"
          hint="Open reviews"
          {...(list.isLoading ? { figure: dash } : { value: open.length })}
        />
        <KpiCard
          label="Oldest"
          icon={<Timer size={14} />}
          tone={oldest >= 3 ? 'debit' : oldest > 0 ? 'pending' : 'neutral'}
          hint="The TTL sweep resolves these eventually"
          {...(list.isLoading ? { figure: dash } : { figure: <Num value={oldest} suffix="d" /> })}
        />
      </div>

      <OoSection
        title="Holds"
        note={list.data === undefined ? undefined : `${rows.length} shown`}
        flush
      >
        <div className="oo-card__pad">
          <FilterBar activeCount={status === EarlyReservationReviewStatus.OPEN ? 0 : 1}>
            <FilterField>
              <Select
                id="admin-hold-status"
                label="Status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All</option>
                {Object.values(EarlyReservationReviewStatus).map((s) => (
                  <option key={s} value={s}>
                    {humanise(s)}
                  </option>
                ))}
              </Select>
            </FilterField>
          </FilterBar>
        </div>

        {list.isError ? (
          <div className="oo-card__pad">
            <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
          </div>
        ) : list.isLoading ? (
          <div className="oo-card__pad">
            <SkeletonRows rows={4} cols={6} label="Loading holds…" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            bare
            tone={status === EarlyReservationReviewStatus.OPEN ? 'positive' : 'neutral'}
            icon={<PackageCheck size={20} />}
            title={
              status === EarlyReservationReviewStatus.OPEN
                ? 'No stock held pending a decision'
                : 'No reviews match this filter'
            }
            description={
              status === EarlyReservationReviewStatus.OPEN
                ? 'No seller is sitting on stock frozen against an unreachable customer.'
                : 'Try a different status.'
            }
          />
        ) : (
          <Table caption="Held stock reviews">
            <THead>
              <Tr>
                <Th>Seller</Th>
                <Th>Order</Th>
                <Th align="right">Units</Th>
                <Th align="right">Calls</Th>
                <Th align="right">Age</Th>
                <Th>Status</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => {
                const age = ageDays(r.createdAt);
                return (
                  <Tr key={r.id}>
                    {/* Deliberately NOT a clickable row. The link goes to the
                        SELLER, which is an attribute of this row rather than
                        its subject — the row is a held reservation. Sending the whole row
                        to the seller would take somebody somewhere they did
                        not ask to go, so the link stays a link. */}
                    <Td>
                      <Link href={`/sellers/${r.sellerId}`} className="oo-link">
                        <Ident value={`${r.sellerId.slice(0, 8)}…`} />
                      </Link>
                    </Td>
                    <Td>
                      <Link href={`/orders/${r.orderId}`} className="oo-link">
                        <Ident value={`${r.orderId.slice(0, 8)}…`} />
                      </Link>
                    </Td>
                    <Td align="right">
                      <Num value={r.heldQty} />
                    </Td>
                    <Td align="right">
                      <Num value={r.attemptCount} />
                    </Td>
                    <Td align="right">
                      <AgeChip
                        tone={
                          r.status === EarlyReservationReviewStatus.OPEN && age >= 3
                            ? 'late'
                            : 'neutral'
                        }
                      >
                        <Num value={age} suffix="d" />
                      </AgeChip>
                    </Td>
                    <Td>
                      <StatusChip
                        size="sm"
                        kind={earlyReviewStatusKind(r.status)}
                        label={statusLabel(r.status)}
                      />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </OoSection>

      <Notice tone="info">
        <p>
          There is no release control here on purpose. Whether to give the stock back or keep
          calling is the seller&apos;s commercial decision, and an unanswered review is released by
          the TTL sweep rather than held forever. If a hold genuinely has to be broken from this
          side, that is god mode — audited as the exception it is.
        </p>
      </Notice>
    </div>
  );
}

function humanise(value: string): string {
  const lower = value.replaceAll('_', ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
