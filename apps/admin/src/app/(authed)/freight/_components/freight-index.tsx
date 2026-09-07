'use client';

import Link from 'next/link';

import { Fragment, useMemo, useState, type ReactElement } from 'react';
import { ChevronRight } from 'lucide-react';
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
import { useFreightCostBreakdown, useFreightList, type FreightChargeView } from '@/lib/ops-hooks';
import { RecordFreightModal } from './record-freight-modal';
import { FreightActions } from './freight-actions';
import { OurCostCell } from './our-cost-cell';
import { usePermission } from '@/lib/use-permission';

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
  // One bill open at a time — several expanded at once is a wall of
  // numbers that reads worse than the summary it explains.
  const [openId, setOpenId] = useState<string | null>(null);
  const canWrite = usePermission('money.freight.manage');
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
    <div>
      <PageHeader
        title="Inbound freight"
        subtitle="One bill per BD→India consignment, split over the units that actually landed. Pay-now debits the wallet immediately; pay-later leaves a receivable that amortises per unit as the stock sells."
        action={
          canWrite ? (
            <Button variant="primary" size="md" onClick={() => setRecording(true)}>
              Record freight bill
            </Button>
          ) : null
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
            description="Record the freight invoice for a consignment once something has landed in India. One bill per consignment — recording it twice is refused, and a seller who shipped straight to India is refused outright."
            action={
              canWrite ? (
                <Button variant="primary" size="sm" onClick={() => setRecording(true)}>
                  Record freight bill
                </Button>
              ) : null
            }
          />
        </Card>
      ) : (
        <Table wrapperClassName="rounded-t-none border-t-0">
          <THead>
            <Tr>
              <Th>Consignment</Th>
              <Th>Mode</Th>
              <Th align="right">Bill</Th>
              <Th align="right">Our cost</Th>
              <Th align="right">Recovered</Th>
              <Th align="right">Outstanding</Th>
              <Th>Units</Th>
              <Th>Status</Th>
              <Th align="right">Actions</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((row) => (
              <FreightRow
                key={row.id}
                row={row}
                open={openId === row.id}
                onToggle={() => setOpenId(openId === row.id ? null : row.id)}
              />
            ))}
          </TBody>
        </Table>
      )}

      <RecordFreightModal open={recording} onOpenChange={setRecording} />
    </div>
  );
}

function FreightRow({
  row,
  open,
  onToggle,
}: {
  readonly row: FreightChargeView;
  readonly open: boolean;
  readonly onToggle: () => void;
}): ReactElement {
  const total = Number(row.totalInr);
  const settled = Number(row.amountSettledInr);
  const pct = total <= 0 ? 0 : Math.min(100, Math.round((settled / total) * 100));

  return (
    <Fragment>
      <Tr>
        <Td>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="text-text-muted hover:text-text mb-1 inline-flex items-center gap-1 text-xs"
          >
            <ChevronRight
              className={`size-3 transition-transform ${open ? 'rotate-90' : ''}`}
              aria-hidden
            />
            How this cost happened
          </button>
          {/* Straight to the consignment: a freight bill on its own says
            what was charged, not what arrived. */}
          <Link href={`/warehouse/consignments/${row.consignmentId}`} className="hover:underline">
            <Ident value={row.consignmentNumber ?? `${row.consignmentId.slice(0, 8)}…`} />
          </Link>
          {/* Which ARRIVAL this bill covers. A consignment can carry more
            than one, so the consignment number alone no longer says
            which shipment was invoiced. */}
          {row.receiptNumber !== null && (
            <div className="text-text-faint mt-0.5 text-xs">{row.receiptNumber}</div>
          )}
          {/* WHOSE consignment. Two bills with adjacent numbers look
            identical here and may belong to different sellers — which
            matters, because the bill is charged to one of them. */}
          {row.sellerCompanyName !== null && (
            <div className="text-text-muted mt-0.5 text-xs">{row.sellerCompanyName}</div>
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
          <OurCostCell row={row} />
        </Td>
        <Td align="right">
          <Money amount={row.amountSettledInr} />
          {/* The bar carries the same fact as the number beside it — it
            is a scanning aid, not the only encoding. */}
          <div
            className="bg-surface-hover mt-1 h-1 w-full overflow-hidden rounded-full"
            aria-hidden
          >
            <div className="bg-[var(--status-delivered-fg)] h-full" style={{ width: `${pct}%` }} />
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
      {open && (
        <Tr>
          <Td colSpan={9} className="bg-surface-raised">
            <CostBreakdown freightChargeId={row.id} billedInr={row.totalInr} />
          </Td>
        </Tr>
      )}
    </Fragment>
  );
}

/**
 * The working behind one bill.
 *
 * Two halves, answering different questions. The SPLIT says how the
 * total was divided — freight is priced by weight, so a heavy SKU
 * carries more of it, and a bill that looks wrong is usually one line
 * that does. The PAYMENTS say what has actually gone out, from which
 * account and in which currency, which is a different fact from what
 * the forwarder billed.
 */
function CostBreakdown({
  freightChargeId,
  billedInr,
}: {
  readonly freightChargeId: string;
  readonly billedInr: string;
}): ReactElement {
  const q = useFreightCostBreakdown(freightChargeId);

  if (q.isLoading) return <p className="text-text-muted py-2 text-xs">Loading…</p>;
  if (q.isError || q.data === undefined) {
    return <p className="text-danger py-2 text-xs">Could not load the breakdown.</p>;
  }

  const d = q.data;
  const splitTotal = d.lines.reduce((t, l) => t + Number(l.lineTotalInr), 0);

  return (
    <div className="grid gap-5 py-1 lg:grid-cols-2">
      <div>
        <div className="text-text-muted mb-1.5 text-xs font-medium tracking-wide uppercase">
          Split across the lines it covers
        </div>
        {d.lines.length === 0 ? (
          <p className="text-text-faint text-xs">
            No allocation lines — this bill was recorded without a per-line split, so nothing here
            can say which product carried what.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-text-faint text-left">
              <tr>
                <th className="py-1 pr-2 font-medium">Product</th>
                <th className="py-1 pr-2 text-right font-medium">Units</th>
                <th className="py-1 pr-2 text-right font-medium">Weight</th>
                <th className="py-1 pr-2 text-right font-medium">Per unit</th>
                <th className="py-1 text-right font-medium">Line</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l, i) => (
                <tr key={`${l.skuCode ?? i}`} className="border-border/60 border-t">
                  <td className="py-1 pr-2">
                    <div>{l.productName ?? '—'}</div>
                    <div className="text-text-faint font-mono">{l.skuCode ?? ''}</div>
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {l.unitsSettled}/{l.units}
                  </td>
                  <td className="text-text-muted py-1 pr-2 text-right tabular-nums">
                    {/* The number the split was made ON. Freight is
                        priced by weight, so a line with no weight fell
                        back to a count share — worth seeing. */}
                    {l.chargeableWeightKg === null ? '—' : `${l.chargeableWeightKg} kg`}
                  </td>
                  <td className="py-1 pr-2 text-right">
                    <Money amount={l.perUnitInr} />
                  </td>
                  <td className="py-1 text-right">
                    <Money amount={l.lineTotalInr} />
                  </td>
                </tr>
              ))}
              <tr className="border-border border-t font-medium">
                <td className="py-1 pr-2" colSpan={4}>
                  Lines add up to
                </td>
                <td className="py-1 text-right">
                  <Money amount={splitTotal.toFixed(2)} />
                </td>
              </tr>
            </tbody>
          </table>
        )}
        {/* Said out loud rather than left to be noticed: if the split
            does not reach the bill, some of it is charged to nothing. */}
        {d.lines.length > 0 && Math.abs(splitTotal - Number(billedInr)) > 0.01 && (
          <p className="text-warning mt-2 text-xs">
            The lines come to {splitTotal.toFixed(2)} but the bill is {billedInr}. Part of this bill
            is attached to no line, so it will never be recovered as those units sell.
          </p>
        )}
      </div>

      <div>
        <div className="text-text-muted mb-1.5 text-xs font-medium tracking-wide uppercase">
          What we have paid the forwarder
        </div>
        {d.payments.length === 0 ? (
          <p className="text-text-faint text-xs">
            Nothing recorded as paid.
            {d.ourCostInr !== null && (
              <> Our cost is noted as {d.ourCostInr}, but no payment sits behind it.</>
            )}
          </p>
        ) : (
          <ul className="space-y-1.5 text-xs">
            {d.payments.map((p, i) => (
              <li key={`${p.reference ?? i}`} className="flex items-start justify-between gap-3">
                <div>
                  <div>{p.accountLabel}</div>
                  <div className="text-text-faint">
                    {new Date(p.occurredAt).toLocaleDateString('en-IN')}
                    {p.reference !== null && <> · {p.reference}</>}
                    {p.recordedByName !== null && <> · by {p.recordedByName}</>}
                  </div>
                </div>
                <Money
                  amount={p.amount}
                  currency={p.currency === 'BDT' ? 'BDT' : 'INR'}
                  convert={false}
                  direction="debit"
                />
              </li>
            ))}
            {/* Per currency, never summed. Two payments in two
                currencies have no meaningful total, and one would
                invite reading BDT + INR as INR. */}
            {d.paidTotalByCurrency.map((t) => (
              <li
                key={t.currency}
                className="border-border flex items-center justify-between gap-3 border-t pt-1.5 font-medium"
              >
                <span>Paid in {t.currency}</span>
                <Money
                  amount={t.amount}
                  currency={t.currency === 'BDT' ? 'BDT' : 'INR'}
                  convert={false}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function humanise(value: string): string {
  const lower = value.replaceAll('_', ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
