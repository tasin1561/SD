'use client';

import { useMemo, useState, type ChangeEvent, type FormEvent, type ReactElement } from 'react';
import { PackageSearch, Pencil } from 'lucide-react';
import { useSellerIdentity } from '@skydrop/auth/client';
import { Money, Num, ProductThumb } from '@skydrop/ui/components';
import { Table, TBody, THead, Td, Th, TableToolbar, Tr } from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Switch } from '@skydrop/ui/app/switch';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { GlossaryTerm } from '@skydrop/ui/app/tooltip-card';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
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
import { RsError, RsLink, RsProduct, RsSection, pendingPhase } from '../../_components/rs-parts';

const REASON_WORDS: Record<NotSellableReason, string> = {
  NOT_ENABLED: 'Not sold here',
  NO_TRANSFER_PRICE: 'No price yet',
  VARIANT_NOT_RESELLABLE: 'Product archived',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * The three words a seller meets on this screen that mean something
 * precise here. The definitions restate RS-3 — they add no rule.
 */
const GLOSSARY = {
  transfer: {
    title: 'Transfer price',
    description:
      'What the store pays you per unit. A store with no price of its own pays the one on your price list.',
  },
  setAside: {
    title: 'Set aside',
    description:
      'Units kept for this store alone. When your stock falls below what you have set aside, the newest set-aside is reduced first.',
  },
  hidden: {
    title: 'Hidden share',
    description:
      'A share of the stock the store is not shown, from 0 to 90%, so it sees less than you hold.',
  },
} as const;

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
  storeName,
  final,
}: {
  storeId: string;
  storeName: string;
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

  if (terms.isPending) {
    return <SkeletonRows rows={5} cols={7} label="Loading the store’s catalogue" />;
  }
  if (terms.isError) {
    return <ErrorState message={serverVerdict(terms.error)} retry={() => void terms.refetch()} />;
  }
  const current =
    editing === null
      ? null
      : (terms.data.rows.find((r) => r.variantId === editing.variantId) ?? editing);

  return (
    <>
      <RsSection
        title="What this store sells"
        note="A price with no override comes from your price list."
        action={<RsLink href="/reseller-stores/price-list">Your price list</RsLink>}
        flush
      >
        <TableToolbar
          search={{
            value: search,
            onChange: setSearch,
            label: 'Search by product or SKU',
            placeholder: 'Product or SKU…',
          }}
          filters={
            <Switch
              checked={onlySold}
              onCheckedChange={setOnlySold}
              label="Only products sold here"
            />
          }
        />
        {rows.length === 0 ? (
          <EmptyState
            bare
            icon={terms.data.rows.length === 0 ? undefined : <PackageSearch size={22} />}
            title={terms.data.rows.length === 0 ? 'No active products yet' : 'Nothing matches'}
            description={
              terms.data.rows.length === 0
                ? 'Add products to your catalogue first; they appear here to turn on for the store.'
                : 'Try a different name or SKU code.'
            }
          />
        ) : (
          <Table caption="What this store sells">
            <THead>
              <Tr>
                <Th>Product</Th>
                <Th>Sold here</Th>
                <Th>
                  <GlossaryTerm {...GLOSSARY.transfer}>Transfer price</GlossaryTerm>
                </Th>
                <Th>Stock</Th>
                <Th align="right">Available (real)</Th>
                <Th align="right">Store sees</Th>
                <Th>Actions</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.variantId}>
                  <Td>
                    <RsProduct
                      thumb={<ProductThumb src={r.thumbnailUrl} size={36} alt={r.productName} />}
                      name={r.overlayTitle ?? r.productName}
                      sku={r.skuCode}
                      extra={r.variantLabel ? ` · ${r.variantLabel}` : ''}
                    />
                  </Td>
                  <Td>
                    <StatusChip
                      kind={r.sellable ? 'confirmed' : 'neutral'}
                      label={
                        r.sellable ? 'Yes' : REASON_WORDS[r.notSellableReason ?? 'NOT_ENABLED']
                      }
                      size="sm"
                    />
                  </Td>
                  <Td>
                    {r.effective === null ? (
                      '—'
                    ) : (
                      <span className="rs-nowrap">
                        <Money amount={r.effective.transferPriceInr} convert={false} />
                        <span className="rs-faint">
                          {r.priceSource === 'OVERRIDE' ? ' (own)' : ' (default)'}
                        </span>
                      </span>
                    )}
                  </Td>
                  <Td className="rs-small">
                    {r.stockMode === 'SET_ASIDE' ? `Set aside ${r.setAsideQty ?? 0}` : 'Shared'}
                    {r.hiddenPercent > 0 ? ` · ${r.hiddenPercent}% hidden` : ''}
                  </Td>
                  <Td align="right">
                    <Num value={r.realAvailable} />
                  </Td>
                  <Td align="right">
                    <Num value={r.visibleQty} />
                  </Td>
                  <Td>
                    {mayEdit ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Pencil size={13} />}
                        onClick={() => setEditing(r)}
                      >
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
      </RsSection>

      {terms.data.recentShrinks.length > 0 ? (
        <RsSection
          title="Set-asides we reduced"
          note="When stock fell below what you had set aside, the newest went first."
          flush
        >
          <Table caption="Set-asides we reduced">
            <THead>
              <Tr>
                <Th>When</Th>
                <Th>SKU</Th>
                <Th>
                  <GlossaryTerm {...GLOSSARY.setAside}>Set aside</GlossaryTerm>
                </Th>
                <Th align="right">On hand then</Th>
              </Tr>
            </THead>
            <TBody>
              {terms.data.recentShrinks.map((s) => (
                <Tr key={s.id}>
                  <Td className="rs-when sk-figure">{when(s.createdAt)}</Td>
                  <Td>
                    <span className="sk-ident">{s.skuCode ?? '—'}</span>
                  </Td>
                  <Td className="sk-figure">
                    {s.fromQty} → {s.toQty}
                  </Td>
                  <Td align="right">
                    <Num value={s.onHand} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </RsSection>
      ) : null}

      {current !== null ? (
        <EditTermsModal
          storeId={storeId}
          storeName={storeName}
          row={current}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function EditTermsModal({
  storeId,
  storeName,
  row,
  onClose,
}: {
  storeId: string;
  storeName: string;
  row: StoreTermsRow;
  onClose: () => void;
}): ReactElement {
  const toast = useToast();
  const save = useSaveResellerStoreTerms();
  const upload = useUploadResellerOverlayImage();
  const removeImage = useRemoveResellerOverlayImage();
  const [removingImageId, setRemovingImageId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(row.enabled);
  const [ownPrice, setOwnPrice] = useState(row.override !== null);
  const [price, setPrice] = useState<PriceDraft>(draftFrom(row.override ?? row.defaultPrice));
  const [stockMode, setStockMode] = useState<StockMode>(row.stockMode);
  const [setAside, setSetAside] = useState(String(row.setAsideQty ?? 0));
  const [hidden, setHidden] = useState(String(row.hiddenPercent));
  const [title, setTitle] = useState(row.overlayTitle ?? '');
  const [description, setDescription] = useState(row.overlayDescription ?? '');
  const [error, setError] = useState<string | null>(null);
  /**
   * The owner's rule: saving a product's terms for a store is confirmed
   * on a second screen that restates the store, the SKU and what the
   * store will now be offered — and only then does the SAME request fire.
   * The form's own button opens that screen; it never sends anything.
   */
  const [confirming, setConfirming] = useState(false);

  function review(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setError(null);
    setConfirming(true);
  }

  async function submit(): Promise<void> {
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
    } catch (err) {
      // SET_ASIDE_EXCEEDS_STOCK says how many are free (FE-2: verbatim).
      setError(serverVerdict(err));
      // Rethrown so the confirmation stays open with the verdict on it.
      throw err;
    }
    toast.success(`Saved ${row.skuCode} for this store.`);
    onClose();
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`${row.productName} — this store`}
      description={`${row.skuCode}. ${row.realAvailable} available now; ${row.freeToSetAside} could be set aside for this store.`}
      icon={<Pencil size={18} />}
      size="lg"
      footer={
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <AsyncButton
            type="submit"
            form="rs-terms-form"
            variant="primary"
            size="md"
            state={pendingPhase(save.isPending)}
            labels={{ idle: 'Save', busy: 'Saving…' }}
          />
        </DialogFooter>
      }
    >
      <form id="rs-terms-form" onSubmit={review} className="rs-form">
        <div className="rs-switches">
          <Switch checked={enabled} onCheckedChange={setEnabled} label="This store may sell it" />
          <Switch
            checked={ownPrice}
            onCheckedChange={setOwnPrice}
            label="Give this store its own price"
          />
        </div>
        {ownPrice ? (
          <PriceFields idPrefix="own-price" value={price} onChange={setPrice} />
        ) : (
          <p className="rs-muted">
            {row.defaultPrice === null
              ? 'This product has no default price yet — set one on your price list, or give this store its own.'
              : 'Uses your default price list.'}
          </p>
        )}

        <div className="rs-grid-3">
          <Select
            id="terms-mode"
            label="Stock"
            value={stockMode}
            onChange={(e) => setStockMode(e.target.value as StockMode)}
          >
            <option value="SHARED">Shared with your other stores</option>
            <option value="SET_ASIDE">A set-aside for this store</option>
          </Select>
          {stockMode === 'SET_ASIDE' ? (
            <TextField
              id="terms-qty"
              label="Units set aside"
              hint={`${row.freeToSetAside} free right now.`}
              inputMode="numeric"
              inputClassName="sk-figure"
              value={setAside}
              onChange={(e) => setSetAside(e.target.value)}
            />
          ) : null}
          <TextField
            id="terms-hidden"
            label="Hidden share (%)"
            hint="0 to 90."
            inputMode="numeric"
            inputClassName="sk-figure"
            value={hidden}
            onChange={(e) => setHidden(e.target.value)}
          />
        </div>
        <p className="rs-faint">
          <GlossaryTerm {...GLOSSARY.setAside}>Set aside</GlossaryTerm> and{' '}
          <GlossaryTerm {...GLOSSARY.hidden}>hidden share</GlossaryTerm> decide what the store is
          shown.
        </p>

        <TextField
          id="terms-title"
          label="What the store calls it"
          hint="Blank uses your product name."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <TextArea
          id="terms-desc"
          label="Description for the store"
          hint="Blank uses your product description."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <div className="rs-stack rs-stack--tight">
          <p className="rs-body">
            Pictures for this store (up to 5; none uses your product picture)
          </p>
          {row.overlayImages.length > 0 ? (
            <div className="rs-pictures">
              {row.overlayImages.map((img) => (
                <div key={img.id} className="rs-picture">
                  <ProductThumb src={img.url} size={56} alt={row.productName} />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={removeImage.isPending}
                    onClick={() => setRemovingImageId(img.id)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          <ConfirmDialog
            open={removingImageId !== null}
            onOpenChange={(o) => {
              if (!o) setRemovingImageId(null);
            }}
            title="Remove this picture?"
            entity={`${row.productName} · ${row.skuCode}`}
            consequence="The store stops showing it straight away. You can add it again later."
            confirmLabel="Remove the picture"
            destructive
            closeOnSuccess={false}
            onConfirm={async () => {
              if (removingImageId === null) return;
              try {
                await removeImage.mutateAsync({
                  storeId,
                  variantId: row.variantId,
                  imageId: removingImageId,
                });
                toast.success('Picture removed.');
              } catch (err) {
                toast.error(serverVerdict(err));
              }
              setRemovingImageId(null);
            }}
          />
          {/* A file picker stays a real file input — the text field
              primitive draws a text box and would be wrong here. */}
          <div className="rs-file">
            <label className="rs-file__label" htmlFor="terms-picture">
              Add a picture
            </label>
            <input
              id="terms-picture"
              className="rs-file__input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={upload.isPending}
              aria-describedby="terms-picture-hint"
              onChange={addPicture}
            />
            <span id="terms-picture-hint" className="rs-file__hint">
              JPG, PNG or WebP, at most 2 MB.
            </span>
          </div>
        </div>

        {error !== null && !confirming ? <RsError>{error}</RsError> : null}
      </form>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Save these terms for the store?"
        entity={storeName}
        consequence="The store sees the new terms straight away. Orders it has already placed keep the terms they were placed under."
        confirmLabel="Save"
        cancelLabel="Back"
        onConfirm={submit}
        error={error}
      >
        <ul className="rs-confirm-list">
          <li>
            <b>Product:</b> {row.productName} · <span className="sk-ident">{row.skuCode}</span>
          </li>
          <li>
            <b>This store may sell it:</b> {enabled ? 'Yes' : 'No'}
          </li>
          <li>
            <b>Price:</b>{' '}
            {ownPrice ? (
              <>
                its own —{' '}
                {price.transferPriceInr.trim() === '' ||
                !Number.isFinite(Number(price.transferPriceInr.trim())) ? (
                  price.transferPriceInr.trim()
                ) : (
                  <Money amount={price.transferPriceInr.trim()} convert={false} />
                )}{' '}
                a unit
              </>
            ) : (
              'your default price list'
            )}
          </li>
          <li>
            <b>Stock:</b>{' '}
            {stockMode === 'SET_ASIDE'
              ? `A set-aside for this store (${setAside.trim()})`
              : 'Shared with your other stores'}
            {' · '}
            {hidden.trim()}% hidden
          </li>
        </ul>
      </ConfirmDialog>
    </Dialog>
  );
}
