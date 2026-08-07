'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { ProductStatus } from '@skydrop/db';
import { useSellerIdentity } from '@skydrop/auth/client';
import { useProductsList } from '@/lib/api-hooks';
import { canSeePath } from '@/lib/page-access';
import {
  Button,
  Input,
  Select,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  TablePaginator,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@skydrop/ui/components';

/**
 * Seller catalog list — product-grain at the top level (the backend
 * serves /seller/products paginated; variants live per-product at
 * /seller/products/:id/variants). Click into a product to see its
 * variants + edit it.
 *
 * URL-driven filters (status + search + page) so deep-linked filters
 * are shareable + browser back/forward navigates.
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

export function CatalogIndex(): ReactElement {
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
      router.replace(qs ? `/catalog?${qs}` : '/catalog');
    },
    [params, router],
  );

  const list = useProductsList({
    ...(params.status ? { status: params.status } : {}),
    ...(params.search ? { search: params.search } : {}),
    page: params.page,
    pageSize: PAGE_SIZE,
  });

  return (
    <div>
      <PageHeader
        title="Catalog"
        subtitle="Products, variants, images. Click a product to edit or manage its variants."
        action={
          <span className="flex gap-2">
            {canSeePath(identity, '/catalog/import') && (
              <Link href="/catalog/import">
                <Button variant="ghost" size="md">
                  CSV import
                </Button>
              </Link>
            )}
          </span>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateUrl({ search: searchInput.trim(), page: 1 });
          }}
          className="flex items-center gap-2"
        >
          <Input
            placeholder="Name, ref, brand…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-80"
          />
        </form>
        <Select
          value={params.status}
          onChange={(e) =>
            updateUrl({
              status: (e.target.value as ProductStatus | '') || '',
              page: 1,
            })
          }
          className="w-[180px]"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        {(params.status || params.search) && (
          <button
            type="button"
            onClick={() => {
              setSearchInput('');
              updateUrl({ status: '', search: '', page: 1 });
            }}
            className="text-text-faint hover:text-text-body text-xs px-2 py-1 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {list.isLoading ? (
        <LoadingState label="Loading catalog…" />
      ) : list.isError ? (
        <ErrorState
          message={list.error?.message ?? 'Failed to load catalog.'}
          retry={() => void list.refetch()}
        />
      ) : !list.data || list.data.items.length === 0 ? (
        <EmptyState
          title="No products yet"
          description="Use the CSV import or contact your account manager to onboard your catalog."
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Name</Th>
              <Th>Brand</Th>
              <Th>Ref</Th>
              <Th>Status</Th>
              <Th align="right">Weight (g)</Th>
              <Th>Updated</Th>
            </Tr>
          </THead>
          <TBody>
            {list.data.items.map((p) => (
              <Tr key={p.id} onActivate={() => router.push(`/catalog/products/${p.id}`)}>
                <Td>
                  <Link
                    href={`/catalog/products/${p.id}`}
                    className="text-text-bright hover:underline"
                  >
                    {p.name}
                  </Link>
                </Td>
                <Td className="text-text-muted">{p.brand ?? '—'}</Td>
                <Td className="text-text-muted font-mono text-xs">{p.externalRef ?? '—'}</Td>
                <Td>
                  <StatusBadge kind={productStatusKind(p.status)} label={p.status.toLowerCase()} />
                </Td>
                <Td align="right" className="text-text-muted font-mono text-xs">
                  {p.defaultWeightGrams ?? '—'}
                </Td>
                <Td className="text-text-muted text-xs font-mono">
                  {new Date(p.updatedAt).toISOString().slice(0, 16).replace('T', ' ')}
                </Td>
              </Tr>
            ))}
          </TBody>
          <tfoot>
            <tr>
              <td colSpan={6} className="p-0">
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
    </div>
  );
}
