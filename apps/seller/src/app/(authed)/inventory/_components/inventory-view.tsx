'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, type ReactElement } from 'react';
import { Boxes, Plane, ScanLine, TriangleAlert, Wallet } from 'lucide-react';
import { useStockList, useStockSummary } from '@/lib/api-hooks';
import { Money } from '@skydrop/ui/components';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Pagination } from '@skydrop/ui/app/pagination';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { GlossaryTerm } from '@skydrop/ui/app/tooltip-card';
import {
  AreaPage,
  AreaSection,
  Dash,
  KpiGrid,
  LinkButton,
  MetaFact,
  MetaFacts,
  Panel,
  PanelPad,
  rawCount,
} from './stock-ui';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';

const PAGE_SIZE = 25;

/**
 * Cross-warehouse inventory roll-up for the seller. Read-only: the
 * "receive stock" action lives in the warehouse-ops admin UI (staff
 * scan the incoming parcel and log the receipt). The seller view
 * exposes:
 *   - On-hand / reserved / available qty per variant
 *   - The seller's effective low-stock threshold (variant override →
 *     seller default → null)
 *   - Warehouse footprint count (Phase 1A always 1 — CCU-01)
 *
 * Out of scope (Phase 1A): per-warehouse breakdown rows, batch / bin
 * detail, stock-movements history.
 *
 * ── THE TWO WORDS THIS PAGE REFUSES TO CONFLATE ─────────────────────
 * "India stock", not "on hand". A seller's goods live in two countries
 * at once — some in Dhaka or in the air, some on the shelf in Bangalore
 * — and "on hand" does not say which. IN TRANSIT is therefore its own
 * tile and its own column, never summed into the figure beside it:
 * folded in, 301 units sitting in Dhaka read as 301 available to sell,
 * and an order taken against them fails at confirmation, which is the
 * expensive place to find out.
 *
 * Value is at COST and carries its own gap. A batch with no recorded
 * unit cost contributes NOTHING and is COUNTED SEPARATELY rather than
 * silently treated as free (TRE-6's "uncovered, never defaulted") —
 * otherwise cheap stock and unpriced stock look identical and the total
 * looks complete.
 */
export function InventoryView(): ReactElement {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pageParam = Number(searchParams?.get('page') ?? '1');
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  const list = useStockList({ page, pageSize: PAGE_SIZE });
  const summary = useStockSummary();
  const s = summary.data;

  const updateUrl = useCallback(
    (nextPage: number) => {
      const sp = new URLSearchParams(searchParams?.toString() ?? '');
      if (nextPage === 1) sp.delete('page');
      else sp.set('page', String(nextPage));
      const qs = sp.toString();
      router.push(`/inventory${qs ? `?${qs}` : ''}`);
    },
    [router, searchParams],
  );

  return (
    <AreaPage>
      <PageHeader
        breadcrumbs={[
          { label: t('inventory.clientConsole') },
          { label: t('inventory.stock') },
          { label: t('inventory.inventory') },
        ]}
        Link={Link}
        title={t('inventory.inventory')}
        subtitle={t('inventory.stockAvailableForOrders')}
        meta={
          s === undefined ? undefined : (
            <MetaFacts>
              <MetaFact tone="accent">
                {richMessage(t('inventory.skus'), { totalSkus: s.totalSkus })}
              </MetaFact>
              {s.lowStockSkus > 0 && (
                <MetaFact tone="warn">
                  {richMessage(t('inventory.lowOnStock'), { lowStockSkus: s.lowStockSkus })}
                </MetaFact>
              )}
              {s.totalQtyInTransit > 0 && (
                <MetaFact dot>
                  {richMessage(t('inventory.unitsInTransit'), {
                    totalQtyInTransit: s.totalQtyInTransit,
                  })}
                </MetaFact>
              )}
            </MetaFacts>
          )
        }
        action={
          <LinkButton href="/inventory/units" variant="ghost" icon={<ScanLine size={15} />}>
            {t('inventory.unitDiscrepancies')}
          </LinkButton>
        }
      />

      {/* A value is ABSENT rather than 0 while loading: a tile reading
          "0 in stock" that then becomes 14,820 has told you something
          false in the meantime, and this is the screen a seller checks
          before deciding whether to ship more. The figures roll once,
          to the same string the old tiles printed. */}
      {s === undefined ? (
        <KpiGrid>
          <KpiCard label={t('inventory.indiaStock')} icon={<Boxes size={14} />} figure={<Dash />} />
          <KpiCard label={t('inventory.inTransit')} icon={<Plane size={14} />} figure={<Dash />} />
          <KpiCard
            label={t('inventory.lowOnStock2')}
            icon={<TriangleAlert size={14} />}
            figure={<Dash />}
          />
          <KpiCard
            label={t('inventory.stockValueAtCost')}
            icon={<Wallet size={14} />}
            figure={<Dash />}
          />
        </KpiGrid>
      ) : (
        <KpiGrid>
          <KpiCard
            label={t('inventory.indiaStock')}
            icon={<Boxes size={14} />}
            value={s.totalQtyOnHand}
            format={rawCount}
            unit="units"
            tone="neutral"
            foot={[
              { label: t('inventory.sellableNow'), value: s.totalQtyAvailable },
              { label: t('inventory.heldForOrders'), value: s.totalQtyReserved },
            ]}
          />
          <KpiCard
            label={
              <GlossaryTerm
                title={t('inventory.inTransit')}
                icon={<Plane size={16} />}
                description={t('inventory.goodsThatHaveLeft')}
              >
                {t('inventory.inTransit')}
              </GlossaryTerm>
            }
            icon={<Plane size={14} />}
            value={s.totalQtyInTransit}
            format={rawCount}
            unit="units"
            tone="info"
            /*
              A HINT IS A CLAIM, so it waits for the figure it explains.

              Written as a plain ternary this said "Nothing is on its way
              in." for the second or two before the summary landed — with
              "—" sitting above it. That is the same falsehood the absent
              VALUE is carefully avoiding, only in words, and a seller
              deciding whether to ship more reads the sentence.
            */
            hint={
              s.totalQtyInTransit > 0 ? t('inventory.inDhakaOrIn') : t('inventory.nothingIsOnIts')
            }
          />
          <KpiCard
            label={t('inventory.lowOnStock2')}
            icon={<TriangleAlert size={14} />}
            value={s.lowStockSkus}
            format={rawCount}
            unit={t('inventory.skus2')}
            tone={s.lowStockSkus > 0 ? 'pending' : 'neutral'}
            hint={s.lowStockSkus > 0 ? t('inventory.atOrUnderThe') : t('inventory.everySkuIsAbove')}
          />
          <KpiCard
            label={t('inventory.stockValueAtCost')}
            icon={<Wallet size={14} />}
            figure={
              <Money
                amount={(Number(s.valueAtWarehouseInr) + Number(s.valueInTransitInr)).toFixed(2)}
              />
            }
            tone="neutral"
            foot={[
              {
                label: t('inventory.onTheShelfIn'),
                value: <Money amount={s.valueAtWarehouseInr} />,
              },
              { label: t('inventory.inTransit'), value: <Money amount={s.valueInTransitInr} /> },
              ...(s.valueUnknownUnits > 0
                ? [{ label: t('inventory.unitsWithNoCost'), value: s.valueUnknownUnits }]
                : []),
            ]}
          />
        </KpiGrid>
      )}

      <AreaSection
        title={t('inventory.stockRegister')}
        note={
          list.data === undefined
            ? undefined
            : `${list.data.total} ${list.data.total === 1 ? 'SKU' : 'SKUs'}`
        }
      >
        <Panel flush>
          {list.isLoading ? (
            <PanelPad>
              <SkeletonRows rows={6} cols={7} label={t('inventory.loadingInventory')} />
            </PanelPad>
          ) : list.isError ? (
            <PanelPad>
              <ErrorState
                message={list.error?.message ?? t('inventory.failedToLoadInventory')}
                retry={() => void list.refetch()}
              />
            </PanelPad>
          ) : !list.data || list.data.items.length === 0 ? (
            <PanelPad>
              <EmptyState
                title={t('inventory.noStockYet')}
                description={t('inventory.onceYourShipmentIs')}
                bare
                action={
                  <LinkButton href="/inbound" variant="secondary">
                    {t('inventory.inbound')}
                  </LinkButton>
                }
              />
            </PanelPad>
          ) : (
            <>
              <Table caption={t('inventory.stockRegister')}>
                <THead>
                  <Tr>
                    <Th>{t('inventory.sku')}</Th>
                    <Th>{t('inventory.variant')}</Th>
                    <Th align="right">{t('inventory.indiaStock')}</Th>
                    <Th align="right">{t('inventory.reserved')}</Th>
                    <Th align="right">{t('inventory.available')}</Th>
                    <Th align="right">{t('inventory.inTransit')}</Th>
                    <Th align="right">{t('inventory.lowStock')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {list.data.items.map((row) => (
                    <Tr
                      key={row.variantId}
                      onActivate={() =>
                        router.push(`/products/${row.productId}/variants/${row.variantId}`)
                      }
                    >
                      <Td>
                        <Link
                          href={`/products/${row.productId}/variants/${row.variantId}`}
                          className="inv-strong-link sk-ident"
                        >
                          {row.skuCode}
                        </Link>
                      </Td>
                      <Td>
                        <span className="inv-muted">{row.variantLabel ?? <Dash />}</span>
                      </Td>
                      <Td align="right">
                        <span className="sk-figure inv-num">
                          {row.qtyOnHand.toLocaleString('en-IN')}
                        </span>
                      </Td>
                      <Td align="right">
                        <span className="sk-figure inv-muted">
                          {row.qtyReserved.toLocaleString('en-IN')}
                        </span>
                      </Td>
                      <Td align="right">
                        <span
                          className="sk-figure inv-num"
                          data-tone={row.isLowStock ? 'bad' : undefined}
                          style={row.isLowStock ? { fontWeight: 'var(--fw-semibold)' } : undefined}
                        >
                          {row.qtyAvailable.toLocaleString('en-IN')}
                        </span>
                      </Td>
                      <Td align="right">
                        {row.qtyInTransit > 0 ? (
                          <span className="sk-figure inv-muted">
                            {row.qtyInTransit.toLocaleString('en-IN')}
                          </span>
                        ) : (
                          <Dash />
                        )}
                      </Td>
                      <Td align="right">
                        <span className="inv-cell-row">
                          {row.lowStockThreshold !== null ? (
                            <span className="sk-figure inv-muted">
                              {row.lowStockThreshold.toLocaleString('en-IN')}
                            </span>
                          ) : (
                            <Dash />
                          )}
                          {/* The warning chip rings ONCE when it appears —
                              a word and an icon, never colour alone. */}
                          {row.isLowStock && (
                            <StatusChip
                              kind="pending"
                              label={t('inventory.lowOnStock2')}
                              size="sm"
                              pulse
                            />
                          )}
                        </span>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              <PanelPad>
                <Pagination
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={list.data.total}
                  onPageChange={updateUrl}
                  label={t('inventory.stockRegisterPages')}
                />
              </PanelPad>
            </>
          )}
        </Panel>
      </AreaSection>
    </AreaPage>
  );
}
