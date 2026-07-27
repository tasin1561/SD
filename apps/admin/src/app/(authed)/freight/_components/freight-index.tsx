'use client';

import { useMemo, useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  FreightStatusBadge,
  Ident,
  Money,
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
import { InboundFreightStatus } from '@skydrop/db';
import { useFreightList, type FreightChargeView } from '@/lib/ops-hooks';
import { RecordFreightModal } from './record-freight-modal';
import { FreightActions } from './freight-actions';

/**
 * Inbound (BD → India) freight bills — R3.
 *
 * This is a separate money flow from the outbound courier fee: one
 * bill per consignment that crossed the border, amortised per unit as
 * the stock sells. The progress column is the point of the screen —
 * "how much of this consignment's freight have we actually recovered"
 * is the question a PAY_LATER bill exists to answer.
 */
export function FreightIndex(): ReactElement {
  const [status, setStatus] = useState<string>('');
  const [recording, setRecording] = useState(false);

  const list = useFreightList(status === '' ? {} : { status });
  const rows = useMemo(() => list.data ?? [], [list.data]);

  const outstanding = rows.reduce((sum, r) => sum + Number(r.outstandingInr), 0);
  const pendingCount = rows.filter(
    (r) =>
      r.status === InboundFreightStatus.PENDING ||
      r.status === InboundFreightStatus.PARTIALLY_SETTLED,
  ).length;
  const waived = rows
    .filter((r) => r.status === InboundFreightStatus.WAIVED)
    .reduce((sum, r) => sum + Number(r.totalInr), 0);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Inbound freight"
        subtitle="One bill per BD→India consignment. Pay-now debits the wallet at receipt; pay-later leaves a receivable that amortises per unit as the stock sells."
        action={
          <Button variant="primary" size="md" onClick={() => setRecording(true)}>
            Record freight bill
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Outstanding"
          value={<Money amount={outstanding} decimals={false} />}
          tone={outstanding > 0 ? 'warn' : 'good'}
          hint={`${pendingCount} bill${pendingCount === 1 ? '' : 's'} still owing`}
        />
        <Stat
          label="Bills shown"
          value={list.isLoading ? '—' : rows.length}
          hint={status === '' ? 'All statuses' : humanise(status)}
        />
        <Stat
          label="Waived"
          value={<Money amount={waived} decimals={false} />}
          hint="Forgiven — money we chose not to collect"
        />
      </div>

      <Toolbar>
        <label className="text-text-muted text-xs" htmlFor="freight-status">
          Status
        </label>
        <Select
          id="freight-status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-56"
        >
          <option value="">All statuses</option>
          {Object.values(InboundFreightStatus).map((s) => (
            <option key={s} value={s}>
              {humanise(s)}
            </option>
          ))}
        </Select>
      </Toolbar>

      {list.isError ? (
        <Card className="rounded-t-none border-t-0 p-3">
          <ErrorNote
            message={list.error?.message ?? 'Failed to load freight bills.'}
            retry={() => void list.refetch()}
          />
        </Card>
      ) : list.isLoading ? (
        <Card className="rounded-t-none border-t-0">
          <SkeletonRows rows={5} cols={7} />
        </Card>
      ) : rows.length === 0 ? (
        <Card className="rounded-t-none border-t-0">
          <EmptyState
            bare
            title="No freight bills recorded"
            description="Record the freight invoice for a consignment after the goods receipt is logged. One bill per receipt — recording it twice is refused."
            action={
              <Button variant="primary" size="sm" onClick={() => setRecording(true)}>
                Record freight bill
              </Button>
            }
          />
        </Card>
      ) : (
        <Table wrapperClassName="rounded-t-none border-t-0">
          <THead>
            <Tr>
              <Th>Receipt</Th>
              <Th>Mode</Th>
              <Th align="right">Bill</Th>
              <Th align="right">Recovered</Th>
              <Th align="right">Outstanding</Th>
              <Th>Units</Th>
              <Th>Status</Th>
              <Th align="right">Actions</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((row) => (
              <FreightRow key={row.id} row={row} />
            ))}
          </TBody>
        </Table>
      )}

      <RecordFreightModal open={recording} onOpenChange={setRecording} />
    </div>
  );
}

function FreightRow({ row }: { readonly row: FreightChargeView }): ReactElement {
  const total = Number(row.totalInr);
  const settled = Number(row.amountSettledInr);
  const pct = total <= 0 ? 0 : Math.min(100, Math.round((settled / total) * 100));

  return (
    <Tr>
      <Td>
        {row.receiptNumber === null ? (
          <Ident value={`${row.goodsReceiptId.slice(0, 8)}…`} />
        ) : (
          <Ident value={row.receiptNumber} />
        )}
        <div className="text-text-faint mt-0.5 text-xs">
          {new Date(row.createdAt).toLocaleDateString()}
        </div>
      </Td>
      <Td className="text-text-muted whitespace-nowrap text-xs">
        {row.mode === 'PAY_NOW' ? 'Pay now' : 'Pay later'}
        {row.serviceChargeInr !== null && Number(row.serviceChargeInr) > 0 && (
          <div className="text-text-faint">
            +<Money amount={row.serviceChargeInr} decimals={false} /> service
          </div>
        )}
      </Td>
      <Td align="right">
        <Money amount={row.totalInr} />
      </Td>
      <Td align="right">
        <Money amount={row.amountSettledInr} />
        {/* The bar carries the same fact as the number beside it — it
            is a scanning aid, not the only encoding. */}
        <div
          className="bg-surface-hover mt-1 h-1 w-full overflow-hidden rounded-full"
          aria-hidden
        >
          <div
            className="bg-[var(--status-delivered-fg)] h-full"
            style={{ width: `${pct}%` }}
          />
        </div>
      </Td>
      <Td align="right">
        {Number(row.outstandingInr) === 0 ? (
          <span className="text-text-faint">—</span>
        ) : (
          <Money amount={row.outstandingInr} direction="debit" />
        )}
      </Td>
      <Td className="text-text-muted whitespace-nowrap text-xs">
        <Num value={row.unitsSettled} /> / <Num value={row.totalUnits} />
      </Td>
      <Td>
        <FreightStatusBadge status={row.status} />
      </Td>
      <Td align="right">
        <FreightActions row={row} />
      </Td>
    </Tr>
  );
}

function humanise(value: string): string {
  const lower = value.replaceAll('_', ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
