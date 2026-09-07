'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Play } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorNote,
  Ident,
  Money,
  Num,
  PageHeader,
  Section,
  Select,
  SkeletonRows,
  Stat,
  StatusBadge,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@skydrop/ui/components';
import { useMarginReport, useStoredMarginReport } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { useRouter } from 'next/navigation';

/**
 * What our lanes actually earn.
 *
 * Two properties the screen has to convey honestly, or the number
 * misleads:
 *
 *  - It is SAMPLED. Each row is a live rate-limited courier call, so
 *    the run is opt-in (a button, not an on-mount fetch) and the sample
 *    size is stated next to the totals. A total labelled "margin" over
 *    an unstated sample reads as the whole business.
 *  - It is MEASURED, not assumed. The cost side is what Delhivery
 *    actually BILLED, read from their own wallet ledger and imported
 *    nightly — never a quote. "Quote against the rate card" asks their
 *    calculator what a parcel would cost, which is useful for spotting
 *    a lane priced wrongly, and writes nothing: an estimate in the
 *    invoiced column is indistinguishable from a real charge, and the
 *    P&L reads that column as measured cost.
 */
export function MarginIndex(): ReactElement {
  const router = useRouter();
  const [limit, setLimit] = useState(25);
  const [run, setRun] = useState(false);
  const live = useMarginReport(limit, run);
  /*
    WHAT WE ALREADY KNOW, shown first.

    Every priced parcel's cost has been persisted to
    `shipments.actual_courier_cost_inr` all along — by this report, and
    nightly by the wallet-ledger import — and the page still opened on
    "Not run yet", because the only view it had was the live one. The
    stored view contacts no courier and writes nothing, so it can load
    on arrival; Run then has one job worth its cost, which is pricing
    the parcels that have no figure yet.
  */
  const stored = useStoredMarginReport(limit);
  const report = run ? live : stored;

  const data = report.data;
  const unpriced = stored.data?.skipped.length ?? 0;

  return (
    <div>
      <PageHeader
        title="Lane margin"
        subtitle="What we billed against what the courier actually charged. Measured from Delhivery's own figures, not the rate card's assumption."
        action={
          <div className="flex items-center gap-2">
            <Select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="w-auto text-xs"
              aria-label="Sample size"
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  Sample {n}
                </option>
              ))}
            </Select>
            <Button
              variant="primary"
              size="md"
              disabled={live.isFetching}
              onClick={() => {
                setRun(true);
                void live.refetch();
              }}
              title="Asks the courier's rate calculator what each parcel WOULD cost. An estimate — it writes nothing, and never replaces the invoiced figure."
            >
              <Play size={13} aria-hidden />
              {live.isFetching ? 'Quoting…' : 'Quote against the rate card'}
            </Button>
          </div>
        }
      />

      {report.isError ? (
        <ErrorNote message={serverVerdict(report.error)} retry={() => void report.refetch()} />
      ) : report.isFetching || data === undefined ? (
        <Card>
          <SkeletonRows rows={6} cols={6} />
        </Card>
      ) : data.rows.length === 0 ? (
        <EmptyState
          title="Not invoiced yet"
          description="Nothing in this window has been billed by the courier. Their ledger is imported every night, and each parcel appears here once they charge for it."
        />
      ) : (
        <>
          {!run && (
            <Card className="mb-4">
              <CardBody className="text-text-muted text-xs">
                What the courier actually BILLED, from their own ledger — imported nightly and
                overwritten whenever a charge is re-cut.
                {unpriced > 0 && (
                  <>
                    {' '}
                    {unpriced} parcel{unpriced === 1 ? '' : 's'} in this window{' '}
                    {unpriced === 1 ? 'has' : 'have'} no cost yet and{' '}
                    {unpriced === 1 ? 'is' : 'are'} left out of the totals rather than counted as
                    zero.
                  </>
                )}
              </CardBody>
            </Card>
          )}
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Billed to sellers"
              value={<Money amount={data.totalBilledInr} decimals={false} />}
              hint={`Across ${data.sampledShipments} priced shipment${
                data.sampledShipments === 1 ? '' : 's'
              }`}
            />
            <Stat
              label="Courier charged us"
              value={<Money amount={data.totalActualCostInr} decimals={false} />}
              hint="Delhivery's own figures"
            />
            <Stat
              label="Margin"
              value={<Money amount={data.totalMarginInr} decimals={false} />}
              tone={Number(data.totalMarginInr) < 0 ? 'bad' : 'good'}
              hint="Billed minus actual, pre-tax on both sides"
            />
            <Stat
              label="Loss-making lanes"
              value={data.lossMakingCount}
              tone={data.lossMakingCount > 0 ? 'bad' : 'neutral'}
              hint="Shipped for less than they cost"
            />
          </div>

          {data.rows.length === 0 ? (
            <EmptyState
              title="Nothing could be priced"
              description="Every shipment in the window was skipped. The reasons are listed below."
            />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Shipment</Th>
                  <Th>Lane</Th>
                  <Th align="right">Billed</Th>
                  <Th align="right">Actual cost</Th>
                  <Th align="right">Margin</Th>
                  <Th align="right">Card drift</Th>
                </Tr>
              </THead>
              <TBody>
                {data.rows.map((r) => (
                  <Tr key={r.shipmentId} onActivate={() => router.push(`/orders/${r.orderId}`)}>
                    <Td>
                      {r.orderId === null ? (
                        <Ident value={r.shipmentNumber} />
                      ) : (
                        <Link href={`/orders/${r.orderId}`} className="text-accent hover:underline">
                          <Ident value={r.shipmentNumber} />
                        </Link>
                      )}
                      {r.lossMaking && <StatusBadge kind="failed" label="loss" />}
                    </Td>
                    <Td className="text-text-muted whitespace-nowrap text-xs">{r.lane}</Td>
                    <Td align="right">
                      <Money amount={r.billedToSellerInr} />
                    </Td>
                    <Td align="right">
                      <Money amount={r.actualCourierCostInr} />
                    </Td>
                    <Td align="right">
                      <Money
                        amount={r.marginInr}
                        direction={Number(r.marginInr) < 0 ? 'debit' : 'credit'}
                      />
                    </Td>
                    <Td align="right" className="text-text-muted text-xs">
                      {r.assumptionDriftInr === null ? (
                        <span className="text-text-faint">—</span>
                      ) : (
                        <Num value={r.assumptionDriftInr} />
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}

          {data.skipped.length > 0 && (
            <Section
              className="mt-5"
              title={`Skipped (${data.skipped.length})`}
              subtitle="Named rather than dropped — a total over an unstated sample reads as the whole business."
            >
              <Card>
                <CardBody>
                  <ul className="text-text-muted space-y-1 text-xs">
                    {data.skipped.slice(0, 20).map((s) => (
                      <li key={s.shipmentId}>
                        <Ident value={s.shipmentId.slice(0, 8)} /> — {s.reason}
                      </li>
                    ))}
                    {data.skipped.length > 20 && (
                      <li className="text-text-faint">…and {data.skipped.length - 20} more.</li>
                    )}
                  </ul>
                </CardBody>
              </Card>
            </Section>
          )}

          <p className="text-text-faint mt-4 text-xs leading-relaxed">
            Generated {new Date(data.generatedAt).toLocaleString()}. This report never changes a
            rate card, a charge or a wallet — repricing off a single lane&apos;s reading would be a
            bad decision.
          </p>
        </>
      )}
    </div>
  );
}
