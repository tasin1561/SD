'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, type ReactElement } from 'react';
import { Boxes, Plane, TriangleAlert, Wallet } from 'lucide-react';
import { useStockList, useStockSummary } from '@/lib/api-hooks';
import {
  BandBody,
  Crumbs,
  EmptyState,
  ErrorState,
  LoadingState,
  MetaChip,
  Money,
  PageHeader,
  SectionBand,
  Stat,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  TablePaginator,
} from '@skydrop/ui/components';

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
    <div>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[{ label: 'Seller console' }, { label: 'Stock' }, { label: 'Inventory' }]}
            Link={Link}
          />
        }
        title="Inventory"
        subtitle="Stock available for orders. Receiving happens at the warehouse — speak to ops to add inventory."
        meta={
          s === undefined ? undefined : (
            <>
              <MetaChip tone="accent">{s.totalSkus} SKUs</MetaChip>
              {s.lowStockSkus > 0 && <MetaChip tone="warn">{s.lowStockSkus} low on stock</MetaChip>}
              {s.totalQtyInTransit > 0 && (
                <MetaChip dot>{s.totalQtyInTransit} units in transit</MetaChip>
              )}
            </>
          )
        }
        action={
          <Link href="/inventory/units" className="text-accent text-sm hover:underline">
            Unit discrepancies →
          </Link>
        }
      />

      {/* A value is ABSENT rather than 0 while loading: a tile reading
          "0 in stock" that then becomes 14,820 has told you something
          false in the meantime, and this is the screen a seller checks
          before deciding whether to ship more. */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="India stock"
          icon={<Boxes size={13} aria-hidden />}
          value={s?.totalQtyOnHand ?? <span className="text-text-faint">—</span>}
          unit={s === undefined ? undefined : 'units'}
          tone="neutral"
          {...(s === undefined
            ? {}
            : {
                foot: [
                  { label: 'Sellable now', value: s.totalQtyAvailable },
                  { label: 'Held for orders', value: s.totalQtyReserved },
                ],
              })}
        />
        <Stat
          label="In transit"
          icon={<Plane size={13} aria-hidden />}
          value={s?.totalQtyInTransit ?? <span className="text-text-faint">—</span>}
          unit={s === undefined ? undefined : 'units'}
          tone="neutral"
          /*
            A HINT IS A CLAIM, so it waits for the figure it explains.

            Written as a plain ternary this said "Nothing is on its way
            in." for the second or two before the summary landed — with
            "—" sitting above it. That is the same falsehood the absent
            VALUE is carefully avoiding, only in words, and a seller
            deciding whether to ship more reads the sentence.
          */
          {...(s === undefined
            ? {}
            : {
                hint:
                  s.totalQtyInTransit > 0
                    ? 'In Dhaka or in the air — not sellable yet.'
                    : 'Nothing is on its way in.',
              })}
        />
        <Stat
          label="Low on stock"
          icon={<TriangleAlert size={13} aria-hidden />}
          value={s?.lowStockSkus ?? <span className="text-text-faint">—</span>}
          unit={s === undefined ? undefined : 'SKUs'}
          tone={s !== undefined && s.lowStockSkus > 0 ? 'warn' : 'neutral'}
          {...(s === undefined
            ? {}
            : {
                hint:
                  s.lowStockSkus > 0
                    ? 'At or under the threshold you set.'
                    : 'Every SKU is above its threshold.',
              })}
        />
        <Stat
          label="Stock value at cost"
          icon={<Wallet size={13} aria-hidden />}
          value={
            s === undefined ? (
              <span className="text-text-faint">—</span>
            ) : (
              <Money
                amount={(Number(s.valueAtWarehouseInr) + Number(s.valueInTransitInr)).toFixed(2)}
              />
            )
          }
          tone="neutral"
          {...(s === undefined
            ? {}
            : {
                foot: [
                  {
                    label: 'On the shelf in India',
                    value: <Money amount={s.valueAtWarehouseInr} />,
                  },
                  { label: 'In transit', value: <Money amount={s.valueInTransitInr} /> },
                  ...(s.valueUnknownUnits > 0
                    ? [{ label: 'Units with no cost — excluded', value: s.valueUnknownUnits }]
                    : []),
                ],
              })}
        />
      </div>

      <SectionBand
        index="01"
        title="Stock register"
        note={
          list.data === undefined
            ? undefined
            : `${list.data.total} ${list.data.total === 1 ? 'SKU' : 'SKUs'}`
        }
      />

      <BandBody flush>
        {list.isLoading ? (
          <div className="p-3">
            <LoadingState label="Loading inventory…" />
          </div>
        ) : list.isError ? (
          <div className="p-3">
            <ErrorState
              message={list.error?.message ?? 'Failed to load inventory.'}
              retry={() => void list.refetch()}
            />
          </div>
        ) : !list.data || list.data.items.length === 0 ? (
          <div className="p-3">
            <EmptyState
              title="No stock yet"
              description="Once your shipment is received at our Indian warehouse, your variants will show up here with on-hand qty."
              bare
            />
          </div>
        ) : (
          <Table>
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
                      className="text-text-bright font-mono text-xs hover:underline"
                    >
                      {row.skuCode}
                    </Link>
                  </Td>
                  <Td className="text-text-muted text-xs">
                    {row.variantLabel ?? <span className="text-text-faint">—</span>}
                  </Td>
                  <Td align="right" className="font-mono">
                    {row.qtyOnHand.toLocaleString('en-IN')}
                  </Td>
                  <Td align="right" className="text-text-muted font-mono">
                    {row.qtyReserved.toLocaleString('en-IN')}
                  </Td>
                  <Td align="right" className="font-mono">
                    <span
                      className={row.isLowStock ? 'text-critical font-medium' : 'text-text-bright'}
                    >
                      {row.qtyAvailable.toLocaleString('en-IN')}
                    </span>
                  </Td>
                  <Td align="right" className="text-text-muted font-mono">
                    {row.qtyInTransit > 0 ? (
                      row.qtyInTransit.toLocaleString('en-IN')
                    ) : (
                      <span className="text-text-faint">—</span>
                    )}
                  </Td>
                  <Td align="right" className="text-text-muted font-mono text-xs">
                    {row.lowStockThreshold !== null ? (
                      row.lowStockThreshold.toLocaleString('en-IN')
                    ) : (
                      <span className="text-text-faint">—</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
            <tfoot>
              <tr>
                <td colSpan={7} className="p-0">
                  <TablePaginator
                    page={page}
                    pageSize={PAGE_SIZE}
                    total={list.data.total}
                    onPageChange={updateUrl}
                  />
                </td>
              </tr>
            </tfoot>
          </Table>
        )}
      </BandBody>
    </div>
  );
}
