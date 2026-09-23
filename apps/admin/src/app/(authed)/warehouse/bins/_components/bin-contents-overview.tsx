'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactElement } from 'react';
import { Ident, Num, ProductThumb } from '@skydrop/ui/components';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { Select } from '@skydrop/ui/app/select';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { TextField } from '@skydrop/ui/app/text-field';
import {
  useBinOverview,
  type BinStockLine,
  type BinWithLines,
  type WarehouseWithBins,
} from '@/lib/bin-contents-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import {
  AreaSection,
  Code,
  InlineError,
  Panel,
  Stack,
  TextLink,
  ToneText,
  Toolbar,
} from '../../../inventory/_components/stock-kit';
import { BinNote, binTypeLabel } from './bin-note';
import './bins.css';

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
    <AreaSection
      title="What's in every bin"
      note="Each bin with the product, seller and batch on it. Returns-hold, damaged and in-transit stock is shown but cannot be sold."
    >
      <Toolbar>
        {all.length > 1 && (
          <Select
            id="bc-wh"
            label="Warehouse"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            <option value="">All warehouses</option>
            {all.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </Select>
        )}
        <Select
          id="bc-type"
          label="Bin type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {binTypeLabel(t)}
            </option>
          ))}
        </Select>
        <Select
          id="bc-seller"
          label="Seller"
          value={sellerId}
          onChange={(e) => setSellerId(e.target.value)}
        >
          <option value="">All sellers</option>
          {sellers.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
        <TextField
          id="bc-search"
          label="Product, SKU or batch"
          value={search}
          placeholder="e.g. KRT-RED-L"
          onChange={(e) => setSearch(e.target.value)}
        />
      </Toolbar>

      {overview.isLoading ? (
        <SkeletonRows rows={6} cols={6} />
      ) : overview.isError ? (
        <InlineError
          message={serverVerdict(overview.error)}
          retry={() => void overview.refetch()}
        />
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
        <Stack>
          {shown.map(({ warehouse, bins }) => (
            <Stack key={warehouse.id} tight>
              <h3 className="stk-group-title">
                {warehouse.code} — {warehouse.name}
                {!warehouse.binTrackingEnabled && (
                  <span className="stk-faint">
                    location tracking off — stock with no recorded shelf is in FLOOR
                  </span>
                )}
              </h3>
              {bins.map((b) => (
                <BinCard key={b.id} bin={b} lineFilterOn={lineFilterOn} />
              ))}
            </Stack>
          ))}
        </Stack>
      )}
    </AreaSection>
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
    <Panel>
      <div className="bin-card__head">
        <div className="bin-card__id">
          <Link href={`/warehouse/bins/${bin.id}`} className="stk-link sk-ident bin-card__code">
            {bin.code}
          </Link>
          <ToneText tone="muted">{binTypeLabel(bin.type)}</ToneText>
          <ToneText tone="faint">zone {bin.zoneCode ?? '—'}</ToneText>
          {bin.pickable ? (
            <ToneText tone="faint">pickable</ToneText>
          ) : (
            <ToneText tone="bad">not pickable</ToneText>
          )}
        </div>
        <div className="bin-card__total sk-figure" data-testid={`bin-total-${bin.code}`}>
          {empty ? (
            <ToneText tone="faint">Empty</ToneText>
          ) : (
            <>
              <Num value={bin.unitsOnHand} suffix=" units" /> ·{' '}
              <Num value={bin.skuCount} suffix={bin.skuCount === 1 ? ' SKU' : ' SKUs'} />
              {bin.unitsReserved > 0 && (
                <ToneText tone="muted">
                  {' '}
                  · <Num value={bin.unitsReserved} /> reserved for picks
                </ToneText>
              )}
            </>
          )}
        </div>
      </div>

      {/* Said even when empty: "what is R-01-01 for" is half the question. */}
      <BinNote type={bin.type} />

      {!empty && bin.lines.length > 0 && <LinesTable lines={bin.lines} />}

      {bin.linesNotShown > 0 && (
        <p className="stk-note">
          {lineFilterOn ? 'Filters apply to the lines shown here. ' : ''}
          <TextLink href={`/warehouse/bins/${bin.id}`}>
            {bin.linesNotShown} more line{bin.linesNotShown === 1 ? '' : 's'} — open {bin.code}
          </TextLink>
        </p>
      )}
    </Panel>
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
            <Td>{l.skuCode === null ? '—' : <Code>{l.skuCode}</Code>}</Td>
            <Td>{l.sellerName ?? <Ident value={l.sellerId} />}</Td>
            <Td>
              <BatchCell line={l} />
            </Td>
            <Td align="right" className="sk-figure">
              <Num value={l.qtyOnHand} />
            </Td>
            <Td align="right" className="sk-figure">
              {l.qtyReserved > 0 ? <Num value={l.qtyReserved} /> : '—'}
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

export function ProductCell({ line }: { readonly line: BinStockLine }): ReactElement {
  return (
    <span className="bin-product">
      <ProductThumb src={line.thumbnailUrl} size={36} alt={line.productName ?? ''} />
      {line.productName === null ? (
        // The variant was deleted from the catalogue; the stock is still real.
        <span className="stk-muted">
          Deleted product <Ident value={line.variantId} />
        </span>
      ) : (
        <span>
          {line.productName}
          {line.variantLabel !== null && <span className="stk-sub">{line.variantLabel}</span>}
        </span>
      )}
    </span>
  );
}

export function BatchCell({ line }: { readonly line: BinStockLine }): ReactElement {
  return (
    <span>
      <Code>{line.batchCode}</Code>
      {line.batchExpiresAt !== null && (
        <span className="stk-sub">
          expires {new Date(line.batchExpiresAt).toLocaleDateString('en-IN')}
        </span>
      )}
    </span>
  );
}
