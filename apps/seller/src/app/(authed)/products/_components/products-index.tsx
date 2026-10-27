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
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';

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
  const t = useT();
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
        breadcrumbs={[
          { label: t('productList.clientConsole') },
          { label: t('productList.stockWms') },
          { label: t('productList.products') },
        ]}
        Link={Link}
        title={t('productList.products')}
        subtitle={t('productList.yourCatalogueProductsTheir')}
        meta={
          stock.data === undefined ? undefined : (
            <MetaFacts>
              <MetaFact tone="accent">
                {richMessage(t('productList.skus'), { totalSkus: stock.data.totalSkus })}
              </MetaFact>
              {stock.data.lowStockSkus > 0 && (
                <MetaFact tone="warn">
                  {richMessage(t('productList.lowOnStock'), {
                    lowStockSkus: stock.data.lowStockSkus,
                  })}
                </MetaFact>
              )}
              {stock.data.totalQtyInTransit > 0 && (
                <MetaFact dot>
                  {richMessage(t('productList.unitsInTransit'), {
                    totalQtyInTransit: stock.data.totalQtyInTransit,
                  })}
                </MetaFact>
              )}
            </MetaFacts>
          )
        }
        action={
          <Actions>
            {canSeePath(identity, '/products/import') && (
              <LinkButton href="/products/import" variant="ghost" icon={<Upload size={15} />}>
                {t('productList.csvImport')}
              </LinkButton>
            )}
            {canSeePath(identity, '/products/new') && (
              <LinkButton href="/products/new" variant="primary" icon={<Plus size={15} />}>
                {t('productList.newProduct')}
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
              <KpiCard
                label={t('productList.activeSkus')}
                icon={<Layers size={14} />}
                figure={<Dash />}
              />
              <KpiCard
                label={t('productList.unitsInStock')}
                icon={<Boxes size={14} />}
                figure={<Dash />}
              />
              <KpiCard
                label={t('productList.lowOnStock2')}
                icon={<TriangleAlert size={14} />}
                figure={<Dash />}
              />
              <KpiCard
                label={t('productList.stockValueAtCost')}
                icon={<Wallet size={14} />}
                figure={<Dash />}
              />
            </>
          ) : (
            <>
              <KpiCard
                label={t('productList.activeSkus')}
                icon={<Layers size={14} />}
                value={stock.data.totalSkus}
                format={rawCount}
                unit={t('productList.skus2')}
                tone="neutral"
              />
              <KpiCard
                label={t('productList.unitsInStock')}
                icon={<Boxes size={14} />}
                value={stock.data.totalQtyOnHand}
                format={rawCount}
                unit="units"
                tone="neutral"
                foot={[
                  { label: t('productList.sellableNow'), value: stock.data.totalQtyAvailable },
                  { label: t('productList.heldForOrders'), value: stock.data.totalQtyReserved },
                ]}
              />
              <KpiCard
                label={t('productList.lowOnStock2')}
                icon={<TriangleAlert size={14} />}
                value={stock.data.lowStockSkus}
                format={rawCount}
                unit={t('productList.skus2')}
                tone={stock.data.lowStockSkus > 0 ? 'pending' : 'neutral'}
                hint={stock.data.lowStockSkus > 0 ? t('productList.atOrUnderThe') : undefined}
              />
              <KpiCard
                label={t('productList.stockValueAtCost')}
                icon={<Wallet size={14} />}
                figure={<Money amount={stock.data.valueAtWarehouseInr} />}
                tone="neutral"
                foot={[
                  {
                    label: t('productList.inTransit'),
                    value: <Money amount={stock.data.valueInTransitInr} />,
                  },
                  // NOT folded into the total as zero. A batch with no
                  // recorded cost is worth something unknown, and the
                  // summary counts those units separately for exactly
                  // this reason (TRE-6's "uncovered, never defaulted").
                  ...(stock.data.valueUnknownUnits > 0
                    ? [
                        {
                          label: t('productList.unitsWithNoCost'),
                          value: stock.data.valueUnknownUnits,
                        },
                      ]
                    : []),
                ]}
              />
            </>
          )}
        </KpiGrid>
      )}

      <AreaSection
        title={t('productList.catalogueRegister')}
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
                label: t('productList.searchProductsByName'),
                placeholder: t('productList.nameOrRef'),
              }}
              filters={
                <Tabs
                  label={t('productList.productStatus')}
                  size="sm"
                  value={params.status === '' ? 'ALL' : params.status}
                  onChange={(id) =>
                    updateUrl({ status: id === 'ALL' ? '' : (id as ProductStatus), page: 1 })
                  }
                  items={[
                    { id: 'ALL', label: t('productList.allProducts') },
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
                    {t('productList.reset')}
                  </Button>
                ) : undefined
              }
            />
          </form>

          {list.isLoading ? (
            <PanelPad>
              <SkeletonRows rows={6} cols={6} label={t('productList.loadingCatalogue')} />
            </PanelPad>
          ) : list.isError ? (
            <PanelPad>
              <ErrorState
                message={list.error?.message ?? t('productList.failedToLoadCatalog')}
                retry={() => void list.refetch()}
              />
            </PanelPad>
          ) : !list.data || list.data.items.length === 0 ? (
            <PanelPad>
              <EmptyState
                bare
                title={
                  filtered ? t('productList.nothingMatchesThat') : t('productList.noProductsYet')
                }
                description={
                  filtered ? t('productList.tryADifferentName') : t('productList.addOneByHand')
                }
                action={
                  filtered ? (
                    <Button variant="secondary" size="md" onClick={resetFilters}>
                      {t('productList.resetFilters')}
                    </Button>
                  ) : canSeePath(identity, '/products/new') ? (
                    <LinkButton href="/products/new" variant="primary" icon={<Plus size={15} />}>
                      {t('productList.newProduct')}
                    </LinkButton>
                  ) : undefined
                }
              />
            </PanelPad>
          ) : (
            <>
              <Table caption={t('productList.catalogueRegister')}>
                <THead>
                  <Tr>
                    <Th aria-label={t('productList.picture')} />
                    <Th>{t('productList.product')}</Th>
                    <Th>{t('productList.yourRef')}</Th>
                    <Th>{t('productList.boxWeight')}</Th>
                    <Th align="right">{t('productList.declaredValue')}</Th>
                    <Th>{t('productList.status')}</Th>
                    <Th>{t('productList.updated')}</Th>
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
                              <span className="sk-figure inv-muted">
                                {box ?? t('productList.noBoxSize')}
                              </span>
                              <span className="inv-sub sk-figure">
                                {p.defaultWeightGrams === null
                                  ? t('productList.noWeight')
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
                  label={t('productList.cataloguePages')}
                />
              </PanelPad>
            </>
          )}
        </Panel>
      </AreaSection>
    </AreaPage>
  );
}
