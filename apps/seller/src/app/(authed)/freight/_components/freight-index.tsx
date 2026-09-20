'use client';

import Link from 'next/link';

import { useMemo, useState, type ReactElement } from 'react';
import {
  BandBody,
  Crumbs,
  EmptyState,
  ErrorNote,
  FilterChip,
  FreightStatusBadge,
  Ident,
  MetaChip,
  Money,
  Num,
  PageHeader,
  SectionBand,
  SkeletonRows,
  Stat,
  StripFact,
  TBody,
  Table,
  Td,
  THead,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { Boxes, PlaneTakeoff, ReceiptText, Wallet } from 'lucide-react';
import { InboundFreightStatus } from '@skydrop/db';
import { useSellerFreight } from '@/lib/ops-hooks';

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
  const outstanding = list.data?.outstandingInr ?? '0';

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

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[{ label: 'Seller console' }, { label: 'Money' }, { label: 'Inbound freight' }]}
            Link={Link}
          />
        }
        title="Inbound freight"
        subtitle="The shipping cost of getting your stock from Bangladesh into our Indian warehouse. Charged per unit as the stock sells, not all at once."
        meta={
          !loaded ? undefined : (
            <>
              <MetaChip tone="accent">
                {rows.length} {rows.length === 1 ? 'bill' : 'bills'}
              </MetaChip>
              {Number(outstanding) > 0 && (
                <MetaChip tone="warn" dot>
                  Still owed
                </MetaChip>
              )}
              {totals.unitsTotal > 0 && (
                <MetaChip>
                  {totals.unitsSettled} of {totals.unitsTotal} units charged
                </MetaChip>
              )}
            </>
          )
        }
      />

      {/* ── What the freight has cost, and how much of it has landed ──
             Four tiles, every one summed from the rows below or handed
             over by the server. Nothing here is an estimate: a bill is
             what a forwarder invoiced, and "charged so far" is what has
             actually come out of the wallet. A figure is ABSENT rather
             than 0 while loading — "₹0 still owed" that then becomes
             ₹40,000 has said something false in the meantime. */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Still owed"
          icon={<Wallet size={13} aria-hidden />}
          value={
            loaded ? (
              <Money amount={outstanding} decimals={false} />
            ) : (
              <span className="text-text-faint">—</span>
            )
          }
          tone={loaded && Number(outstanding) > 0 ? 'warn' : 'neutral'}
          hint="Recovered from your wallet as the stock sells."
        />
        <Stat
          label="Billed to you"
          icon={<ReceiptText size={13} aria-hidden />}
          value={
            loaded ? (
              <Money amount={totals.billed} decimals={false} />
            ) : (
              <span className="text-text-faint">—</span>
            )
          }
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
        <Stat
          label="Consignments billed"
          icon={<PlaneTakeoff size={13} aria-hidden />}
          value={loaded ? rows.length : <span className="text-text-faint">—</span>}
          unit={loaded ? (rows.length === 1 ? 'bill' : 'bills') : undefined}
          tone="neutral"
          hint={filtered ? humanise(status) : 'Every status.'}
        />
        <Stat
          label="Units charged"
          icon={<Boxes size={13} aria-hidden />}
          value={
            loaded ? (
              <Num value={totals.unitsSettled} />
            ) : (
              <span className="text-text-faint">—</span>
            )
          }
          unit={
            loaded ? (
              <>
                of <Num value={totals.unitsTotal} />
              </>
            ) : undefined
          }
          tone="neutral"
          hint="A unit is charged its share when it is delivered."
        />
      </div>

      <SectionBand
        index="01"
        title="Freight bills"
        note={
          loaded
            ? `${rows.length} ${rows.length === 1 ? 'bill' : 'bills'}${filtered ? ' matching' : ''}`
            : undefined
        }
        action={
          filtered && (
            <button
              type="button"
              onClick={() => setStatus('')}
              className="text-text-faint hover:text-text-body px-1 text-xs transition-colors"
            >
              Reset
            </button>
          )
        }
      />

      <BandBody flush>
        {/* Four statuses, all worth seeing at once — a chip row says what
            the possibilities ARE, which a closed dropdown does not. */}
        <div className="border-border flex flex-wrap items-center gap-1.5 border-b px-3 py-2.5">
          <FilterChip label="All bills" active={status === ''} onClick={() => setStatus('')} />
          {Object.values(InboundFreightStatus).map((s) => (
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
              message={list.error?.message ?? 'Failed to load freight bills.'}
              retry={() => void list.refetch()}
            />
          </div>
        ) : list.isLoading ? (
          <SkeletonRows rows={4} cols={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            bare
            title={filtered ? 'No bills with that status' : 'No freight bills yet'}
            description={
              filtered
                ? 'Try another status, or reset the filter.'
                : 'A bill appears here once we receive a consignment from you and record what the freight cost.'
            }
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Consignment</Th>
                <Th>Terms</Th>
                <Th align="right">Total</Th>
                <Th align="right">Charged so far</Th>
                <Th align="right">Still owed</Th>
                <Th>Units sold</Th>
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
                    <Link href={`/inbound/${r.consignmentId}`} className="hover:underline">
                      <Ident value={r.receiptNumber ?? `${r.goodsReceiptId.slice(0, 8)}…`} />
                    </Link>
                    <div className="text-text-faint mt-0.5 text-xs">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </div>
                  </Td>
                  <Td className="text-text-muted text-xs whitespace-nowrap">
                    {r.mode === 'PAY_NOW' ? 'Paid on arrival' : 'Pay as it sells'}
                    {r.serviceChargeInr !== null && Number(r.serviceChargeInr) > 0 && (
                      <div className="text-text-faint">
                        includes <Money amount={r.serviceChargeInr} decimals={false} /> service
                        charge
                      </div>
                    )}
                  </Td>
                  <Td align="right">
                    <Money amount={r.totalInr} />
                  </Td>
                  <Td align="right">
                    <Money amount={r.amountSettledInr} />
                  </Td>
                  <Td align="right">
                    {Number(r.outstandingInr) === 0 ? (
                      <span className="text-text-faint">—</span>
                    ) : (
                      <Money amount={r.outstandingInr} direction="debit" />
                    )}
                  </Td>
                  <Td className="text-text-muted text-xs whitespace-nowrap">
                    <Num value={r.unitsSettled} /> / <Num value={r.totalUnits} />
                  </Td>
                  <Td>
                    <FreightStatusBadge status={r.status} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </BandBody>

      <SectionBand index="02" title="How a bill is charged" className="mt-4" />
      <BandBody>
        <p className="text-text-muted text-xs leading-relaxed">
          On pay-as-it-sells terms, each unit carries its share of the consignment&apos;s freight,
          and that share is deducted from your wallet when the unit is delivered. Stock still
          sitting in the warehouse has not been charged for yet — which is why a bill can stay
          partly owed for a long time without anything being wrong.
        </p>
      </BandBody>

      {/* The bottom strip: the figures somebody came to this page for,
          still readable after scrolling past the table. */}
      {loaded && (
        <div className="text-text-faint border-border mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3 font-mono text-[11px]">
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

function humanise(value: string): string {
  const lower = value.replaceAll('_', ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
