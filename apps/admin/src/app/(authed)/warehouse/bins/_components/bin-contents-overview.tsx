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
import { BinNote, binTypeLabelIn } from './bin-note';
import './bins.css';
import { useT } from '@/i18n/client';

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
  const tr = useT();
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
      title={tr('warehouseBinsBinContentsOverview.whatSInEveryBin')}
      note={tr('warehouseBinsBinContentsOverview.eachBinWithTheProduct')}
    >
      <Toolbar>
        {all.length > 1 && (
          <Select
            id="bc-wh"
            label={tr('warehouseBinsBinContentsOverview.warehouse')}
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            <option value="">{tr('warehouseBinsBinContentsOverview.allWarehouses')}</option>
            {all.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </Select>
        )}
        <Select
          id="bc-type"
          label={tr('warehouseBinsBinContentsOverview.binType')}
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">{tr('warehouseBinsBinContentsOverview.allTypes')}</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {binTypeLabelIn(tr, t)}
            </option>
          ))}
        </Select>
        <Select
          id="bc-seller"
          label={tr('warehouseBinsBinContentsOverview.client')}
          value={sellerId}
          onChange={(e) => setSellerId(e.target.value)}
        >
          <option value="">{tr('warehouseBinsBinContentsOverview.allClients')}</option>
          {sellers.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
        <TextField
          id="bc-search"
          label={tr('warehouseBinsBinContentsOverview.productSkuOrBatch')}
          value={search}
          placeholder={tr('warehouseBinsBinContentsOverview.eGKrtRedL')}
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
          title={
            all.length === 0
              ? tr('warehouseBinsBinContentsOverview.noWarehousesYet')
              : tr('warehouseBinsBinContentsOverview.nothingMatches')
          }
          description={
            all.length === 0
              ? tr('warehouseBinsBinContentsOverview.createAWarehouseBelowIt')
              : tr('warehouseBinsBinContentsOverview.clearAFilterToSee')
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
                    {tr('warehouseBinsBinContentsOverview.locationTrackingOffStockWith')}
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
  const tr = useT();
  const empty = bin.lineCount === 0;
  return (
    <Panel>
      <div className="bin-card__head">
        <div className="bin-card__id">
          <Link href={`/warehouse/bins/${bin.id}`} className="stk-link sk-ident bin-card__code">
            {bin.code}
          </Link>
          <ToneText tone="muted">{binTypeLabelIn(tr, bin.type)}</ToneText>
          <ToneText tone="faint">
            {tr('warehouseBinsBinContentsOverview.zone', { value: bin.zoneCode ?? '—' })}
          </ToneText>
          {bin.pickable ? (
            <ToneText tone="faint">pickable</ToneText>
          ) : (
            <ToneText tone="bad">{tr('warehouseBinsBinContentsOverview.notPickable')}</ToneText>
          )}
        </div>
        <div className="bin-card__total sk-figure" data-testid={`bin-total-${bin.code}`}>
          {empty ? (
            <ToneText tone="faint">{tr('warehouseBinsBinContentsOverview.empty')}</ToneText>
          ) : (
            <>
              <Num value={bin.unitsOnHand} suffix=" units" /> ·{' '}
              <Num value={bin.skuCount} suffix={bin.skuCount === 1 ? ' SKU' : ' SKUs'} />
              {bin.unitsReserved > 0 && (
                <ToneText tone="muted">
                  {' '}
                  · <Num value={bin.unitsReserved} />{' '}
                  {tr('warehouseBinsBinContentsOverview.reservedForPicks')}
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
          {lineFilterOn ? tr('warehouseBinsBinContentsOverview.filtersApplyToTheLines') : ''}
          <TextLink href={`/warehouse/bins/${bin.id}`}>
            {tr('warehouseBinsBinContentsOverview.moreLineOpen', {
              linesNotShown: bin.linesNotShown,
              value: bin.linesNotShown === 1 ? '' : tr('common.pluralS'),
              code: bin.code,
            })}
          </TextLink>
        </p>
      )}
    </Panel>
  );
}

/** Shared by the overview and a bin's own page. */
export function LinesTable({ lines }: { readonly lines: readonly BinStockLine[] }): ReactElement {
  const tr = useT();
  return (
    <Table>
      <THead>
        <Tr>
          <Th>{tr('warehouseBinsBinContentsOverview.product')}</Th>
          <Th>SKU</Th>
          <Th>{tr('warehouseBinsBinContentsOverview.client')}</Th>
          <Th>{tr('warehouseBinsBinContentsOverview.batch')}</Th>
          <Th align="right">{tr('warehouseBinsBinContentsOverview.onHand')}</Th>
          <Th align="right">{tr('warehouseBinsBinContentsOverview.reserved')}</Th>
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
  const tr = useT();
  return (
    <span className="bin-product">
      <ProductThumb src={line.thumbnailUrl} size={36} alt={line.productName ?? ''} />
      {line.productName === null ? (
        // The variant was deleted from the catalogue; the stock is still real.
        <span className="stk-muted">
          {tr('warehouseBinsBinContentsOverview.deletedProduct')} <Ident value={line.variantId} />
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
  const tr = useT();
  return (
    <span>
      <Code>{line.batchCode}</Code>
      {line.batchExpiresAt !== null && (
        <span className="stk-sub">
          {tr('warehouseBinsBinContentsOverview.expires', {
            value: new Date(line.batchExpiresAt).toLocaleDateString('en-IN'),
          })}
        </span>
      )}
    </span>
  );
}
