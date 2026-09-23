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
        breadcrumbs={[{ label: 'Seller console' }, { label: 'Stock' }, { label: 'Inventory' }]}
        Link={Link}
        title="Inventory"
        subtitle="Stock available for orders. Receiving happens at the warehouse — speak to ops to add inventory."
        meta={
          s === undefined ? undefined : (
            <MetaFacts>
              <MetaFact tone="accent">{s.totalSkus} SKUs</MetaFact>
              {s.lowStockSkus > 0 && <MetaFact tone="warn">{s.lowStockSkus} low on stock</MetaFact>}
              {s.totalQtyInTransit > 0 && (
                <MetaFact dot>{s.totalQtyInTransit} units in transit</MetaFact>
              )}
            </MetaFacts>
          )
        }
        action={
          <LinkButton href="/inventory/units" variant="ghost" icon={<ScanLine size={15} />}>
            Unit discrepancies →
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
          <KpiCard label="India stock" icon={<Boxes size={14} />} figure={<Dash />} />
          <KpiCard label="In transit" icon={<Plane size={14} />} figure={<Dash />} />
          <KpiCard label="Low on stock" icon={<TriangleAlert size={14} />} figure={<Dash />} />
          <KpiCard label="Stock value at cost" icon={<Wallet size={14} />} figure={<Dash />} />
        </KpiGrid>
      ) : (
        <KpiGrid>
          <KpiCard
            label="India stock"
            icon={<Boxes size={14} />}
            value={s.totalQtyOnHand}
            format={rawCount}
            unit="units"
            tone="neutral"
            foot={[
              { label: 'Sellable now', value: s.totalQtyAvailable },
              { label: 'Held for orders', value: s.totalQtyReserved },
            ]}
          />
          <KpiCard
            label={
              <GlossaryTerm
                title="In transit"
                icon={<Plane size={16} />}
                description="Goods that have left you but are not on our Indian shelf yet — in Dhaka or in the air. They are counted, and they cannot be sold until they arrive."
              >
                In transit
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
              s.totalQtyInTransit > 0
                ? 'In Dhaka or in the air — not sellable yet.'
                : 'Nothing is on its way in.'
            }
          />
          <KpiCard
            label="Low on stock"
            icon={<TriangleAlert size={14} />}
            value={s.lowStockSkus}
            format={rawCount}
            unit="SKUs"
            tone={s.lowStockSkus > 0 ? 'pending' : 'neutral'}
            hint={
              s.lowStockSkus > 0
                ? 'At or under the threshold you set.'
                : 'Every SKU is above its threshold.'
            }
          />
          <KpiCard
            label="Stock value at cost"
            icon={<Wallet size={14} />}
            figure={
              <Money
                amount={(Number(s.valueAtWarehouseInr) + Number(s.valueInTransitInr)).toFixed(2)}
              />
            }
            tone="neutral"
            foot={[
              {
                label: 'On the shelf in India',
                value: <Money amount={s.valueAtWarehouseInr} />,
              },
              { label: 'In transit', value: <Money amount={s.valueInTransitInr} /> },
              ...(s.valueUnknownUnits > 0
                ? [{ label: 'Units with no cost — excluded', value: s.valueUnknownUnits }]
                : []),
            ]}
          />
        </KpiGrid>
      )}

      <AreaSection
        title="Stock register"
        note={
          list.data === undefined
            ? undefined
            : `${list.data.total} ${list.data.total === 1 ? 'SKU' : 'SKUs'}`
        }
      >
        <Panel flush>
          {list.isLoading ? (
            <PanelPad>
              <SkeletonRows rows={6} cols={7} label="Loading inventory…" />
            </PanelPad>
          ) : list.isError ? (
            <PanelPad>
              <ErrorState
                message={list.error?.message ?? 'Failed to load inventory.'}
                retry={() => void list.refetch()}
              />
            </PanelPad>
          ) : !list.data || list.data.items.length === 0 ? (
            <PanelPad>
              <EmptyState
                title="No stock yet"
                description="Once your shipment is received at our Indian warehouse, your variants will show up here with on-hand qty."
                bare
                action={
                  <LinkButton href="/inbound" variant="secondary">
                    Inbound
                  </LinkButton>
                }
              />
            </PanelPad>
          ) : (
            <>
              <Table caption="Stock register">
                <THead>
                  <Tr>
                    <Th>SKU</Th>
                    <Th>Variant</Th>
                    <Th align="right">India stock</Th>
                    <Th align="right">Reserved</Th>
                    <Th align="right">Available</Th>
                    <Th align="right">In transit</Th>
                    <Th align="right">Low-stock</Th>
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
                            <StatusChip kind="pending" label="Low on stock" size="sm" pulse />
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
                  label="Stock register pages"
                />
              </PanelPad>
            </>
          )}
        </Panel>
      </AreaSection>
    </AreaPage>
  );
}
