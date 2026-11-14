'use client';

import { useState, type ReactElement, type ReactNode } from 'react';
import { Select } from '@skydrop/ui/app/select';
import { TextField } from '@skydrop/ui/app/text-field';
import { useSellersList, useStaffUsersList } from '@/lib/api-hooks';
import { useAdminResellerStores } from '@/lib/reseller-store-hooks';
import { useBinOptions, type BinStockLine } from '@/lib/bin-contents-hooks';
import { useProductLocations, useWarehouseOptions, type ProductLocationRow } from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { useT } from '@/i18n/client';
import { useBinLines } from './use-bin-lines';
import { binTypeLabelIn } from '@/app/(authed)/warehouse/bins/_components/bin-note';

/**
 * Pick by NAME instead of typing a database id.
 *
 * The stock forms ask for a client id, a product id and a shelf id. Each
 * piece here offers the same choice by name and writes the id into the
 * form for the worker. The typed id field is never removed: it is passed
 * in as `children` and stays one tap away under "Type the id instead",
 * and it is shown on its own whenever the list cannot be read (no
 * permission, or the list failed to load).
 *
 * Nothing here changes what the form sends: the value handed to
 * `onChange` is the same id a person would have typed.
 */

const TYPED = '__typed__';

function ByHand({
  children,
  open = false,
}: {
  readonly children: ReactNode;
  readonly open?: boolean;
}): ReactElement {
  const t = useT();
  return (
    <details className="ez-byhand" open={open || undefined}>
      <summary>{t('ezPick.byHand')}</summary>
      <div className="ez-byhand__body">{children}</div>
    </details>
  );
}

interface PickProps {
  readonly value: string;
  readonly onChange: (id: string) => void;
  /** The original id field, kept as the fallback. */
  readonly children: ReactNode;
  readonly requiredMark?: boolean;
}

/** The client, by company name. */
export function ClientPick({
  value,
  onChange,
  children,
  requiredMark = false,
}: PickProps): ReactElement {
  const t = useT();
  const may = usePermission('sellers.view');
  const sellers = useSellersList({ page: 1, pageSize: 100 });
  const items = sellers.data?.items ?? [];
  if (!may || items.length === 0) return <>{children}</>;
  const known = value === '' || items.some((s) => s.id === value);
  return (
    <div className="ez-pick">
      <Select
        label={t('ezPick.client')}
        requiredMark={requiredMark}
        value={known ? value : TYPED}
        onChange={(e) => {
          if (e.target.value !== TYPED) onChange(e.target.value);
        }}
      >
        <option value="">{t('ezPick.choose')}</option>
        {!known && <option value={TYPED}>{t('ezPick.typed')}</option>}
        {items.map((s) => (
          <option key={s.id} value={s.id}>
            {s.companyName}
          </option>
        ))}
      </Select>
      <ByHand>{children}</ByHand>
    </div>
  );
}

/** The shelf (bin), by its code, from the chosen warehouse. */
export function BinPick({
  warehouseId,
  value,
  onChange,
  children,
  requiredMark = false,
}: PickProps & { readonly warehouseId: string }): ReactElement {
  const t = useT();
  const may = usePermission('warehouse.view');
  const bins = useBinOptions(warehouseId);
  if (!may || bins.isError) return <>{children}</>;
  const items = bins.data ?? [];
  const known = value === '' || items.some((b) => b.id === value);
  return (
    <div className="ez-pick">
      <Select
        label={t('ezPick.bin')}
        requiredMark={requiredMark}
        hint={warehouseId === '' ? t('ezPick.warehouseFirst') : undefined}
        disabled={warehouseId === ''}
        value={known ? value : TYPED}
        onChange={(e) => {
          if (e.target.value !== TYPED) onChange(e.target.value);
        }}
      >
        <option value="">{t('ezPick.choose')}</option>
        {!known && <option value={TYPED}>{t('ezPick.typed')}</option>}
        {items.map((b) => (
          <option key={b.id} value={b.id}>
            {b.code} · {binTypeLabelIn(t, b.type)}
          </option>
        ))}
      </Select>
      <ByHand>{children}</ByHand>
    </div>
  );
}

/** What the "chosen product" card shows. */
export interface PickedProduct {
  readonly variantId: string;
  readonly productName: string | null;
  readonly variantLabel: string | null;
  readonly skuCode: string | null;
  readonly sellerCompanyName: string | null;
}

function productLine(row: PickedProduct | ProductLocationRow): string {
  const text = [row.productName, row.variantLabel]
    .filter((x) => x !== null && x !== '')
    .join(' · ');
  return text === '' ? (row.skuCode ?? '—') : text;
}

/** The product, found by name, SKU or barcode. */
export function ProductPick({
  value,
  onChange,
  children,
  known = null,
}: PickProps & {
  /** A product the form already knows by name (picked from a shelf line). */
  readonly known?: PickedProduct | null;
}): ReactElement {
  const t = useT();
  const [query, setQuery] = useState('');
  const [found1, setChosen] = useState<PickedProduct | null>(null);
  const chosen = found1 !== null && found1.variantId === value ? found1 : known;
  const found = useProductLocations(query);
  if (found.isError) return <>{children}</>;
  const rows = (found.data ?? []).slice(0, 8);
  const showChosen = chosen !== null && chosen.variantId === value;
  return (
    <div className="ez-pick">
      {showChosen ? (
        <div className="ez-pick__chosen">
          <div className="ez-pick__chosen-text">
            <span className="ez-pick__label">{t('ezPick.product')}</span>
            <span className="ez-pick__name">{productLine(chosen)}</span>
            <span className="ez-pick__sub">
              <span className="sk-ident">{chosen.skuCode}</span>
              {chosen.sellerCompanyName !== null && <> · {chosen.sellerCompanyName}</>}
            </span>
          </div>
          <button
            type="button"
            className="ez-pick__change"
            onClick={() => {
              setChosen(null);
              onChange('');
            }}
          >
            {t('ezPick.change')}
          </button>
        </div>
      ) : (
        <>
          <TextField
            label={t('ezPick.findProduct')}
            hint={t('ezPick.findHint')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.trim().length >= 2 && (
            <ul className="ez-pick__results" aria-label={t('ezPick.findProduct')}>
              {found.isLoading && <li className="ez-pick__empty">{t('ezPick.searching')}</li>}
              {!found.isLoading && rows.length === 0 && (
                <li className="ez-pick__empty">{t('ezPick.noMatch')}</li>
              )}
              {rows.map((row) => (
                <li key={row.variantId}>
                  <button
                    type="button"
                    className="ez-pick__result"
                    onClick={() => {
                      setChosen({
                        variantId: row.variantId,
                        productName: row.productName,
                        variantLabel: row.variantLabel,
                        skuCode: row.skuCode,
                        sellerCompanyName: row.sellerCompanyName,
                      });
                      setQuery('');
                      onChange(row.variantId);
                    }}
                  >
                    <span className="ez-pick__name">{productLine(row)}</span>
                    <span className="ez-pick__sub">
                      <span className="sk-ident">{row.skuCode}</span>
                      {row.sellerCompanyName !== null && <> · {row.sellerCompanyName}</>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <ByHand>{children}</ByHand>
    </div>
  );
}

/**
 * The batch, from what is actually on the chosen shelf.
 *
 * A batch id is the hardest of the four to know by heart, and the shelf's
 * own contents already name it. Each choice reads "batch · product · how
 * many are there". With a product chosen, only that product's batches are
 * offered. `onLine` also hands back the whole line, so a form can fill in
 * the client and the product from the same tap.
 */
export function BatchPick({
  binId,
  variantId,
  value,
  onChange,
  onLine,
  children,
  requiredMark = false,
}: PickProps & {
  readonly binId: string;
  readonly variantId: string;
  readonly onLine?: (line: BinStockLine) => void;
}): ReactElement {
  const t = useT();
  const may = usePermission('warehouse.view');
  const bin = binId.trim();
  const contents = useBinLines(bin, may);
  if (!may || contents.isError) return <>{children}</>;
  const all = contents.data?.items ?? [];
  const wanted = variantId.trim();
  const items = wanted === '' ? all : all.filter((l) => l.variantId === wanted);
  const known = value === '' || items.some((l) => l.batchId === value);
  const empty = bin !== '' && contents.isSuccess && items.length === 0;
  return (
    <div className="ez-pick">
      <Select
        label={t('ezPick.batch')}
        requiredMark={requiredMark}
        hint={bin === '' ? t('ezPick.shelfFirst') : empty ? t('ezPick.noBatchHere') : undefined}
        disabled={bin === '' || empty}
        value={known ? value : TYPED}
        onChange={(e) => {
          const line = items.find((l) => l.batchId === e.target.value);
          if (line === undefined) return;
          onChange(line.batchId);
          onLine?.(line);
        }}
      >
        <option value="">{t('ezPick.choose')}</option>
        {!known && <option value={TYPED}>{t('ezPick.typed')}</option>}
        {items.map((l) => (
          <option key={l.stockLevelId} value={l.batchId}>
            {[l.batchCode, l.skuCode ?? l.productName, t('ezPick.onShelf', { n: l.qtyOnHand })]
              .filter((x) => x !== null && x !== '')
              .join(' · ')}
          </option>
        ))}
      </Select>
      <ByHand open={empty}>{children}</ByHand>
    </div>
  );
}

/** A warehouse by its name; the id only while the list is not there. */
export function WarehouseName({ id }: { readonly id: string }): ReactElement {
  const warehouses = useWarehouseOptions();
  const name = (warehouses.data ?? []).find((w) => w.id === id)?.name;
  return name === undefined ? <span className="sk-ident">{id}</span> : <>{name}</>;
}

/** One list of names, with the typed id field kept underneath. */
function NameList({
  label,
  options,
  value,
  onChange,
  children,
}: PickProps & {
  readonly label: string;
  readonly options: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}): ReactElement {
  const t = useT();
  if (options.length === 0) return <>{children}</>;
  const known = value === '' || options.some((o) => o.id === value);
  return (
    <div className="ez-pick">
      <Select
        label={label}
        value={known ? value : TYPED}
        onChange={(e) => {
          if (e.target.value !== TYPED) onChange(e.target.value);
        }}
      >
        <option value="">{t('ezPick.choose')}</option>
        {!known && <option value={TYPED}>{t('ezPick.typed')}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
      <ByHand>{children}</ByHand>
    </div>
  );
}

function StaffList(props: PickProps): ReactElement {
  const t = useT();
  const staff = useStaffUsersList();
  const options = (staff.data ?? []).map((u) => ({
    id: u.id,
    name: `${u.emailDisplay} · ${u.roleNames.join(', ')}`,
  }));
  return <NameList {...props} label={t('ezPick.staff')} options={options} />;
}

/** A staff member, by email and role. Only asks for the list when allowed to read it. */
export function StaffPick(props: PickProps): ReactElement {
  const may = usePermission('staff.view', 'staff.manage');
  return may ? <StaffList {...props} /> : <>{props.children}</>;
}

function StoreList(props: PickProps): ReactElement {
  const t = useT();
  const stores = useAdminResellerStores({});
  const options = (stores.data ?? []).map((s) => ({
    id: s.id,
    name: `${s.displayName ?? s.name} · ${s.sellerCompanyName}`,
  }));
  return <NameList {...props} label={t('ezPick.store')} options={options} />;
}

/** A member store, by its name and its client. Only asks for the list when allowed. */
export function StorePick(props: PickProps): ReactElement {
  const may = usePermission('reseller.stores.view');
  return may ? <StoreList {...props} /> : <>{props.children}</>;
}
