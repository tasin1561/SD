'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { ProductStatus } from '@skydrop/db';
import { useSellerIdentity } from '@skydrop/auth/client';
import { useProductsList, useStockSummary } from '@/lib/api-hooks';
import { canSeePath } from '@/lib/page-access';
import { Boxes, Layers, Plus, TriangleAlert, Wallet } from 'lucide-react';
import {
  BandBody,
  Button,
  Crumbs,
  EmptyState,
  ErrorState,
  FilterChip,
  Input,
  LoadingState,
  MetaChip,
  Money,
  PageHeader,
  SectionBand,
  Stat,
  StatusBadge,
  TBody,
  Table,
  TablePaginator,
  Td,
  Th,
  THead,
  Tr,
} from '@skydrop/ui/components';

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
  const stock = useStockSummary();

  const filtered = params.status !== '' || params.search !== '';

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[{ label: 'Seller console' }, { label: 'Stock & WMS' }, { label: 'Products' }]}
            Link={Link}
          />
        }
        title="Products"
        subtitle="Your catalogue: products, their variants and the pictures customers see."
        meta={
          stock.data === undefined ? undefined : (
            <>
              <MetaChip tone="accent">{stock.data.totalSkus} SKUs</MetaChip>
              {stock.data.lowStockSkus > 0 && (
                <MetaChip tone="warn">{stock.data.lowStockSkus} low on stock</MetaChip>
              )}
              {stock.data.totalQtyInTransit > 0 && (
                <MetaChip dot>{stock.data.totalQtyInTransit} units in transit</MetaChip>
              )}
            </>
          )
        }
        action={
          <div className="flex items-center gap-2">
            {canSeePath(identity, '/products/import') && (
              <Link href="/products/import">
                <Button variant="ghost" size="md">
                  CSV import
                </Button>
              </Link>
            )}
            {canSeePath(identity, '/products/new') && (
              <Link href="/products/new">
                <Button variant="primary" size="md">
                  <Plus size={14} /> New product
                </Button>
              </Link>
            )}
          </div>
        }
      />

      {/* ── What the catalogue is holding ───────────────────────────
             Four tiles from `/seller/stock/summary`, which is the ONE
             place these numbers are real. A value is ABSENT rather
             than 0 while loading: a tile reading "0 in stock" that
             then becomes 14,820 has told you something false in the
             meantime, and this is the screen a seller checks before
             deciding whether to ship more. */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Active SKUs"
          icon={<Layers size={13} aria-hidden />}
          value={stock.data?.totalSkus ?? <span className="text-text-faint">—</span>}
          unit={stock.data === undefined ? undefined : 'SKUs'}
          tone="neutral"
        />
        <Stat
          label="Units in stock"
          icon={<Boxes size={13} aria-hidden />}
          value={stock.data?.totalQtyOnHand ?? <span className="text-text-faint">—</span>}
          unit={stock.data === undefined ? undefined : 'units'}
          tone="neutral"
          {...(stock.data === undefined
            ? {}
            : {
                foot: [
                  { label: 'Sellable now', value: stock.data.totalQtyAvailable },
                  { label: 'Held for orders', value: stock.data.totalQtyReserved },
                ],
              })}
        />
        <Stat
          label="Low on stock"
          icon={<TriangleAlert size={13} aria-hidden />}
          value={stock.data?.lowStockSkus ?? <span className="text-text-faint">—</span>}
          unit={stock.data === undefined ? undefined : 'SKUs'}
          tone={stock.data !== undefined && stock.data.lowStockSkus > 0 ? 'warn' : 'neutral'}
          hint={
            stock.data !== undefined && stock.data.lowStockSkus > 0
              ? 'At or under the threshold you set.'
              : undefined
          }
        />
        <Stat
          label="Stock value at cost"
          icon={<Wallet size={13} aria-hidden />}
          value={
            stock.data === undefined ? (
              <span className="text-text-faint">—</span>
            ) : (
              <Money amount={stock.data.valueAtWarehouseInr} />
            )
          }
          tone="neutral"
          {...(stock.data === undefined
            ? {}
            : {
                foot: [
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
                ],
              })}
        />
      </div>

      <SectionBand
        index="01"
        title="Catalogue register"
        note={
          list.data === undefined
            ? undefined
            : `${list.data.total} ${list.data.total === 1 ? 'product' : 'products'}${
                filtered ? ' matching' : ''
              }`
        }
        action={
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                updateUrl({ search: searchInput.trim(), page: 1 });
              }}
            >
              <Input
                placeholder="Name or ref…"
                aria-label="Search products by name or reference"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full sm:w-64"
              />
            </form>
            {filtered && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput('');
                  updateUrl({ status: '', search: '', page: 1 });
                }}
                className="text-text-faint hover:text-text-body px-1 text-xs transition-colors"
              >
                Reset
              </button>
            )}
          </>
        }
      />

      <BandBody flush>
        {/* The status filter as chips rather than a <select>: three
            values, all worth seeing at once, and the comps put the
            triage row directly above the register it filters. */}
        <div className="border-border flex flex-wrap items-center gap-1.5 border-b px-3 py-2.5">
          <FilterChip
            label="All products"
            active={params.status === ''}
            onClick={() => updateUrl({ status: '', page: 1 })}
          />
          {STATUSES.map((s) => (
            <FilterChip
              key={s}
              label={s.charAt(0) + s.slice(1).toLowerCase()}
              active={params.status === s}
              onClick={() => updateUrl({ status: s, page: 1 })}
            />
          ))}
        </div>

        {list.isLoading ? (
          <div className="p-3">
            <LoadingState label="Loading catalogue…" />
          </div>
        ) : list.isError ? (
          <div className="p-3">
            <ErrorState
              message={list.error?.message ?? 'Failed to load catalog.'}
              retry={() => void list.refetch()}
            />
          </div>
        ) : !list.data || list.data.items.length === 0 ? (
          <div className="p-3">
            <EmptyState
              title={filtered ? 'Nothing matches that' : 'No products yet'}
              description={
                filtered
                  ? 'Try a different name or reference, or reset the filters.'
                  : 'Add one by hand, or bring a whole catalogue in with the CSV import.'
              }
              action={
                filtered ? (
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => {
                      setSearchInput('');
                      updateUrl({ status: '', search: '', page: 1 });
                    }}
                  >
                    Reset filters
                  </Button>
                ) : canSeePath(identity, '/products/new') ? (
                  <Link href="/products/new">
                    <Button variant="primary" size="md">
                      <Plus size={14} /> New product
                    </Button>
                  </Link>
                ) : undefined
              }
            />
          </div>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th className="w-14" aria-label="Picture" />
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
                        <img
                          src={p.primaryImageUrl}
                          alt=""
                          className="border-border h-9 w-9 rounded-[var(--radius-2)] border object-cover"
                        />
                      ) : (
                        <div
                          className="border-border bg-surface-raised h-9 w-9 rounded-[var(--radius-2)] border"
                          aria-hidden
                        />
                      )}
                    </Td>
                    <Td>
                      <Link
                        href={`/products/${p.id}`}
                        className="text-text-bright font-medium hover:underline"
                      >
                        {p.name}
                      </Link>
                      {p.description !== null && p.description !== '' && (
                        <span className="text-text-faint mt-0.5 block truncate text-xs">
                          {p.description}
                        </span>
                      )}
                    </Td>
                    <Td className="text-text-muted font-mono text-xs">{p.externalRef ?? '—'}</Td>
                    <Td className="text-text-muted text-xs">
                      {box === null && p.defaultWeightGrams === null ? (
                        <span className="text-text-faint">—</span>
                      ) : (
                        <>
                          <span className="font-mono">{box ?? 'No box size'}</span>
                          <span className="text-text-faint mt-0.5 block font-mono">
                            {p.defaultWeightGrams === null
                              ? 'No weight'
                              : `${p.defaultWeightGrams} g`}
                          </span>
                        </>
                      )}
                    </Td>
                    <Td align="right">
                      {p.defaultDeclaredValueInr === null ? (
                        <span className="text-text-faint text-xs">—</span>
                      ) : (
                        <Money amount={p.defaultDeclaredValueInr} />
                      )}
                    </Td>
                    <Td>
                      <StatusBadge
                        kind={productStatusKind(p.status)}
                        label={p.status.toLowerCase()}
                      />
                    </Td>
                    <Td className="text-text-muted font-mono text-xs">
                      {new Date(p.updatedAt).toISOString().slice(0, 16).replace('T', ' ')}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
            <tfoot>
              <tr>
                <td colSpan={7} className="p-0">
                  <TablePaginator
                    page={params.page}
                    pageSize={PAGE_SIZE}
                    total={list.data.total}
                    onPageChange={(next) => updateUrl({ page: next })}
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
