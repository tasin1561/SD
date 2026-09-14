'use client';

import Link from 'next/link';
import { useMemo, useState, type ChangeEvent, type FormEvent, type ReactElement } from 'react';
import { useSellerIdentity } from '@skydrop/auth/client';
import {
  Button,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  Money,
  Num,
  ProductThumb,
  Section,
  Select,
  Switch,
  TBody,
  THead,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useRemoveResellerOverlayImage,
  useResellerStoreTerms,
  useSaveResellerStoreTerms,
  useUploadResellerOverlayImage,
  type NotSellableReason,
  type StockMode,
  type StoreTermsRow,
} from '@/lib/reseller-catalogue-hooks';
import { PriceFields, draftFrom, priceBody, type PriceDraft } from '../../_components/price-fields';

const REASON_WORDS: Record<NotSellableReason, string> = {
  NOT_ENABLED: 'Not sold here',
  NO_TRANSFER_PRICE: 'No price yet',
  VARIANT_NOT_RESELLABLE: 'Product archived',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * RS-3 — one store's catalogue terms: which products it sells, at what
 * price, how its stock is decided, and what it calls them. Shows REAL
 * availability beside what the store will SEE, computed by the server
 * with the same arithmetic the store's own page uses.
 *
 * The page is open under `stores.manage`; changing anything needs
 * `stores.pricing`, gated here cosmetically (FE-2 — the API refuses
 * regardless) so the edit button is not offered to somebody it would
 * refuse.
 */
export function StoreCatalogue({
  storeId,
  final,
}: {
  storeId: string;
  final: boolean;
}): ReactElement {
  const identity = useSellerIdentity();
  const mayEdit = can(identity, 'stores.pricing') && !final;
  const terms = useResellerStoreTerms(storeId);
  const [search, setSearch] = useState('');
  const [onlySold, setOnlySold] = useState(false);
  const [editing, setEditing] = useState<StoreTermsRow | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (terms.data?.rows ?? []).filter(
      (r) =>
        (!onlySold || r.enabled) &&
        (q === '' ||
          r.skuCode.toLowerCase().includes(q) ||
          r.productName.toLowerCase().includes(q)),
    );
  }, [terms.data, search, onlySold]);

  if (terms.isPending) return <LoadingState label="Loading the store’s catalogue" rows={5} />;
  if (terms.isError) {
    return <ErrorState message={serverVerdict(terms.error)} retry={() => void terms.refetch()} />;
  }
  const current =
    editing === null
      ? null
      : (terms.data.rows.find((r) => r.variantId === editing.variantId) ?? editing);

  return (
    <div className="space-y-6">
      <Section
        title="What this store sells"
        subtitle="Turn products on for this store, give it its own price, and decide how much stock it is shown. Prices without an override come from your price list."
        action={
          <Link
            href="/reseller-stores/price-list"
            className="text-accent hover:text-accent-hover text-sm"
          >
            Your price list →
          </Link>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Input
            aria-label="Search by product or SKU"
            placeholder="Search product or SKU"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Switch checked={onlySold} onChange={setOnlySold} label="Only products sold here" />
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title={terms.data.rows.length === 0 ? 'No active products yet' : 'Nothing matches'}
            description={
              terms.data.rows.length === 0
                ? 'Add products to your catalogue first; they appear here to turn on for the store.'
                : undefined
            }
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Product</Th>
                <Th>Sold here</Th>
                <Th>Transfer price</Th>
                <Th>Stock</Th>
                <Th>Available (real)</Th>
                <Th>Store sees</Th>
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
                        <div>{r.overlayTitle ?? r.productName}</div>
                        <div className="text-text-muted text-xs">
                          {r.skuCode}
                          {r.variantLabel ? ` · ${r.variantLabel}` : ''}
                        </div>
                      </div>
                    </div>
                  </Td>
                  <Td>{r.sellable ? 'Yes' : REASON_WORDS[r.notSellableReason ?? 'NOT_ENABLED']}</Td>
                  <Td>
                    {r.effective === null ? (
                      '—'
                    ) : (
                      <span className="whitespace-nowrap">
                        <Money amount={r.effective.transferPriceInr} convert={false} />
                        <span className="text-text-muted text-xs">
                          {r.priceSource === 'OVERRIDE' ? ' (own)' : ' (default)'}
                        </span>
                      </span>
                    )}
                  </Td>
                  <Td>
                    {r.stockMode === 'SET_ASIDE' ? `Set aside ${r.setAsideQty ?? 0}` : 'Shared'}
                    {r.hiddenPercent > 0 ? ` · ${r.hiddenPercent}% hidden` : ''}
                  </Td>
                  <Td>
                    <Num value={r.realAvailable} />
                  </Td>
                  <Td>
                    <Num value={r.visibleQty} />
                  </Td>
                  <Td>
                    {mayEdit ? (
                      <Button variant="secondary" size="sm" onClick={() => setEditing(r)}>
                        Edit
                      </Button>
                    ) : (
                      '—'
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      {terms.data.recentShrinks.length > 0 ? (
        <Section
          title="Set-asides we reduced"
          subtitle="When stock fell below what you had set aside for your stores, the newest set-asides were reduced first."
        >
          <Table>
            <THead>
              <Tr>
                <Th>When</Th>
                <Th>SKU</Th>
                <Th>Set aside</Th>
                <Th>On hand then</Th>
              </Tr>
            </THead>
            <TBody>
              {terms.data.recentShrinks.map((s) => (
                <Tr key={s.id}>
                  <Td>{when(s.createdAt)}</Td>
                  <Td>{s.skuCode ?? '—'}</Td>
                  <Td>
                    {s.fromQty} → {s.toQty}
                  </Td>
                  <Td>
                    <Num value={s.onHand} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Section>
      ) : null}

      {current !== null ? (
        <EditTermsModal storeId={storeId} row={current} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function EditTermsModal({
  storeId,
  row,
  onClose,
}: {
  storeId: string;
  row: StoreTermsRow;
  onClose: () => void;
}): ReactElement {
  const toast = useToast();
  const save = useSaveResellerStoreTerms();
  const upload = useUploadResellerOverlayImage();
  const removeImage = useRemoveResellerOverlayImage();
  const [enabled, setEnabled] = useState(row.enabled);
  const [ownPrice, setOwnPrice] = useState(row.override !== null);
  const [price, setPrice] = useState<PriceDraft>(draftFrom(row.override ?? row.defaultPrice));
  const [stockMode, setStockMode] = useState<StockMode>(row.stockMode);
  const [setAside, setSetAside] = useState(String(row.setAsideQty ?? 0));
  const [hidden, setHidden] = useState(String(row.hiddenPercent));
  const [title, setTitle] = useState(row.overlayTitle ?? '');
  const [description, setDescription] = useState(row.overlayDescription ?? '');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      await save.mutateAsync({
        storeId,
        variantId: row.variantId,
        body: {
          enabled,
          priceOverride: ownPrice ? priceBody(price) : null,
          stockMode,
          setAsideQty: stockMode === 'SET_ASIDE' ? Number(setAside) : null,
          hiddenPercent: Number(hidden),
          overlayTitle: title.trim() === '' ? null : title.trim(),
          overlayDescription: description.trim() === '' ? null : description.trim(),
        },
      });
      toast.success(`Saved ${row.skuCode} for this store.`);
      onClose();
    } catch (err) {
      // SET_ASIDE_EXCEEDS_STOCK says how many are free (FE-2: verbatim).
      setError(serverVerdict(err));
    }
  }

  function addPicture(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file === undefined) return;
    upload.mutate(
      { storeId, variantId: row.variantId, file },
      {
        onSuccess: () => toast.success('Picture added.'),
        onError: (err) => toast.error(serverVerdict(err)),
      },
    );
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`${row.productName} — this store`}
      description={`${row.skuCode}. ${row.realAvailable} available now; ${row.freeToSetAside} could be set aside for this store.`}
    >
      <form onSubmit={submit} className="space-y-4">
        <Switch checked={enabled} onChange={setEnabled} label="This store may sell it" />

        <Switch checked={ownPrice} onChange={setOwnPrice} label="Give this store its own price" />
        {ownPrice ? (
          <PriceFields idPrefix="own-price" value={price} onChange={setPrice} />
        ) : (
          <p className="text-text-muted text-sm">
            {row.defaultPrice === null
              ? 'This product has no default price yet — set one on your price list, or give this store its own.'
              : 'Uses your default price list.'}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Stock" htmlFor="terms-mode">
            <Select
              id="terms-mode"
              value={stockMode}
              onChange={(e) => setStockMode(e.target.value as StockMode)}
            >
              <option value="SHARED">Shared with your other stores</option>
              <option value="SET_ASIDE">A set-aside for this store</option>
            </Select>
          </FormField>
          {stockMode === 'SET_ASIDE' ? (
            <FormField
              label="Units set aside"
              htmlFor="terms-qty"
              hint={`${row.freeToSetAside} free right now.`}
            >
              <Input
                id="terms-qty"
                inputMode="numeric"
                value={setAside}
                onChange={(e) => setSetAside(e.target.value)}
              />
            </FormField>
          ) : null}
          <FormField label="Hidden share (%)" htmlFor="terms-hidden" hint="0 to 90.">
            <Input
              id="terms-hidden"
              inputMode="numeric"
              value={hidden}
              onChange={(e) => setHidden(e.target.value)}
            />
          </FormField>
        </div>

        <FormField
          label="What the store calls it"
          htmlFor="terms-title"
          hint="Blank uses your product name."
        >
          <Input id="terms-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </FormField>
        <FormField
          label="Description for the store"
          htmlFor="terms-desc"
          hint="Blank uses your product description."
        >
          <Textarea
            id="terms-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>

        <div className="space-y-2">
          <p className="text-sm">
            Pictures for this store (up to 5; none uses your product picture)
          </p>
          <div className="flex flex-wrap gap-3">
            {row.overlayImages.map((img) => (
              <div key={img.id} className="flex flex-col items-center gap-1">
                <ProductThumb src={img.url} size={56} alt={row.productName} />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={removeImage.isPending}
                  onClick={() =>
                    removeImage.mutate(
                      { storeId, variantId: row.variantId, imageId: img.id },
                      { onError: (err) => toast.error(serverVerdict(err)) },
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
          <FormField
            label="Add a picture"
            htmlFor="terms-picture"
            hint="JPG, PNG or WebP, at most 2 MB."
          >
            <Input
              id="terms-picture"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={upload.isPending}
              onChange={addPicture}
            />
          </FormField>
        </div>

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
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
