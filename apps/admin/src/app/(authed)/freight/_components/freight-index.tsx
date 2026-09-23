'use client';

import Link from 'next/link';

import { Fragment, useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import { ChevronRight, Plus, TriangleAlert } from 'lucide-react';
import { Ident, Money, Num } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { Button } from '@skydrop/ui/app/button';
import { Select } from '@skydrop/ui/app/select';
import { InboundFreightStatus } from '@skydrop/db';
import { freightModeWords } from '@skydrop/ui/status';
import { useFreightCostBreakdown, useFreightList, type FreightChargeView } from '@/lib/ops-hooks';
import { RecordFreightModal } from './record-freight-modal';
import { FreightActions } from './freight-actions';
import { OurCostCell } from './our-cost-cell';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { FreightChip, MkCallout, MkCard } from '../../seller-wallets/_components/money-parts';

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

  // A WITHDRAWN bill still reports total − settled as outstanding — the
  // arithmetic is unchanged, the debt is not. Counting it would show a
  // figure nobody owes.
  const outstanding = rows.reduce(
    (sum, r) => sum + (r.voidedAt === null ? Number(r.outstandingInr) : 0),
    0,
  );
  const pendingCount = rows.filter(
    (r) =>
      r.status === InboundFreightStatus.PENDING ||
      r.status === InboundFreightStatus.PARTIALLY_SETTLED,
  ).length;
  const waived = rows
    .filter((r) => r.status === InboundFreightStatus.WAIVED)
    .reduce((sum, r) => sum + Number(r.totalInr), 0);

  return (
    <div className="mk-page">
      <PageHeader
        title="Inbound freight"
        subtitle="One bill per BD→India consignment, split over the units that actually landed. Pay-now debits the wallet immediately; pay-later leaves a receivable that amortises per unit as the stock sells."
        action={
          canWrite ? (
            <Button
              variant="primary"
              size="md"
              icon={<Plus size={15} />}
              onClick={() => setRecording(true)}
            >
              Record freight bill
            </Button>
          ) : null
        }
      />

      <div className="mk-kpis">
        <KpiCard
          label="Outstanding"
          figure={<Money amount={outstanding} decimals={false} />}
          tone={outstanding > 0 ? 'pending' : 'credit'}
          hint={`${pendingCount} bill${pendingCount === 1 ? '' : 's'} still owing`}
        />
        <KpiCard
          label="Bills shown"
          figure={list.isLoading ? '—' : rows.length}
          hint={status === '' ? 'All statuses' : humanise(status)}
        />
        <KpiCard
          label="Waived"
          figure={<Money amount={waived} decimals={false} />}
          hint="Forgiven — money we chose not to collect"
        />
      </div>

      <div className="mk-filters">
        <Select
          id="freight-status"
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {Object.values(InboundFreightStatus).map((s) => (
            <option key={s} value={s}>
              {humanise(s)}
            </option>
          ))}
        </Select>
      </div>

      {list.isError ? (
        <ErrorState
          message={list.error?.message ?? 'Failed to load freight bills.'}
          retry={() => void list.refetch()}
        />
      ) : list.isLoading ? (
        <SkeletonRows rows={5} cols={9} label="Loading freight bills…" />
      ) : rows.length === 0 ? (
        <EmptyState
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
      ) : (
        <MkCard flush>
          <Table caption="Freight bills">
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
        </MkCard>
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
          <button type="button" onClick={onToggle} aria-expanded={open} className="mk-toggle">
            <ChevronRight size={13} className="mk-toggle__chev" aria-hidden />
            How this cost happened
          </button>
          {/* Straight to the consignment: a freight bill on its own says
            what was charged, not what arrived. */}
          <Link href={`/warehouse/consignments/${row.consignmentId}`} className="mk-inline-link">
            <Ident value={row.consignmentNumber ?? `${row.consignmentId.slice(0, 8)}…`} />
          </Link>
          {/* Which ARRIVAL this bill covers. A consignment can carry more
            than one, so the consignment number alone no longer says
            which shipment was invoiced. */}
          {row.receiptNumber !== null && (
            <div className="mk-faint sk-ident">{row.receiptNumber}</div>
          )}
          {/* WHOSE consignment. Two bills with adjacent numbers look
            identical here and may belong to different sellers — which
            matters, because the bill is charged to one of them. */}
          {row.sellerCompanyName !== null && (
            <div className="mk-small">{row.sellerCompanyName}</div>
          )}
          <div className="mk-faint sk-figure">{new Date(row.createdAt).toLocaleDateString()}</div>
          {/* Said here rather than only in a badge: a withdrawn bill is
            only ever looked at to find out what was wrong with it. */}
          {row.voidedAt !== null && (
            <div className="mk-small">
              Withdrawn {new Date(row.voidedAt).toLocaleDateString()}
              {row.voidReason === null ? '' : ` — ${row.voidReason}`}
            </div>
          )}
        </Td>
        <Td className="mk-small">
          {freightModeWords(row.mode, 'STAFF')}
          {row.serviceChargeInr !== null && Number(row.serviceChargeInr) > 0 && (
            <div className="mk-faint">
              +<Money amount={row.serviceChargeInr} decimals={false} /> service
            </div>
          )}
        </Td>
        <Td align="right">
          <Money amount={row.totalInr} />
          {/* What was AGREED, when that is not rupees. The seller is
            charged the figure on the left; this is the figure on the
            forwarder's invoice, and "why is it ₹162.60?" has no answer
            without it. */}
          {row.agreedCurrency !== 'INR' && (
            <div className="mk-faint">
              <Money
                amount={row.agreedAmount}
                currency={row.agreedCurrency}
                convert={false}
                decimals={false}
              />{' '}
              agreed
            </div>
          )}
        </Td>
        <Td align="right">
          <OurCostCell row={row} />
        </Td>
        <Td align="right">
          <Money amount={row.amountSettledInr} />
          {/* The bar carries the same fact as the number beside it — it
            is a scanning aid, not the only encoding. */}
          <span className="mk-bar" aria-hidden>
            <span
              className="mk-bar__fill"
              style={{ '--mk-pct': String(pct / 100) } as CSSProperties}
            />
          </span>
        </Td>
        <Td align="right">
          {row.voidedAt !== null ? (
            <span className="mk-faint">Withdrawn</span>
          ) : Number(row.outstandingInr) === 0 ? (
            <span className="mk-faint">—</span>
          ) : (
            <Money amount={row.outstandingInr} direction="debit" />
          )}
        </Td>
        <Td className="mk-small">
          <Num value={row.unitsSettled} /> / <Num value={row.totalUnits} />
        </Td>
        <Td>
          <FreightChip status={row.status} />
        </Td>
        <Td align="right">
          <FreightActions row={row} />
        </Td>
      </Tr>
      {open && (
        <Tr>
          <Td colSpan={9}>
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

  if (q.isLoading) return <SkeletonRows rows={3} cols={4} label="Loading the breakdown…" />;
  if (q.isError || q.data === undefined) {
    return (
      <ErrorState
        message={serverVerdict(q.error, 'Could not load the breakdown.')}
        retry={() => void q.refetch()}
      />
    );
  }

  const d = q.data;
  const splitTotal = d.lines.reduce((t, l) => t + Number(l.lineTotalInr), 0);
  // The rates and line figures below are in what was AGREED; the rupee
  // column beside them is what the seller is actually charged. Shown
  // together rather than one or the other, because the invoice is
  // checked against the first and the wallet against the second.
  const agreed = d.agreedCurrency === 'INR' ? null : d.agreedCurrency;

  return (
    <div className="mk-well mk-well--2">
      <div>
        <h4 className="mk-well__title">Split across the lines it covers</h4>
        {d.lines.length === 0 ? (
          <p className="mk-faint">
            No allocation lines — this bill was recorded without a per-line split, so nothing here
            can say which product carried what.
          </p>
        ) : (
          <Table caption="Freight split by line">
            <THead>
              <Tr>
                <Th>Product</Th>
                <Th align="right">Units</Th>
                <Th align="right">Weight</Th>
                <Th align="right">Rate{agreed === null ? '' : ` (${agreed})`}</Th>
                <Th align="right">Per unit</Th>
                <Th align="right">Line</Th>
              </Tr>
            </THead>
            <TBody>
              {d.lines.map((l, i) => (
                <Tr key={`${l.skuCode ?? i}`}>
                  <Td>
                    <div>{l.productName ?? '—'}</div>
                    <div className="mk-faint sk-ident">{l.skuCode ?? ''}</div>
                  </Td>
                  <Td align="right">
                    <span className="sk-figure">
                      {l.unitsSettled}/{l.units}
                    </span>
                  </Td>
                  <Td align="right">
                    {/* The number the split was made ON. Freight is
                        priced by weight, so a line with no weight fell
                        back to a count share — worth seeing. */}
                    <span className="mk-small sk-figure">
                      {l.chargeableWeightKg === null ? '—' : `${l.chargeableWeightKg} kg`}
                    </span>
                  </Td>
                  <Td align="right">
                    <Money amount={l.rate} currency={agreed ?? 'INR'} convert={false} />
                  </Td>
                  <Td align="right">
                    <Money amount={l.perUnitInr} />
                  </Td>
                  <Td align="right">
                    <Money amount={l.lineTotalInr} />
                    {agreed !== null && (
                      <div className="mk-faint">
                        <Money
                          amount={l.lineTotalAgreed}
                          currency={d.agreedCurrency}
                          convert={false}
                        />{' '}
                        agreed
                      </div>
                    )}
                  </Td>
                </Tr>
              ))}
              <Tr>
                <Td colSpan={5}>
                  <span className="mk-strong">Lines add up to</span>
                </Td>
                <Td align="right">
                  <span className="mk-strong">
                    <Money amount={splitTotal.toFixed(2)} />
                  </span>
                </Td>
              </Tr>
            </TBody>
          </Table>
        )}
        {/* Said out loud rather than left to be noticed: if the split
            does not reach the bill, some of it is charged to nothing. */}
        {d.lines.length > 0 && Math.abs(splitTotal - Number(billedInr)) > 0.01 && (
          <MkCallout tone="warn" icon={<TriangleAlert size={16} />}>
            <p>
              The lines come to <Money amount={splitTotal.toFixed(2)} convert={false} /> but the
              bill is <Money amount={billedInr} convert={false} />. Part of this bill is attached to
              no line, so it will never be recovered as those units sell.
            </p>
          </MkCallout>
        )}
      </div>

      <div>
        <h4 className="mk-well__title">What we have paid the forwarder</h4>
        {d.payments.length === 0 ? (
          <p className="mk-faint">
            Nothing recorded as paid.
            {d.ourCostInr !== null && (
              <>
                {' '}
                Our cost is noted as <Money amount={d.ourCostInr} convert={false} />, but no payment
                sits behind it.
              </>
            )}
          </p>
        ) : (
          <ul className="mk-list">
            {d.payments.map((p, i) => (
              <li key={`${p.reference ?? i}`} className="mk-list__row">
                <div className="mk-cell">
                  <span className="mk-body">{p.accountLabel}</span>
                  <span className="mk-faint">
                    {new Date(p.occurredAt).toLocaleDateString('en-IN')}
                    {p.reference !== null && <> · {p.reference}</>}
                    {p.recordedByName !== null && <> · by {p.recordedByName}</>}
                  </span>
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
              <li key={t.currency} className="mk-list__row mk-strong">
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
