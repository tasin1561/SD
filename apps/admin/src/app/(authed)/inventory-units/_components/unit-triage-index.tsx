'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import {
  Card,
  CardBody,
  EmptyState,
  ErrorNote,
  Ident,
  Num,
  PageHeader,
  Section,
  Skeleton,
  Stat,
  StatusBadge,
  StockUnitStatusBadge,
  TBody,
  Table,
  Td,
  THead,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { useSellerUnitReport, useUnitTriage, type StuckUnitRow } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Serialized-unit discrepancies, from the warehouse's side.
 *
 * The seller version of this screen answers "what is wrong with MY
 * stock". An operator has a different question — *whose* stock needs
 * looking at — so this leads with a cross-seller queue and drills in.
 *
 * The drill-down renders the same report the seller sees, computed by
 * the same code. That matters during a support call: the operator and
 * the seller are looking at one number, not two that might disagree.
 *
 * Read-only throughout. Where the unit ledger and the aggregate
 * disagree, the discrepancy is surfaced and never auto-corrected — a
 * silent reconcile would destroy the evidence of what happened on the
 * floor. Fixing one is a stock adjustment through the normal path, with
 * its reason code and its audit row.
 */
export function UnitTriageIndex(): ReactElement {
  const [selected, setSelected] = useState<string | null>(null);
  const triage = useUnitTriage();
  const data = triage.data;

  return (
    <div>
      <PageHeader
        title="Unit discrepancies"
        subtitle="For SKUs tracked per unit by serial. Which sellers have a scan missing, a parcel unaccounted for, or serials that disagree with the stock count."
      />

      {triage.isError ? (
        <ErrorNote message={serverVerdict(triage.error)} retry={() => void triage.refetch()} />
      ) : triage.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Stat
              label="Needs attention"
              value={<Num value={data?.totalNeedsAttention ?? 0} />}
              tone={(data?.totalNeedsAttention ?? 0) > 0 ? 'warn' : 'good'}
              hint="Across every seller holding serialized stock"
            />
            <Stat
              label="Sellers affected"
              value={<Num value={data?.sellers.filter((s) => s.needsAttention > 0).length ?? 0} />}
              hint={`of ${data?.examined ?? 0} swept`}
            />
            <Stat
              label="Report generated"
              value={data === undefined ? '—' : new Date(data.generatedAt).toLocaleTimeString()}
              hint="Recomputed on load"
            />
          </div>

          {data?.truncated === true && (
            <ErrorNote
              className="mb-4"
              message={`Only the first ${data.examined} sellers were swept. More hold serialized stock — the rest are not shown, and are not counted above.`}
            />
          )}

          {(data?.sellers.length ?? 0) === 0 ? (
            <EmptyState
              title="No serialized stock anywhere"
              description="Nothing to reconcile — no seller has a SKU set to strict per-unit tracking yet."
            />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Seller</Th>
                  <Th align="right">Stuck</Th>
                  <Th align="right">Unresolved dispatch</Th>
                  <Th align="right">Count mismatch</Th>
                  <Th align="right">Total</Th>
                  <Th>Their thresholds</Th>
                </Tr>
              </THead>
              <TBody>
                {data?.sellers.map((s) => (
                  <Tr
                    key={s.sellerId}
                    interactive
                    onClick={() => setSelected(selected === s.sellerId ? null : s.sellerId)}
                  >
                    <Td>
                      <span className="text-text-strong">{s.companyName ?? 'Unknown seller'}</span>
                      <div className="mt-0.5">
                        <Link
                          href={`/sellers/${s.sellerId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-accent hover:underline"
                        >
                          <Ident value={`${s.sellerId.slice(0, 8)}…`} />
                        </Link>
                      </div>
                    </Td>
                    <Td align="right">
                      <Num value={s.stuckUnits} />
                    </Td>
                    <Td align="right">
                      {s.unresolvedDispatched > 0 ? (
                        <span className="text-[var(--color-critical)]">
                          <Num value={s.unresolvedDispatched} />
                        </span>
                      ) : (
                        <Num value={0} />
                      )}
                    </Td>
                    <Td align="right">
                      {s.countMismatches > 0 ? (
                        <span className="text-[var(--color-critical)]">
                          <Num value={s.countMismatches} />
                        </span>
                      ) : (
                        <Num value={0} />
                      )}
                    </Td>
                    <Td align="right">
                      {s.needsAttention === 0 ? (
                        <StatusBadge kind="delivered" label="clear" />
                      ) : (
                        <span className="text-text-bright font-medium">
                          <Num value={s.needsAttention} />
                        </span>
                      )}
                    </Td>
                    <Td className="text-text-faint whitespace-nowrap text-xs">
                      stuck &gt;{s.thresholds.stuckSlaHours}h · dispatch &gt;
                      {s.thresholds.dispatchedUnresolvedDays}d
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}

          {selected !== null && <SellerDetail sellerId={selected} />}

          <Card className="mt-4">
            <CardBody>
              <p className="text-text-muted text-xs leading-relaxed">
                Thresholds are per seller and overridable, so &ldquo;stuck&rdquo; means past{' '}
                <em>that</em> seller&apos;s SLA. Retired units — written off or lost — are
                deliberately excluded from the totals: they are settled facts rather than work, and
                counting them would mean the queue never reaches zero.
              </p>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

function SellerDetail({ sellerId }: { readonly sellerId: string }): ReactElement {
  const report = useSellerUnitReport(sellerId);
  const d = report.data;

  return (
    <Section
      className="mt-5"
      title="Detail"
      subtitle="Exactly what this seller sees on their own screen — same computation, so the two cannot disagree."
    >
      {report.isError ? (
        <ErrorNote message={serverVerdict(report.error)} retry={() => void report.refetch()} />
      ) : report.isLoading ? (
        <Card>
          <Skeleton className="m-3 h-24" />
        </Card>
      ) : (
        <div className="space-y-4">
          <UnitTable
            title="Stuck mid-lifecycle"
            rows={d?.stuckUnits ?? []}
            empty="Every unit that started a pick has been scanned on."
          />
          <UnitTable
            title="Unresolved dispatches"
            rows={d?.unresolvedDispatched ?? []}
            empty="Every dispatched unit has been delivered or come back."
          />
          {(d?.countMismatches.length ?? 0) > 0 && (
            <div>
              <h4 className="text-text-muted mb-2 text-xs font-medium tracking-wide uppercase">
                Count mismatches
              </h4>
              <Table>
                <THead>
                  <Tr>
                    <Th>SKU</Th>
                    <Th>Warehouse</Th>
                    <Th align="right">Serials</Th>
                    <Th align="right">On hand</Th>
                    <Th align="right">Difference</Th>
                  </Tr>
                </THead>
                <TBody>
                  {d?.countMismatches.map((m) => (
                    <Tr key={`${m.variantId}-${m.warehouseId}`}>
                      <Td>
                        <Ident value={m.skuCode ?? m.variantId.slice(0, 8)} />
                      </Td>
                      <Td className="text-text-muted text-xs">
                        <Ident value={m.warehouseId.slice(0, 8)} />
                      </Td>
                      <Td align="right">
                        <Num value={m.unitsInStock} />
                      </Td>
                      <Td align="right">
                        <Num value={m.qtyOnHand} />
                      </Td>
                      <Td align="right" className="text-[var(--color-critical)]">
                        <Num value={m.delta > 0 ? `+${m.delta}` : m.delta} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function UnitTable({
  title,
  rows,
  empty,
}: {
  readonly title: string;
  readonly rows: readonly StuckUnitRow[];
  readonly empty: string;
}): ReactElement {
  return (
    <div>
      <h4 className="text-text-muted mb-2 text-xs font-medium tracking-wide uppercase">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-text-faint text-xs">{empty}</p>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Serial</Th>
              <Th>SKU</Th>
              <Th>Status</Th>
              <Th align="right">In status</Th>
              <Th>Last scan</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((u) => (
              <Tr key={u.stockUnitId}>
                <Td>
                  <Ident value={u.serialBarcode} />
                </Td>
                <Td className="text-text-muted text-xs">
                  {u.skuCode ?? <Ident value={u.variantId.slice(0, 8)} />}
                </Td>
                <Td>
                  <StockUnitStatusBadge status={u.status} />
                </Td>
                <Td align="right">
                  {u.hoursInStatus >= 48 ? (
                    <span className="text-[var(--status-pending-fg)]">
                      <Num value={Math.round(u.hoursInStatus / 24)} suffix="d" />
                    </span>
                  ) : (
                    <Num value={Math.round(u.hoursInStatus)} suffix="h" />
                  )}
                </Td>
                <Td className="text-text-muted whitespace-nowrap text-xs">
                  {u.lastScanAt === null ? (
                    <StatusBadge kind="failed" label="never scanned" />
                  ) : (
                    new Date(u.lastScanAt).toLocaleString()
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
