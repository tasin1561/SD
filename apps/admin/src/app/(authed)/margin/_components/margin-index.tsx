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
  SkeletonRows,
  Stat,
  StatusBadge,
  TBody,
  Table,
  Td,
  THead,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { useMarginReport } from '@/lib/ops-hooks';
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
 *  - It is MEASURED, not assumed. The comparison is against what
 *    Delhivery actually charges, not the rate card's typed-in cost —
 *    `assumptionDrift` shows how far apart those two are.
 */
export function MarginIndex(): ReactElement {
  const router = useRouter();
  const [limit, setLimit] = useState(25);
  const [run, setRun] = useState(false);
  const report = useMarginReport(limit, run);

  const data = report.data;

  return (
    <div>
      <PageHeader
        title="Lane margin"
        subtitle="What we billed against what the courier actually charged. Measured from Delhivery's own figures, not the rate card's assumption."
        action={
          <div className="flex items-center gap-2">
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="border-border bg-surface text-text-body rounded-[5px] border px-2 py-1 text-xs"
              aria-label="Sample size"
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  Sample {n}
                </option>
              ))}
            </select>
            <Button
              variant="primary"
              size="md"
              disabled={report.isFetching}
              onClick={() => {
                setRun(true);
                void report.refetch();
              }}
            >
              <Play size={13} aria-hidden />
              {report.isFetching ? 'Pricing…' : 'Run'}
            </Button>
          </div>
        }
      />

      {!run ? (
        <EmptyState
          title="Not run yet"
          description="Each shipment in the sample costs one live call to Delhivery against a rate-limited endpoint, so this runs only when you ask. Pick a sample size and press Run."
        />
      ) : report.isError ? (
        <ErrorNote message={serverVerdict(report.error)} retry={() => void report.refetch()} />
      ) : report.isFetching || data === undefined ? (
        <Card>
          <SkeletonRows rows={6} cols={6} />
        </Card>
      ) : (
        <>
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
