'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { ProductStatus } from '@skydrop/db';
import { useSellerIdentity } from '@skydrop/auth/client';
import { useProductsList, useStockSummary } from '@/lib/api-hooks';
import { can, canSeePath } from '@/lib/page-access';
import { Boxes, Layers, Plus, RotateCcw, TriangleAlert, Upload, Wallet } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { Table, TBody, Td, Th, THead, Tr, TableToolbar } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Pagination } from '@skydrop/ui/app/pagination';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Tabs } from '@skydrop/ui/app/tabs';
import {
  Actions,
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
} from '@/app/(authed)/inventory/_components/stock-ui';

/**
 * Seller catalogue list — the LIST pattern for the console redesign.
 *
 * Product-grain at the top level (the backend serves /seller/products
 * paginated; variants live per-product at /seller/products/:id/variants).
 * Click into a product to see its variants + edit it.
 *
 * URL-driven filters (status + search + page) so deep-linked filters
 * are shareable + browser back/forward navigates.
 *
 * ── WHAT THE COMP SHOWED THAT IS NOT HERE ───────────────────────────
 * `Products_{Light,Dark}` is a drawing, and a drawing can show a column
 * we do not have. Dropped rather than faked, because a catalogue screen
 * is read as a statement of fact about goods that cross a border:
 *
 *   HSN & CUSTOMS CODE   `hsCode` was REMOVED from the schema on
 *                        2026-08-18 — variant, product default and both
 *                        snapshots. There is nothing to render, and an
 *                        invented tariff code on a customs-facing screen
 *                        is the worst possible thing to guess.
 *   STOCK BY NODE        the comp splits every row across two named
 *                        warehouses with a fill bar. The products list
 *                        carries no per-row stock at all; the SUMMARY
 *                        does, which is why the tiles above are real and
 *                        the column is absent.
 *   LANDED PRICING       a cost, a margin % and a BDT landed value per
 *                        row. We hold a DECLARED value (what the parcel
 *                        is worth for customs) and no per-product cost,
 *                        so there is no margin to compute.
 *   SKU CODE per row     a SKU belongs to a VARIANT; a product has none.
 *                        `externalRef` — the seller's own reference — is
 *                        the honest column at this grain.
 *
 * The status chips carry no COUNT for the same reason: the list endpoint
 * answers one status at a time, so a number beside each would be three
 * more round-trips per page view for decoration.
 */

const PAGE_SIZE = 20;
const STATUSES = Object.values(ProductStatus);

interface QueryParams {
  readonly status: ProductStatus | '';
  readonly search: string;
  readonly page: number;
}

function parseParams(sp: URLSearchParams): QueryParams {
  const status = sp.get('status') as ProductStatus | null;
  return {
    status: status && (STATUSES as string[]).includes(status) ? status : '',
    search: sp.get('search') ?? '',
    page: Math.max(1, Number(sp.get('page')) || 1),
  };
}

function productStatusKind(status: ProductStatus): 'confirmed' | 'cancelled' | 'pending' {
  switch (status) {
    case ProductStatus.ACTIVE:
      return 'confirmed';
    case ProductStatus.ARCHIVED:
      return 'cancelled';
    case ProductStatus.DRAFT:
    default:
      return 'pending';
  }
}

/** `L × W × H cm`, or nothing. A partial box is not a measurement. */
function dimensions(p: {
  readonly defaultLengthCm: string | null;
  readonly defaultWidthCm: string | null;
  readonly defaultHeightCm: string | null;
}): string | null {
  const { defaultLengthCm: l, defaultWidthCm: w, defaultHeightCm: h } = p;
  if (l === null || w === null || h === null) return null;
  return `${l} × ${w} × ${h} cm`;
}

export function ProductsIndex(): ReactElement {
  const identity = useSellerIdentity();
  const router = useRouter();
  const sp = useSearchParams();
  const params = useMemo(() => parseParams(new URLSearchParams(sp.toString())), [sp]);

  const [searchInput, setSearchInput] = useState(params.search);

  const updateUrl = useCallback(
    (next: Partial<QueryParams>) => {
      const merged: QueryParams = { ...params, ...next };
      const nextSp = new URLSearchParams();
      if (merged.status) nextSp.set('status', merged.status);
      if (merged.search) nextSp.set('search', merged.search);
      if (merged.page !== 1) nextSp.set('page', String(merged.page));
      const qs = nextSp.toString();
      router.replace(qs ? `/products?${qs}` : '/products');
    },
    [params, router],
  );

  const list = useProductsList({
    ...(params.status ? { status: params.status } : {}),
    ...(params.search ? { search: params.search } : {}),
    page: params.page,
    pageSize: PAGE_SIZE,
  });

  // The catalogue's STOCK, which the product rows do not carry. SKU-grain
  // (a variant is a SKU), so every tile says "SKUs" rather than
  // "products" — the two numbers differ and conflating them would make
  // the tiles disagree with the table on purpose.
  //
  // GATED, and the gate is passed to `enabled` rather than only hiding
  // the tiles: this page is reachable on `catalog.view`, but the summary
  // needs `inventory.view`. Rendering nothing while still FIRING the
  // request means somebody who may only see the catalogue collects a 403
  // on load for doing nothing at all.
  const canSeeStock = identity !== null && can(identity, 'inventory.view');
  const stock = useStockSummary({ enabled: canSeeStock });

  const filtered = params.status !== '' || params.search !== '';

  const resetFilters = (): void => {
    setSearchInput('');
    updateUrl({ status: '', search: '', page: 1 });
  };

  return (
    <AreaPage>
      <PageHeader
        breadcrumbs={[{ label: 'Seller console' }, { label: 'Stock & WMS' }, { label: 'Products' }]}
        Link={Link}
        title="Products"
        subtitle="Your catalogue: products, their variants and the pictures customers see."
        meta={
          stock.data === undefined ? undefined : (
            <MetaFacts>
              <MetaFact tone="accent">{stock.data.totalSkus} SKUs</MetaFact>
              {stock.data.lowStockSkus > 0 && (
                <MetaFact tone="warn">{stock.data.lowStockSkus} low on stock</MetaFact>
              )}
              {stock.data.totalQtyInTransit > 0 && (
                <MetaFact dot>{stock.data.totalQtyInTransit} units in transit</MetaFact>
              )}
            </MetaFacts>
          )
        }
        action={
          <Actions>
            {canSeePath(identity, '/products/import') && (
              <LinkButton href="/products/import" variant="ghost" icon={<Upload size={15} />}>
                CSV import
              </LinkButton>
            )}
            {canSeePath(identity, '/products/new') && (
              <LinkButton href="/products/new" variant="primary" icon={<Plus size={15} />}>
                New product
              </LinkButton>
            )}
          </Actions>
        }
      />

      {/* ── What the catalogue is holding ───────────────────────────
             Four tiles from `/seller/stock/summary`, which is the ONE
             place these numbers are real. A value is ABSENT rather
             than 0 while loading: a tile reading "0 in stock" that
             then becomes 14,820 has told you something false in the
             meantime, and this is the screen a seller checks before
             deciding whether to ship more. The figure rolls once, to
             the same string the old tile printed. */}
      {canSeeStock && (
        <KpiGrid>
          {stock.data === undefined ? (
            <>
              <KpiCard label="Active SKUs" icon={<Layers size={14} />} figure={<Dash />} />
              <KpiCard label="Units in stock" icon={<Boxes size={14} />} figure={<Dash />} />
              <KpiCard label="Low on stock" icon={<TriangleAlert size={14} />} figure={<Dash />} />
              <KpiCard label="Stock value at cost" icon={<Wallet size={14} />} figure={<Dash />} />
            </>
          ) : (
            <>
              <KpiCard
                label="Active SKUs"
                icon={<Layers size={14} />}
                value={stock.data.totalSkus}
                format={rawCount}
                unit="SKUs"
                tone="neutral"
              />
              <KpiCard
                label="Units in stock"
                icon={<Boxes size={14} />}
                value={stock.data.totalQtyOnHand}
                format={rawCount}
                unit="units"
                tone="neutral"
                foot={[
                  { label: 'Sellable now', value: stock.data.totalQtyAvailable },
                  { label: 'Held for orders', value: stock.data.totalQtyReserved },
                ]}
              />
              <KpiCard
                label="Low on stock"
                icon={<TriangleAlert size={14} />}
                value={stock.data.lowStockSkus}
                format={rawCount}
                unit="SKUs"
                tone={stock.data.lowStockSkus > 0 ? 'pending' : 'neutral'}
                hint={
                  stock.data.lowStockSkus > 0 ? 'At or under the threshold you set.' : undefined
                }
              />
              <KpiCard
                label="Stock value at cost"
                icon={<Wallet size={14} />}
                figure={<Money amount={stock.data.valueAtWarehouseInr} />}
                tone="neutral"
                foot={[
                  {
                    label: 'In transit',
                    value: <Money amount={stock.data.valueInTransitInr} />,
                  },
                  // NOT folded into the total as zero. A batch with no
                  // recorded cost is worth something unknown, and the
                  // summary counts those units separately for exactly
                  // this reason (TRE-6's "uncovered, never defaulted").
                  ...(stock.data.valueUnknownUnits > 0
                    ? [{ label: 'Units with no cost', value: stock.data.valueUnknownUnits }]
                    : []),
                ]}
              />
            </>
          )}
        </KpiGrid>
      )}

      <AreaSection
        title="Catalogue register"
        note={
          list.data === undefined
            ? undefined
            : `${list.data.total} ${list.data.total === 1 ? 'product' : 'products'}${
                filtered ? ' matching' : ''
              }`
        }
      >
        <Panel flush>
          {/* The search submits on Enter, exactly as before; the status
              filter is the liquid-bead tab row: three values, all worth
              seeing at once, directly above the register it filters. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateUrl({ search: searchInput.trim(), page: 1 });
            }}
          >
            <TableToolbar
              search={{
                value: searchInput,
                onChange: setSearchInput,
                label: 'Search products by name or reference',
                placeholder: 'Name or ref…',
              }}
              filters={
                <Tabs
                  label="Product status"
                  size="sm"
                  value={params.status === '' ? 'ALL' : params.status}
                  onChange={(id) =>
                    updateUrl({ status: id === 'ALL' ? '' : (id as ProductStatus), page: 1 })
                  }
                  items={[
                    { id: 'ALL', label: 'All products' },
                    ...STATUSES.map((s) => ({
                      id: s,
                      label: s.charAt(0) + s.slice(1).toLowerCase(),
                    })),
                  ]}
                />
              }
              action={
                filtered ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon={<RotateCcw size={14} />}
                    onClick={resetFilters}
                  >
                    Reset
                  </Button>
                ) : undefined
              }
            />
          </form>

          {list.isLoading ? (
            <PanelPad>
              <SkeletonRows rows={6} cols={6} label="Loading catalogue…" />
            </PanelPad>
          ) : list.isError ? (
            <PanelPad>
              <ErrorState
                message={list.error?.message ?? 'Failed to load catalog.'}
                retry={() => void list.refetch()}
              />
            </PanelPad>
          ) : !list.data || list.data.items.length === 0 ? (
            <PanelPad>
              <EmptyState
                bare
                title={filtered ? 'Nothing matches that' : 'No products yet'}
                description={
                  filtered
                    ? 'Try a different name or reference, or reset the filters.'
                    : 'Add one by hand, or bring a whole catalogue in with the CSV import.'
                }
                action={
                  filtered ? (
                    <Button variant="secondary" size="md" onClick={resetFilters}>
                      Reset filters
                    </Button>
                  ) : canSeePath(identity, '/products/new') ? (
                    <LinkButton href="/products/new" variant="primary" icon={<Plus size={15} />}>
                      New product
                    </LinkButton>
                  ) : undefined
                }
              />
            </PanelPad>
          ) : (
            <>
              <Table caption="Catalogue register">
                <THead>
                  <Tr>
                    <Th aria-label="Picture" />
                    <Th>Product</Th>
                    <Th>Your ref</Th>
                    <Th>Box &amp; weight</Th>
                    <Th align="right">Declared value</Th>
                    <Th>Status</Th>
                    <Th>Updated</Th>
                  </Tr>
                </THead>
                <TBody>
                  {list.data.items.map((p) => {
                    const box = dimensions(p);
                    return (
                      <Tr key={p.id} onActivate={() => router.push(`/products/${p.id}`)}>
                        <Td>
                          {/* A catalogue is browsed by eye; a column of
                              names makes the seller read to find the thing
                              they can already see. */}
                          {p.primaryImageUrl != null ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.primaryImageUrl} alt="" className="prd-thumb" />
                          ) : (
                            <div className="prd-thumb" aria-hidden />
                          )}
                        </Td>
                        <Td>
                          <Link href={`/products/${p.id}`} className="inv-strong-link">
                            {p.name}
                          </Link>
                          {p.description !== null && p.description !== '' && (
                            <span className="inv-sub inv-truncate">{p.description}</span>
                          )}
                        </Td>
                        <Td>
                          <span className="sk-ident inv-muted">{p.externalRef ?? '—'}</span>
                        </Td>
                        <Td>
                          {box === null && p.defaultWeightGrams === null ? (
                            <Dash />
                          ) : (
                            <>
                              <span className="sk-figure inv-muted">{box ?? 'No box size'}</span>
                              <span className="inv-sub sk-figure">
                                {p.defaultWeightGrams === null
                                  ? 'No weight'
                                  : `${p.defaultWeightGrams} g`}
                              </span>
                            </>
                          )}
                        </Td>
                        <Td align="right">
                          {p.defaultDeclaredValueInr === null ? (
                            <Dash />
                          ) : (
                            <Money amount={p.defaultDeclaredValueInr} />
                          )}
                        </Td>
                        <Td>
                          <StatusChip
                            kind={productStatusKind(p.status)}
                            label={p.status.toLowerCase()}
                            size="sm"
                          />
                        </Td>
                        <Td>
                          <span className="sk-figure inv-muted">
                            {new Date(p.updatedAt).toISOString().slice(0, 16).replace('T', ' ')}
                          </span>
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
              <PanelPad>
                <Pagination
                  page={params.page}
                  pageSize={PAGE_SIZE}
                  total={list.data.total}
                  onPageChange={(next) => updateUrl({ page: next })}
                  label="Catalogue pages"
                />
              </PanelPad>
            </>
          )}
        </Panel>
      </AreaSection>
    </AreaPage>
  );
}
