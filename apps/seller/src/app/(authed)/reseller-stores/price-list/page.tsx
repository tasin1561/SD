'use client';

import Link from 'next/link';
import { useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { ArrowLeft, Boxes, Store, Tag } from 'lucide-react';
import {
  BandBody,
  Button,
  ConfirmDialog,
  Crumbs,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  MetaChip,
  Modal,
  ModalFooter,
  Money,
  Num,
  PageHeader,
  ProductThumb,
  SectionBand,
  Stat,
  StripFact,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useRemoveResellerDefaultPrice,
  useResellerPriceList,
  useSetResellerDefaultPrice,
  type PriceListRow,
} from '@/lib/reseller-catalogue-hooks';
import { PriceFields, draftFrom, priceBody, type PriceDraft } from '../_components/price-fields';

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
    <>
      <Link
        href="/reseller-stores"
        className="text-text-muted hover:text-text-bright mb-3 inline-flex items-center gap-1.5 text-xs"
      >
        <ArrowLeft size={13} aria-hidden />
        Reseller stores
      </Link>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[{ label: 'Seller console' }, { label: 'Reselling' }, { label: 'Price list' }]}
            Link={Link}
          />
        }
        title="Reseller price list"
        subtitle="Your default price to every reseller store, and the range it may sell at. A store can be given its own price on its page."
        meta={
          list.data === undefined ? undefined : (
            <>
              <MetaChip tone={priced > 0 ? 'accent' : 'warn'}>
                {priced} of {all.length} priced
              </MetaChip>
              {list.data.truncated && <MetaChip tone="warn">First 2,000 products</MetaChip>}
            </>
          )
        }
      />
    </>
  );

  if (list.isPending) {
    return (
      <div>
        {header}
        <LoadingState label="Loading your products" rows={6} />
      </div>
    );
  }
  if (list.isError) {
    return (
      <div>
        {header}
        <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      </div>
    );
  }

  return (
    <div>
      {header}

      {/* ── What is on offer to your stores ─────────────────────────
             Three tiles, counted off the list below. No margin and no
             sales figures: neither is on this endpoint, and both would
             have to be invented — see the header comment. */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Priced for resale"
          icon={<Tag size={13} aria-hidden />}
          value={priced}
          unit={`of ${all.length}`}
          tone={priced === 0 ? 'warn' : 'neutral'}
          hint="A product with no price here cannot be sold by a store on your default terms."
        />
        <Stat
          label="Being sold by a store"
          icon={<Store size={13} aria-hidden />}
          value={inStores}
          unit={inStores === 1 ? 'product' : 'products'}
          tone="neutral"
          hint="Switched on for at least one of your reseller stores."
        />
        <Stat
          label="Units available"
          icon={<Boxes size={13} aria-hidden />}
          value={<Num value={available} />}
          unit="units"
          tone="neutral"
          hint="Sellable stock across the products listed."
        />
      </div>

      <SectionBand
        index="01"
        title="Products"
        note={
          list.data.truncated
            ? 'Your first 2,000 active products.'
            : `${rows.length} ${rows.length === 1 ? 'product' : 'products'}`
        }
        action={
          <>
            <Input
              aria-label="Search by product or SKU"
              placeholder="Product or SKU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-64"
            />
            {search !== '' && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="text-text-faint hover:text-text-body px-1 text-xs transition-colors"
              >
                Reset
              </button>
            )}
          </>
        }
      />
      <BandBody flush>
        {rows.length === 0 ? (
          <EmptyState
            bare
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
          <Table>
            <THead>
              <Tr>
                <Th>Product</Th>
                <Th align="right">Available</Th>
                <Th align="right">Transfer price</Th>
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
                    <div className="flex items-center gap-3">
                      <ProductThumb src={r.thumbnailUrl} size={36} alt={r.productName} />
                      <div className="min-w-0">
                        <div className="text-text-bright truncate font-medium">{r.productName}</div>
                        <div className="text-text-faint truncate font-mono text-xs">
                          {r.skuCode}
                          {r.variantLabel ? ` · ${r.variantLabel}` : ''}
                        </div>
                      </div>
                    </div>
                  </Td>
                  <Td align="right">
                    <Num value={r.available} />
                  </Td>
                  <Td align="right">
                    {r.price === null ? (
                      <span className="text-text-faint">—</span>
                    ) : (
                      // `convert={false}`: this is the figure a store is
                      // charged and the box below is typed in rupees.
                      <Money amount={r.price.transferPriceInr} convert={false} />
                    )}
                  </Td>
                  <Td className="text-xs">
                    {r.price === null ? (
                      <span className="text-text-faint">—</span>
                    ) : (
                      <RetailRange p={r.price} />
                    )}
                  </Td>
                  <Td align="right">
                    {r.price?.suggestedRetailInr ? (
                      <Money amount={r.price.suggestedRetailInr} convert={false} />
                    ) : (
                      <span className="text-text-faint">—</span>
                    )}
                  </Td>
                  <Td align="right">
                    <Num value={r.enabledInStores} />
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setEditing(r)}>
                        {r.price === null ? 'Set price' : 'Edit'}
                      </Button>
                      {r.price !== null ? (
                        <Button variant="ghost" size="sm" onClick={() => setRemoving(r)}>
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
      </BandBody>

      {all.length > 0 && (
        <div className="text-text-faint border-border mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3 font-mono text-[11px]">
          <StripFact
            label="Priced"
            value={`${priced} / ${all.length}`}
            tone={priced === 0 ? 'warn' : 'good'}
          />
          <StripFact label="In a store" value={inStores} />
          <StripFact label="Shown" value={`${rows.length} products`} />
        </div>
      )}

      {editing !== null ? <EditPriceModal row={editing} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={removing === null ? '' : `Remove the price of ${removing.skuCode}?`}
        description="Stores that sell it at your default price must be given their own first — we will tell you which."
        confirmLabel="Remove"
        disabled={remove.isPending}
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
    <span className="whitespace-nowrap">
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
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Reseller price — ${row.productName}`}
      description={`${row.skuCode}. Stores with a price of their own are not affected.`}
    >
      <form onSubmit={submit} className="space-y-4">
        <PriceFields idPrefix="default-price" value={draft} onChange={setDraft} />
        {error !== null ? (
          <p role="alert" className="text-critical text-sm">
            {error}
          </p>
        ) : null}
        <ModalFooter>
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save price'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
