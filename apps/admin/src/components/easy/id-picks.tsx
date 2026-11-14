'use client';

import { useState, type ReactElement, type ReactNode } from 'react';
import { Select } from '@skydrop/ui/app/select';
import { TextField } from '@skydrop/ui/app/text-field';
import { useSellersList } from '@/lib/api-hooks';
import { useBinOptions } from '@/lib/bin-contents-hooks';
import { useProductLocations, type ProductLocationRow } from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { useT } from '@/i18n/client';
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

function ByHand({ children }: { readonly children: ReactNode }): ReactElement {
  const t = useT();
  return (
    <details className="ez-byhand">
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

function productLine(row: ProductLocationRow): string {
  return [row.productName, row.variantLabel].filter((x) => x !== null && x !== '').join(' · ');
}

/** The product, found by name, SKU or barcode. */
export function ProductPick({ value, onChange, children }: PickProps): ReactElement {
  const t = useT();
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<ProductLocationRow | null>(null);
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
                      setChosen(row);
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
