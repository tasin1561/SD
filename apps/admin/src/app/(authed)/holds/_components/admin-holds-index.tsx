'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import {
  Card,
  CardBody,
  EarlyReviewStatusBadge,
  EmptyState,
  ErrorNote,
  Ident,
  Num,
  PageHeader,
  Select,
  SkeletonRows,
  Stat,
  TBody,
  Table,
  Td,
  THead,
  Th,
  Toolbar,
  Tr,
} from '@skydrop/ui/components';
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

  return (
    <div>
      <PageHeader
        title="Held stock"
        subtitle="Orders where stock was claimed at placement and the customer could not be reached. The seller decides; this is the view that tells you who to chase."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Units frozen"
          value={list.isLoading ? '—' : <Num value={heldUnits} />}
          tone={heldUnits > 0 ? 'warn' : 'good'}
          hint="Unavailable to any other order until decided"
        />
        <Stat
          label="Awaiting a seller"
          value={list.isLoading ? '—' : open.length}
          hint="Open reviews"
        />
        <Stat
          label="Oldest"
          value={list.isLoading ? '—' : <Num value={oldest} suffix="d" />}
          tone={oldest >= 3 ? 'bad' : oldest > 0 ? 'warn' : 'neutral'}
          hint="The TTL sweep resolves these eventually"
        />
      </div>

      <Toolbar>
        <label className="text-text-muted text-xs" htmlFor="admin-hold-status">
          Status
        </label>
        <Select
          id="admin-hold-status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-64"
        >
          <option value="">All</option>
          {Object.values(EarlyReservationReviewStatus).map((s) => (
            <option key={s} value={s}>
              {humanise(s)}
            </option>
          ))}
        </Select>
      </Toolbar>

      {list.isError ? (
        <Card className="rounded-t-none border-t-0 p-3">
          <ErrorNote message={serverVerdict(list.error)} retry={() => void list.refetch()} />
        </Card>
      ) : list.isLoading ? (
        <Card className="rounded-t-none border-t-0">
          <SkeletonRows rows={4} cols={6} />
        </Card>
      ) : rows.length === 0 ? (
        <Card className="rounded-t-none border-t-0">
          <EmptyState
            bare
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
        </Card>
      ) : (
        <Table wrapperClassName="rounded-t-none border-t-0">
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
                  <Td>
                    <Link href={`/sellers/${r.sellerId}`} className="text-accent hover:underline">
                      <Ident value={`${r.sellerId.slice(0, 8)}…`} />
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/orders/${r.orderId}`} className="text-accent hover:underline">
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
                    {r.status === EarlyReservationReviewStatus.OPEN && age >= 3 ? (
                      <span className="text-[var(--color-critical)]">
                        <Num value={age} suffix="d" />
                      </span>
                    ) : (
                      <Num value={age} suffix="d" />
                    )}
                  </Td>
                  <Td>
                    <EarlyReviewStatusBadge status={r.status} />
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}

      <Card className="mt-4">
        <CardBody>
          <p className="text-text-muted text-xs leading-relaxed">
            There is no release control here on purpose. Whether to give the stock back or keep
            calling is the seller&apos;s commercial decision, and an unanswered review is released
            by the TTL sweep rather than held forever. If a hold genuinely has to be broken from
            this side, that is god mode — audited as the exception it is.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function humanise(value: string): string {
  const lower = value.replaceAll('_', ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
