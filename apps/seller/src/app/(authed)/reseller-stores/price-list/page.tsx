'use client';

import Link from 'next/link';
import { useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { Boxes, PackageSearch, Pencil, Store, Tag, Trash2 } from 'lucide-react';
import { Money, Num, ProductThumb } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Table, TBody, THead, Td, Th, TableToolbar, Tr } from '@skydrop/ui/app/data-table';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { GlossaryTerm } from '@skydrop/ui/app/tooltip-card';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton, SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useRemoveResellerDefaultPrice,
  useResellerPriceList,
  useSetResellerDefaultPrice,
  type PriceListRow,
} from '@/lib/reseller-catalogue-hooks';
import { PriceFields, draftFrom, priceBody, type PriceDraft } from '../_components/price-fields';
import {
  RsBack,
  RsError,
  RsFact,
  RsFacts,
  RsProduct,
  RsSection,
  RsStrip,
  RsStripFact,
  pendingPhase,
} from '../_components/rs-parts';

/**
 * RS-3 — the seller's DEFAULT reseller price list: what every reseller
 * store pays per unit, and the retail range it may sell at, unless a
 * store has a price of its own. Gated on `stores.pricing` (page-access).
 *
 * ── WHAT THE CONSOLE COMPS SHOW THAT IS NOT HERE ────────────────────
 *   MARGIN PER SKU        margin is transfer price − your unit COST, and
 *       this endpoint carries no cost: the batch cost is in inventory,
 *       not on the price list. The reports page computes margin where a
 *       cost is known and states its coverage — which is the honest
 *       version, and an uncovered "%" column here would not be.
 *   UNITS SOLD AT THIS PRICE   nothing on this row counts orders. The
 *       stock forecast answers it, per product, over a stated window.
 *   A STORE-BY-STORE PRICE COLUMN   an override belongs to one store and
 *       is set on that store's page; `enabledInStores` is the count this
 *       list genuinely holds.
 */
export default function ResellerPriceListPage(): ReactElement {
  const list = useResellerPriceList();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<PriceListRow | null>(null);
  const [removing, setRemoving] = useState<PriceListRow | null>(null);
  const toast = useToast();
  const remove = useRemoveResellerDefaultPrice();

  const all = useMemo(() => list.data?.rows ?? [], [list.data]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === '') return all;
    return all.filter(
      (r) => r.skuCode.toLowerCase().includes(q) || r.productName.toLowerCase().includes(q),
    );
  }, [all, search]);

  const priced = all.filter((r) => r.price !== null).length;
  const inStores = all.filter((r) => r.enabledInStores > 0).length;
  const available = all.reduce((sum, r) => sum + r.available, 0);

  const header = (
    <div className="rs-head">
      <RsBack href="/reseller-stores">Reseller stores</RsBack>
      <PageHeader
        breadcrumbs={[{ label: 'Seller console' }, { label: 'Reselling' }, { label: 'Price list' }]}
        Link={Link}
        title="Reseller price list"
        subtitle="Your default price to every reseller store, and the range it may sell at. A store can be given its own price on its page."
        meta={
          list.data === undefined ? undefined : (
            <RsFacts>
              <RsFact tone={priced > 0 ? 'accent' : 'warn'}>
                {priced} of {all.length} priced
              </RsFact>
              {list.data.truncated && <RsFact tone="warn">First 2,000 products</RsFact>}
            </RsFacts>
          )
        }
      />
    </div>
  );

  if (list.isPending) {
    return (
      <div className="rs-page">
        {header}
        <div className="rs-kpis">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="rs-kpi-skel" height={104} rounded="md" />
          ))}
        </div>
        <SkeletonRows rows={6} cols={7} label="Loading your products" />
      </div>
    );
  }
  if (list.isError) {
    return (
      <div className="rs-page">
        {header}
        <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      </div>
    );
  }

  return (
    <div className="rs-page">
      {header}

      {/* ── What is on offer to your stores ─────────────────────────
             Three cards, counted off the list below. No margin and no
             sales figures: neither is on this endpoint, and both would
             have to be invented — see the header comment. The two plain
             counts roll up once; the unit total keeps its `<Num>`. */}
      <div className="rs-kpis">
        <KpiCard
          label="Priced for resale"
          icon={<Tag size={14} />}
          value={priced}
          unit={`of ${all.length}`}
          tone={priced === 0 ? 'pending' : 'neutral'}
          hint="A product with no price here cannot be sold by a store on your default terms."
        />
        <KpiCard
          label="Being sold by a store"
          icon={<Store size={14} />}
          value={inStores}
          unit={inStores === 1 ? 'product' : 'products'}
          tone="neutral"
          hint="Switched on for at least one of your reseller stores."
        />
        <KpiCard
          label="Units available"
          icon={<Boxes size={14} />}
          figure={<Num value={available} />}
          unit="units"
          tone="neutral"
          hint="Sellable stock across the products listed."
        />
      </div>

      <RsSection
        title="Products"
        note={
          list.data.truncated
            ? 'Your first 2,000 active products.'
            : `${rows.length} ${rows.length === 1 ? 'product' : 'products'}`
        }
        flush
      >
        <TableToolbar
          search={{
            value: search,
            onChange: setSearch,
            label: 'Search by product or SKU',
            placeholder: 'Product or SKU…',
          }}
          action={
            search !== '' ? (
              <Button variant="ghost" size="sm" onClick={() => setSearch('')}>
                Reset
              </Button>
            ) : undefined
          }
        />
        {rows.length === 0 ? (
          <EmptyState
            bare
            icon={search === '' ? undefined : <PackageSearch size={22} />}
            title={search === '' ? 'No active products yet' : 'Nothing matches that search'}
            description={
              search === ''
                ? 'Add products to your catalogue, then set their reseller prices here.'
                : 'Try a different name or SKU code.'
            }
            action={
              search === '' ? undefined : (
                <Button variant="secondary" size="md" onClick={() => setSearch('')}>
                  Reset search
                </Button>
              )
            }
          />
        ) : (
          <Table caption="Reseller prices">
            <THead>
              <Tr>
                <Th>Product</Th>
                <Th align="right">Available</Th>
                <Th align="right">
                  <GlossaryTerm
                    title="Transfer price"
                    description="What a reseller store pays you per unit, unless it has been given a price of its own."
                  >
                    Transfer price
                  </GlossaryTerm>
                </Th>
                <Th>Retail range</Th>
                <Th align="right">Suggested</Th>
                <Th align="right">Stores selling it</Th>
                <Th>Actions</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.variantId}>
                  <Td>
                    <RsProduct
                      thumb={<ProductThumb src={r.thumbnailUrl} size={36} alt={r.productName} />}
                      name={r.productName}
                      sku={r.skuCode}
                      extra={r.variantLabel ? ` · ${r.variantLabel}` : ''}
                    />
                  </Td>
                  <Td align="right">
                    <Num value={r.available} />
                  </Td>
                  <Td align="right">
                    {r.price === null ? (
                      <span className="rs-faint">—</span>
                    ) : (
                      // `convert={false}`: this is the figure a store is
                      // charged and the box below is typed in rupees.
                      <Money amount={r.price.transferPriceInr} convert={false} />
                    )}
                  </Td>
                  <Td className="rs-small">
                    {r.price === null ? (
                      <span className="rs-faint">—</span>
                    ) : (
                      <RetailRange p={r.price} />
                    )}
                  </Td>
                  <Td align="right">
                    {r.price?.suggestedRetailInr ? (
                      <Money amount={r.price.suggestedRetailInr} convert={false} />
                    ) : (
                      <span className="rs-faint">—</span>
                    )}
                  </Td>
                  <Td align="right">
                    <Num value={r.enabledInStores} />
                  </Td>
                  <Td>
                    <div className="rs-actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Pencil size={13} />}
                        onClick={() => setEditing(r)}
                      >
                        {r.price === null ? 'Set price' : 'Edit'}
                      </Button>
                      {r.price !== null ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Trash2 size={13} />}
                          onClick={() => setRemoving(r)}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </RsSection>

      {all.length > 0 && (
        <RsStrip>
          <RsStripFact
            label="Priced"
            value={`${priced} / ${all.length}`}
            tone={priced === 0 ? 'warn' : 'good'}
          />
          <RsStripFact label="In a store" value={inStores} />
          <RsStripFact label="Shown" value={`${rows.length} products`} />
        </RsStrip>
      )}

      {editing !== null ? <EditPriceModal row={editing} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={removing === null ? '' : `Remove the price of ${removing.skuCode}?`}
        entity={removing?.skuCode ?? ''}
        entityIsIdentifier
        consequence="Stores that sell it at your default price must be given their own first — we will tell you which."
        confirmLabel="Remove"
        closeOnSuccess={false}
        onConfirm={async () => {
          if (removing === null) return;
          try {
            await remove.mutateAsync({ variantId: removing.variantId });
            toast.success('Price removed.');
            setRemoving(null);
          } catch (err) {
            toast.error(serverVerdict(err));
          }
        }}
      />
    </div>
  );
}

function RetailRange({
  p,
}: {
  p: { minRetailInr: string | null; maxRetailInr: string | null };
}): ReactElement {
  if (p.minRetailInr === null && p.maxRetailInr === null) return <>Any</>;
  return (
    <span className="rs-nowrap">
      {p.minRetailInr === null ? 'up to ' : <Money amount={p.minRetailInr} convert={false} />}
      {p.minRetailInr !== null && p.maxRetailInr !== null ? ' – ' : null}
      {p.maxRetailInr === null ? ' or more' : <Money amount={p.maxRetailInr} convert={false} />}
    </span>
  );
}

function EditPriceModal({
  row,
  onClose,
}: {
  row: PriceListRow;
  onClose: () => void;
}): ReactElement {
  const toast = useToast();
  const save = useSetResellerDefaultPrice();
  const [draft, setDraft] = useState<PriceDraft>(draftFrom(row.price));
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      await save.mutateAsync({ variantId: row.variantId, body: priceBody(draft) });
      toast.success(`Saved the reseller price of ${row.skuCode}.`);
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Reseller price — ${row.productName}`}
      description={`${row.skuCode}. Stores with a price of their own are not affected.`}
      icon={<Tag size={18} />}
      footer={
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <AsyncButton
            type="submit"
            form="rs-price-form"
            variant="primary"
            size="md"
            state={pendingPhase(save.isPending)}
            labels={{ idle: 'Save price', busy: 'Saving…' }}
          />
        </DialogFooter>
      }
    >
      <form id="rs-price-form" onSubmit={submit} className="rs-form">
        <PriceFields idPrefix="default-price" value={draft} onChange={setDraft} />
        {error !== null ? <RsError>{error}</RsError> : null}
      </form>
    </Dialog>
  );
}
