'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Play } from 'lucide-react';
import { Ident, Money, Num } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Select } from '@skydrop/ui/app/select';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { useMarginReport, useStoredMarginReport } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { useRouter } from 'next/navigation';
import { MoCard, MoSection } from '../../treasury/_components/money-parts';
import './margin.css';
import { useT } from '@/i18n/client';

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
  const t = useT();
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
    <div className="mo-page">
      <PageHeader
        title={t('marginMarginIndex.laneMargin')}
        subtitle={t('marginMarginIndex.whatWeBilledAgainstWhat')}
        action={
          <div className="mg-actions">
            <Select
              label={t('marginMarginIndex.sampleSize')}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="mg-sample"
              aria-label={t('marginMarginIndex.sampleSize')}
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {t('marginMarginIndex.sample', { n })}
                </option>
              ))}
            </Select>
            <AsyncButton
              variant="primary"
              size="md"
              icon={<Play size={14} />}
              state={live.isFetching ? 'busy' : 'idle'}
              labels={{
                idle: t('marginMarginIndex.quoteAgainstTheRateCard'),
                busy: t('marginMarginIndex.quoting'),
              }}
              disabled={live.isFetching}
              onClick={() => {
                setRun(true);
                void live.refetch();
              }}
              title={t('marginMarginIndex.asksTheCourierSRate')}
            />
          </div>
        }
      />

      {report.isError ? (
        <ErrorState message={serverVerdict(report.error)} retry={() => void report.refetch()} />
      ) : report.isFetching || data === undefined ? (
        <MoCard flush>
          <SkeletonRows rows={6} cols={6} />
        </MoCard>
      ) : data.rows.length === 0 ? (
        <EmptyState
          title={t('marginMarginIndex.notInvoicedYet')}
          description={t('marginMarginIndex.nothingInThisWindowHas')}
        />
      ) : (
        <>
          {!run && (
            <MoCard>
              <p className="mo-p">
                {t('marginMarginIndex.whatTheCourierActuallyBilled')}
                {unpriced > 0 && (
                  <>
                    {' '}
                    {t('marginMarginIndex.parcelInThisWindowNo', {
                      unpriced,
                      value: unpriced === 1 ? '' : t('common.pluralS'),
                      value2:
                        unpriced === 1 ? t('marginMarginIndex.has') : t('marginMarginIndex.have'),
                      value3:
                        unpriced === 1 ? t('marginMarginIndex.is') : t('marginMarginIndex.are'),
                    })}
                  </>
                )}
              </p>
            </MoCard>
          )}
          <div className="mo-kpis">
            <KpiCard
              label={t('marginMarginIndex.billedToClients')}
              figure={<Money amount={data.totalBilledInr} decimals={false} />}
              hint={t('marginMarginIndex.acrossPricedShipment', {
                sampledShipments: data.sampledShipments,
                value: data.sampledShipments === 1 ? '' : t('common.pluralS'),
              })}
            />
            <KpiCard
              label={t('marginMarginIndex.courierChargedUs')}
              figure={<Money amount={data.totalActualCostInr} decimals={false} />}
              hint={t('marginMarginIndex.delhiverySOwnFigures')}
            />
            <KpiCard
              label={t('marginMarginIndex.margin')}
              figure={<Money amount={data.totalMarginInr} decimals={false} />}
              tone={Number(data.totalMarginInr) < 0 ? 'debit' : 'credit'}
              hint={t('marginMarginIndex.billedMinusActualPreTax')}
            />
            <KpiCard
              label={t('marginMarginIndex.lossMakingLanes')}
              value={data.lossMakingCount}
              tone={data.lossMakingCount > 0 ? 'debit' : 'neutral'}
              hint={t('marginMarginIndex.shippedForLessThanThey')}
            />
          </div>

          {data.rows.length === 0 ? (
            <EmptyState
              title={t('marginMarginIndex.nothingCouldBePriced')}
              description={t('marginMarginIndex.everyShipmentInTheWindow')}
            />
          ) : (
            <Table caption={t('marginMarginIndex.laneMarginByShipment')}>
              <THead>
                <Tr>
                  <Th>{t('marginMarginIndex.shipment')}</Th>
                  <Th>{t('marginMarginIndex.lane')}</Th>
                  <Th align="right">{t('marginMarginIndex.billed')}</Th>
                  <Th align="right">{t('marginMarginIndex.actualCost')}</Th>
                  <Th align="right">{t('marginMarginIndex.margin')}</Th>
                  <Th align="right">{t('marginMarginIndex.cardDrift')}</Th>
                </Tr>
              </THead>
              <TBody>
                {data.rows.map((r) => (
                  <Tr key={r.shipmentId} onActivate={() => router.push(`/orders/${r.orderId}`)}>
                    <Td>
                      <span className="mg-ship">
                        {r.orderId === null ? (
                          <Ident value={r.shipmentNumber} />
                        ) : (
                          <Link href={`/orders/${r.orderId}`} className="mo-link">
                            <Ident value={r.shipmentNumber} />
                          </Link>
                        )}
                        {r.lossMaking && <StatusChip kind="failed" label="loss" size="sm" />}
                      </span>
                    </Td>
                    <Td className="mo-muted mo-nowrap">{r.lane}</Td>
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
                    <Td align="right" className="mo-muted">
                      {r.assumptionDriftInr === null ? (
                        <span className="mo-faint">—</span>
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
            <MoSection
              title={t('marginMarginIndex.skipped', { skippedLength: data.skipped.length })}
              note={t('marginMarginIndex.namedRatherThanDroppedA')}
            >
              <ul className="mg-skipped">
                {data.skipped.slice(0, 20).map((s) => (
                  <li key={s.shipmentId}>
                    <Ident value={s.shipmentId.slice(0, 8)} /> — {s.reason}
                  </li>
                ))}
                {data.skipped.length > 20 && (
                  <li className="mo-faint">
                    {t('marginMarginIndex.andMore', { value: data.skipped.length - 20 })}
                  </li>
                )}
              </ul>
            </MoSection>
          )}

          <p className="mo-faint mg-foot">
            {t('marginMarginIndex.generatedThisReportNeverChanges', {
              value: new Date(data.generatedAt).toLocaleString(),
            })}
          </p>
        </>
      )}
    </div>
  );
}
