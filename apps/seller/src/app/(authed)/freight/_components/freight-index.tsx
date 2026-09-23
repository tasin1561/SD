'use client';

import Link from 'next/link';

import { useMemo, useState, type ReactElement } from 'react';
import { Ident, Money, Num } from '@skydrop/ui/components';
import { Boxes, Info, PlaneTakeoff, ReceiptText, Wallet } from 'lucide-react';
import { InboundFreightStatus } from '@skydrop/db';
import { freightModeWords, inboundFreightStatusKind, statusLabel } from '@skydrop/ui/status';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Tabs } from '@skydrop/ui/app/tabs';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useSellerFreight } from '@/lib/ops-hooks';
import './freight.css';

/** The filter tab that means "no status filter". */
const ALL = 'all';

/**
 * What it cost to get each consignment into India, and how much of that
 * is still owed.
 *
 * Read-only by design: freight is billed by Skydrop and settled from the
 * wallet, so there is nothing here for a seller to change. What they
 * need is the arithmetic — the per-unit amortisation means a bill does
 * not become fully payable until the consignment has actually sold, and
 * that is not obvious unless the screen shows it.
 *
 * ── WHAT THE CONSOLE COMPS SHOW THAT WE DO NOT HAVE ─────────────────
 * Dropped rather than faked, because every figure on this page is a
 * charge against somebody's wallet:
 *
 *   PER-KG RATE / LANE     the bill is a total we were invoiced by the
 *                          forwarder, split over the receipt's counted
 *                          lines by weight. No rate card, no named lane
 *                          and no carrier is recorded against it, so
 *                          there is nothing to put in a "₹/kg" column.
 *   NEXT CHARGE DATE       a share is charged when a UNIT leaves, not on
 *                          a schedule. There is no next date to show —
 *                          which is the whole point of the arithmetic
 *                          the footer explains.
 *   OUR COST vs YOURS      the forwarder payment behind a bill (FRT-4)
 *                          is Skydrop's own cost and is not on the
 *                          seller view. It is our margin, not their bill.
 */
export function SellerFreightIndex(): ReactElement {
  const [status, setStatus] = useState<string>('');
  const list = useSellerFreight(status === '' ? {} : { status });

  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  // The API's own figure covers live bills; on the withdrawn filter the
  // rows carry an arithmetic outstanding that is not a debt, so the
  // total is taken from the rows that are actually owed.
  const outstanding =
    status === InboundFreightStatus.VOIDED ? '0' : (list.data?.outstandingInr ?? '0');

  /**
   * The totals of what is ON SCREEN, which is what the filter chips
   * change. Summed from the rows the endpoint just returned rather than
   * asked for separately: a subtotal computed from the same rows the
   * table renders cannot disagree with it, and a second round trip can.
   */
  const totals = useMemo(() => {
    let billed = 0;
    let charged = 0;
    let unitsSettled = 0;
    let unitsTotal = 0;
    for (const r of rows) {
      billed += Number(r.totalInr);
      charged += Number(r.amountSettledInr);
      unitsSettled += r.unitsSettled;
      unitsTotal += r.totalUnits;
    }
    return { billed, charged, unitsSettled, unitsTotal };
  }, [rows]);

  const filtered = status !== '';
  const loaded = !list.isLoading && !list.isError;

  const dash = <span className="frt-dash">—</span>;

  return (
    <div className="frt-page">
      <PageHeader
        breadcrumbs={[
          { label: 'Seller console' },
          { label: 'Money' },
          { label: 'Inbound freight' },
        ]}
        Link={Link}
        title="Inbound freight"
        subtitle="The shipping cost of getting your stock from Bangladesh into our Indian warehouse. WHEN it is charged depends on the terms agreed for each consignment — see Terms on each row."
        meta={
          !loaded ? undefined : (
            <span className="frt-meta">
              <span className="frt-fact" data-tone="accent">
                {rows.length} {rows.length === 1 ? 'bill' : 'bills'}
              </span>
              {Number(outstanding) > 0 && (
                <span className="frt-fact" data-tone="warn">
                  <span className="frt-fact__dot" aria-hidden />
                  Still owed
                </span>
              )}
              {totals.unitsTotal > 0 && (
                <span className="frt-fact">
                  {totals.unitsSettled} of {totals.unitsTotal} units charged
                </span>
              )}
            </span>
          )
        }
      />

      {/* ── What the freight has cost, and how much of it has landed ──
             Four cards, every one summed from the rows below or handed
             over by the server. Nothing here is an estimate: a bill is
             what a forwarder invoiced, and "charged so far" is what has
             actually come out of the wallet. A figure is ABSENT rather
             than 0 while loading — "₹0 still owed" that then becomes
             ₹40,000 has said something false in the meantime. The money
             figures are the same `<Money>` nodes, handed over as
             `figure`; the two counts roll up once when they first land. */}
      <div className="frt-kpis">
        <KpiCard
          label="Still owed"
          icon={<Wallet size={14} />}
          figure={loaded ? <Money amount={outstanding} decimals={false} /> : dash}
          tone={loaded && Number(outstanding) > 0 ? 'pending' : 'neutral'}
          hint="What is still to be taken from your wallet"
        />
        <KpiCard
          label="Billed to you"
          icon={<ReceiptText size={14} />}
          figure={loaded ? <Money amount={totals.billed} decimals={false} /> : dash}
          tone="neutral"
          {...(loaded
            ? {
                foot: [
                  {
                    label: 'Charged so far',
                    value: <Money amount={totals.charged} decimals={false} />,
                  },
                ],
              }
            : {})}
        />
        {loaded ? (
          <KpiCard
            label="Consignments billed"
            icon={<PlaneTakeoff size={14} />}
            value={rows.length}
            unit={rows.length === 1 ? 'bill' : 'bills'}
            tone="neutral"
            hint={filtered ? humanise(status) : 'Every status.'}
          />
        ) : (
          <KpiCard
            label="Consignments billed"
            icon={<PlaneTakeoff size={14} />}
            figure={dash}
            tone="neutral"
            hint={filtered ? humanise(status) : 'Every status.'}
          />
        )}
        {loaded ? (
          <KpiCard
            label="Units charged"
            icon={<Boxes size={14} />}
            value={totals.unitsSettled}
            unit={
              <>
                of <Num value={totals.unitsTotal} />
              </>
            }
            tone="neutral"
            hint="A unit is charged its share when it is delivered."
          />
        ) : (
          <KpiCard
            label="Units charged"
            icon={<Boxes size={14} />}
            figure={dash}
            tone="neutral"
            hint="A unit is charged its share when it is delivered."
          />
        )}
      </div>

      <section className="frt-section">
        <SectionHeading
          title="Freight bills"
          note={
            loaded
              ? `${rows.length} ${rows.length === 1 ? 'bill' : 'bills'}${filtered ? ' matching' : ''}`
              : undefined
          }
          action={
            filtered ? (
              <button type="button" onClick={() => setStatus('')} className="frt-reset">
                Reset
              </button>
            ) : undefined
          }
        />

        {/* Four statuses, all worth seeing at once — a tab row says what
            the possibilities ARE, which a closed dropdown does not. */}
        <Tabs
          label="Filter by status"
          size="sm"
          value={status === '' ? ALL : status}
          onChange={(id) => setStatus(id === ALL ? '' : id)}
          items={[
            { id: ALL, label: 'All bills' },
            ...Object.values(InboundFreightStatus).map((s) => ({ id: s, label: humanise(s) })),
          ]}
        />

        {list.isError ? (
          <ErrorState
            message={list.error?.message ?? 'Failed to load freight bills.'}
            retry={() => void list.refetch()}
          />
        ) : list.isLoading ? (
          <SkeletonRows rows={4} cols={6} label="Loading freight bills…" />
        ) : rows.length === 0 ? (
          <EmptyState
            title={filtered ? 'No bills with that status' : 'No freight bills yet'}
            description={
              filtered
                ? 'Try another status, or reset the filter.'
                : 'A bill appears here once we receive a consignment from you and record what the freight cost.'
            }
          />
        ) : (
          <Table caption="Freight bills">
            <THead>
              <Tr>
                <Th>Consignment</Th>
                <Th>Terms</Th>
                <Th align="right">Total</Th>
                <Th align="right">Charged so far</Th>
                <Th align="right">Still owed</Th>
                <Th>Units charged</Th>
                <Th>Status</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    {/* The bill is for one ARRIVAL, but the details a seller
                      wants — what was declared, what was counted, where it
                      is — live on the consignment, so that is where this
                      goes. */}
                    <div className="frt-cons">
                      <Link href={`/inbound/${r.consignmentId}`} className="frt-cons__link">
                        <Ident value={r.receiptNumber ?? `${r.goodsReceiptId.slice(0, 8)}…`} />
                      </Link>
                      <span className="frt-faint sk-figure">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                      {r.voidedAt !== null && (
                        <span className="frt-muted">
                          Withdrawn {new Date(r.voidedAt).toLocaleDateString()} — this bill was
                          wrong and anything it charged has gone back to your wallet.
                          {r.voidReason === null ? '' : ` ${r.voidReason}`}
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <div className="frt-terms">
                      <span>{freightModeWords(r.mode, 'SELLER')}</span>
                      {r.serviceChargeInr !== null && Number(r.serviceChargeInr) > 0 && (
                        <span className="frt-faint">
                          includes <Money amount={r.serviceChargeInr} decimals={false} /> service
                          charge
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td align="right">
                    <Money amount={r.totalInr} />
                    {/* The figure agreed on the phone, when that was not
                      rupees. Without it "why ₹162.60?" has no answer,
                      and the rate is the thing the seller actually
                      negotiated. */}
                    {r.agreedCurrency !== 'INR' && (
                      <div className="frt-faint">
                        <Money
                          amount={r.agreedAmount}
                          currency={r.agreedCurrency}
                          convert={false}
                        />{' '}
                        agreed
                      </div>
                    )}
                  </Td>
                  <Td align="right">
                    <Money amount={r.amountSettledInr} />
                  </Td>
                  <Td align="right">
                    {/* A withdrawn bill still computes total minus
                      settled; it is not a debt. Showing the arithmetic
                      would tell a seller they owe money we took back. */}
                    {r.voidedAt !== null ? (
                      <span className="frt-faint">Nothing — withdrawn</span>
                    ) : Number(r.outstandingInr) === 0 ? (
                      <span className="frt-faint">—</span>
                    ) : (
                      <Money amount={r.outstandingInr} direction="debit" />
                    )}
                  </Td>
                  <Td className="frt-units sk-figure">
                    <Num value={r.unitsSettled} /> / <Num value={r.totalUnits} />
                  </Td>
                  <Td>
                    <StatusChip
                      kind={inboundFreightStatusKind(r.status)}
                      label={statusLabel(r.status)}
                      size="sm"
                    />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      {rows.some((r) => r.mode === 'PAY_LATER') && (
        <section className="frt-section">
          <SectionHeading title="How a bill is charged" />
          <div className="frt-note">
            <span className="frt-note__icon" aria-hidden>
              <Info size={16} />
            </span>
            <p>
              On pay-as-it-sells terms, each unit carries its share of the consignment&apos;s
              freight, and that share is deducted from your wallet when the unit is delivered. Stock
              still sitting in the warehouse has not been charged for yet — which is why a bill can
              stay partly owed for a long time without anything being wrong.
            </p>
          </div>
        </section>
      )}

      {/* The bottom strip: the figures somebody came to this page for,
          still readable after scrolling past the table. */}
      {loaded && (
        <div className="frt-strip">
          <StripFact
            label="Still owed"
            value={<Money amount={outstanding} decimals={false} />}
            tone={Number(outstanding) > 0 ? 'warn' : 'good'}
          />
          <StripFact label="Billed" value={<Money amount={totals.billed} decimals={false} />} />
          <StripFact
            label="Units charged"
            value={`${totals.unitsSettled} / ${totals.unitsTotal}`}
          />
        </div>
      )}
    </div>
  );
}

/** One label/value pair in the bottom strip. */
function StripFact({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: ReactElement | string;
  readonly tone?: 'good' | 'warn' | undefined;
}): ReactElement {
  return (
    <span className="frt-strip__fact">
      <span className="frt-strip__label">{label}</span>
      <span className="frt-strip__value sk-figure" data-tone={tone}>
        {value}
      </span>
    </span>
  );
}

function humanise(value: string): string {
  const lower = value.replaceAll('_', ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
