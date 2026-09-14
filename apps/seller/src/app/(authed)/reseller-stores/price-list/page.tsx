'use client';

import Link from 'next/link';
import { useMemo, useState, type FormEvent, type ReactElement } from 'react';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  Money,
  Num,
  PageHeader,
  ProductThumb,
  Section,
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
 */
export default function ResellerPriceListPage(): ReactElement {
  const list = useResellerPriceList();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<PriceListRow | null>(null);
  const [removing, setRemoving] = useState<PriceListRow | null>(null);
  const toast = useToast();
  const remove = useRemoveResellerDefaultPrice();

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = list.data?.rows ?? [];
    if (q === '') return all;
    return all.filter(
      (r) => r.skuCode.toLowerCase().includes(q) || r.productName.toLowerCase().includes(q),
    );
  }, [list.data, search]);

  const header = (
    <>
      <div>
        <Link href="/reseller-stores" className="text-accent hover:text-accent-hover text-sm">
          ← Reseller stores
        </Link>
      </div>
      <PageHeader
        title="Reseller price list"
        subtitle="Your default price to every reseller store, and the range it may sell at. A store can be given its own price on its page."
      />
    </>
  );

  if (list.isPending) {
    return (
      <div className="space-y-6">
        {header}
        <LoadingState label="Loading your products" rows={6} />
      </div>
    );
  }
  if (list.isError) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <Section
        title="Products"
        subtitle={
          list.data.truncated
            ? 'Showing your first 2,000 active products.'
            : 'Every active product you could give a reseller store.'
        }
        action={
          <Input
            aria-label="Search by product or SKU"
            placeholder="Search product or SKU"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            title={search === '' ? 'No active products yet' : 'Nothing matches that search'}
            description={
              search === ''
                ? 'Add products to your catalogue, then set their reseller prices here.'
                : undefined
            }
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Product</Th>
                <Th>Available</Th>
                <Th>Transfer price</Th>
                <Th>Retail range</Th>
                <Th>Suggested</Th>
                <Th>Stores selling it</Th>
                <Th>Actions</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.variantId}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <ProductThumb src={r.thumbnailUrl} size={36} alt={r.productName} />
                      <div>
                        <div>{r.productName}</div>
                        <div className="text-text-muted text-xs">
                          {r.skuCode}
                          {r.variantLabel ? ` · ${r.variantLabel}` : ''}
                        </div>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <Num value={r.available} />
                  </Td>
                  <Td>
                    {r.price === null ? (
                      '—'
                    ) : (
                      <Money amount={r.price.transferPriceInr} convert={false} />
                    )}
                  </Td>
                  <Td>{r.price === null ? '—' : <RetailRange p={r.price} />}</Td>
                  <Td>
                    {r.price?.suggestedRetailInr ? (
                      <Money amount={r.price.suggestedRetailInr} convert={false} />
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>
                    <Num value={r.enabledInStores} />
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setEditing(r)}>
                        {r.price === null ? 'Set price' : 'Edit'}
                      </Button>
                      {r.price !== null ? (
                        <Button variant="secondary" size="sm" onClick={() => setRemoving(r)}>
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
      </Section>

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
