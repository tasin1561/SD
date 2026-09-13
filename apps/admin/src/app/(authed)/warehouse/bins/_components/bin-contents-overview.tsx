'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactElement } from 'react';
import {
  Card,
  CardBody,
  EmptyState,
  ErrorNote,
  FormField,
  Ident,
  Input,
  Num,
  ProductThumb,
  Section,
  Select,
  SkeletonRows,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Toolbar,
  Tr,
} from '@skydrop/ui/components';
import {
  useBinOverview,
  type BinStockLine,
  type BinWithLines,
  type WarehouseWithBins,
} from '@/lib/bin-contents-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { BinNote, binTypeLabel } from './bin-note';

/**
 * Every bin, and what is in it — the answer to "where can I see what
 * R-01-01 holds?" without opening anything.
 *
 * One request returns every warehouse, every bin and each bin's stock
 * lines (the API caps a bin at `linesPerBin` and says how many more there
 * are; the bin's own page has them all). The filters work on what came
 * back, so they cost no round trip — and because a large bin is capped,
 * a seller or SKU filter says so rather than implying it searched lines
 * it never received.
 */
export function BinContentsOverview(): ReactElement {
  const overview = useBinOverview();
  const [warehouseId, setWarehouseId] = useState('');
  const [type, setType] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [search, setSearch] = useState('');

  const all = overview.data?.warehouses ?? [];
  const types = useMemo(
    () => [...new Set(all.flatMap((w) => w.bins.map((b) => b.type)))].sort(),
    [all],
  );
  const sellers = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of all)
      for (const b of w.bins)
        for (const l of b.lines) m.set(l.sellerId, l.sellerName ?? l.sellerId);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);

  const lineFilterOn = sellerId !== '' || search.trim() !== '';
  const needle = search.trim().toLowerCase();
  const matches = (l: BinStockLine): boolean =>
    (sellerId === '' || l.sellerId === sellerId) &&
    (needle === '' ||
      [l.productName, l.skuCode, l.variantLabel, l.batchCode, l.sellerName].some(
        (s) => s !== null && s.toLowerCase().includes(needle),
      ));

  const shown: Array<{ warehouse: WarehouseWithBins; bins: BinWithLines[] }> = all
    .filter((w) => warehouseId === '' || w.id === warehouseId)
    .map((w) => ({
      warehouse: w,
      bins: w.bins
        .filter((b) => type === '' || b.type === type)
        .map((b) => (lineFilterOn ? { ...b, lines: b.lines.filter(matches) } : b))
        // A line filter hides bins with nothing matching; otherwise every
        // bin shows, the empty ones included — "empty" is an answer too.
        .filter((b) => !lineFilterOn || b.lines.length > 0),
    }))
    .filter((g) => g.bins.length > 0);

  return (
    <Section
      title="What's in every bin"
      subtitle="Each bin with the product, seller and batch on it. Returns-hold, damaged and in-transit stock is shown but cannot be sold."
    >
      <Toolbar>
        {all.length > 1 && (
          <FormField label="Warehouse" htmlFor="bc-wh" className="w-56">
            <Select id="bc-wh" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">All warehouses</option>
              {all.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <FormField label="Bin type" htmlFor="bc-type" className="w-48">
          <Select id="bc-type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {binTypeLabel(t)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Seller" htmlFor="bc-seller" className="w-56">
          <Select id="bc-seller" value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
            <option value="">All sellers</option>
            {sellers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Product, SKU or batch" htmlFor="bc-search" className="w-64">
          <Input
            id="bc-search"
            value={search}
            placeholder="e.g. KRT-RED-L"
            onChange={(e) => setSearch(e.target.value)}
          />
        </FormField>
      </Toolbar>

      {overview.isLoading ? (
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      ) : overview.isError ? (
        <ErrorNote message={serverVerdict(overview.error)} retry={() => void overview.refetch()} />
      ) : shown.length === 0 ? (
        <EmptyState
          title={all.length === 0 ? 'No warehouses yet' : 'Nothing matches'}
          description={
            all.length === 0
              ? 'Create a warehouse below; it gets a FLOOR bin automatically.'
              : 'Clear a filter to see every bin again.'
          }
        />
      ) : (
        <div className="space-y-6">
          {shown.map(({ warehouse, bins }) => (
            <div key={warehouse.id} className="space-y-3">
              <h3 className="text-text-body text-sm font-semibold">
                {warehouse.code} — {warehouse.name}
                {!warehouse.binTrackingEnabled && (
                  <span className="text-text-faint ml-2 font-normal">
                    location tracking off — stock with no recorded shelf is in FLOOR
                  </span>
                )}
              </h3>
              {bins.map((b) => (
                <BinCard key={b.id} bin={b} lineFilterOn={lineFilterOn} />
              ))}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function BinCard({
  bin,
  lineFilterOn,
}: {
  readonly bin: BinWithLines;
  readonly lineFilterOn: boolean;
}): ReactElement {
  const empty = bin.lineCount === 0;
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Link
              href={`/warehouse/bins/${bin.id}`}
              className="font-mono text-base font-semibold underline-offset-2 hover:underline"
            >
              {bin.code}
            </Link>
            <span className="text-text-muted text-sm">{binTypeLabel(bin.type)}</span>
            <span className="text-text-faint text-sm">zone {bin.zoneCode ?? '—'}</span>
            {bin.pickable ? (
              <span className="text-text-faint text-sm">pickable</span>
            ) : (
              <span className="text-sm text-[var(--status-rto-fg)]">not pickable</span>
            )}
          </div>
          <div className="text-sm" data-testid={`bin-total-${bin.code}`}>
            {empty ? (
              <span className="text-text-faint">Empty</span>
            ) : (
              <>
                <Num value={bin.unitsOnHand} suffix=" units" /> ·{' '}
                <Num value={bin.skuCount} suffix={bin.skuCount === 1 ? ' SKU' : ' SKUs'} />
                {bin.unitsReserved > 0 && (
                  <span className="text-text-muted">
                    {' '}
                    · <Num value={bin.unitsReserved} /> reserved for picks
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {/* Said even when empty: "what is R-01-01 for" is half the question. */}
        <BinNote type={bin.type} />

        {!empty && bin.lines.length > 0 && <LinesTable lines={bin.lines} />}

        {bin.linesNotShown > 0 && (
          <p className="text-text-muted text-sm">
            {lineFilterOn ? 'Filters apply to the lines shown here. ' : ''}
            <Link href={`/warehouse/bins/${bin.id}`} className="underline">
              {bin.linesNotShown} more line{bin.linesNotShown === 1 ? '' : 's'} — open {bin.code}
            </Link>
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/** Shared by the overview and a bin's own page. */
export function LinesTable({ lines }: { readonly lines: readonly BinStockLine[] }): ReactElement {
  return (
    <Table>
      <THead>
        <Tr>
          <Th>Product</Th>
          <Th>SKU</Th>
          <Th>Seller</Th>
          <Th>Batch</Th>
          <Th align="right">On hand</Th>
          <Th align="right">Reserved</Th>
        </Tr>
      </THead>
      <TBody>
        {lines.map((l) => (
          <Tr key={l.stockLevelId}>
            <Td>
              <ProductCell line={l} />
            </Td>
            <Td>{l.skuCode === null ? '—' : <span className="font-mono">{l.skuCode}</span>}</Td>
            <Td>{l.sellerName ?? <Ident value={l.sellerId} />}</Td>
            <Td>
              <BatchCell line={l} />
            </Td>
            <Td align="right">
              <Num value={l.qtyOnHand} />
            </Td>
            <Td align="right">{l.qtyReserved > 0 ? <Num value={l.qtyReserved} /> : '—'}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

export function ProductCell({ line }: { readonly line: BinStockLine }): ReactElement {
  return (
    <span className="flex items-center gap-2">
      <ProductThumb src={line.thumbnailUrl} size={36} alt={line.productName ?? ''} />
      {line.productName === null ? (
        // The variant was deleted from the catalogue; the stock is still real.
        <span className="text-text-muted">
          Deleted product <Ident value={line.variantId} />
        </span>
      ) : (
        <span>
          {line.productName}
          {line.variantLabel !== null && (
            <span className="text-text-muted block text-xs">{line.variantLabel}</span>
          )}
        </span>
      )}
    </span>
  );
}

export function BatchCell({ line }: { readonly line: BinStockLine }): ReactElement {
  return (
    <span>
      <span className="font-mono">{line.batchCode}</span>
      {line.batchExpiresAt !== null && (
        <span className="text-text-muted block text-xs">
          expires {new Date(line.batchExpiresAt).toLocaleDateString('en-IN')}
        </span>
      )}
    </span>
  );
}
