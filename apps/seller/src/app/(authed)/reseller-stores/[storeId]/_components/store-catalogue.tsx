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
import { verdict } from '@/i18n/verdict';
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
import { useT, useLocale } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';
import { dateTag } from '@/i18n/format';
import type { Locale } from '@skydrop/ui/app/i18n';

const reasonWordsOf = (t: Translate<MessageKey>): Record<NotSellableReason, string> => ({
  NOT_ENABLED: t('resellerStoreDetail.notSoldHere'),
  NO_TRANSFER_PRICE: t('resellerStoreDetail.noPriceYet'),
  VARIANT_NOT_RESELLABLE: t('resellerStoreDetail.productArchived'),
});

function when(iso: string, locale: Locale = 'en'): string {
  return new Date(iso).toLocaleString(dateTag(locale, 'en-IN'), {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * The three words a seller meets on this screen that mean something
 * precise here. The definitions restate RS-3 — they add no rule.
 */
const glossaryOf = (t: Translate<MessageKey>) =>
  ({
    transfer: {
      title: t('resellerStoreDetail.transferPrice'),
      description: t('resellerStoreDetail.whatTheStorePays'),
    },
    setAside: {
      title: t('resellerStoreDetail.setAside2'),
      description: t('resellerStoreDetail.unitsKeptForThis'),
    },
    hidden: {
      title: t('resellerStoreDetail.hiddenShare3'),
      description: t('resellerStoreDetail.aShareOfThe'),
    },
  }) as const;

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
  const locale = useLocale();
  const t = useT();
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
    return <SkeletonRows rows={5} cols={7} label={t('resellerStoreDetail.loadingTheStoreS')} />;
  }
  if (terms.isError) {
    return <ErrorState message={verdict(terms.error, t)} retry={() => void terms.refetch()} />;
  }
  const current =
    editing === null
      ? null
      : (terms.data.rows.find((r) => r.variantId === editing.variantId) ?? editing);

  return (
    <>
      <RsSection
        title={t('resellerStoreDetail.whatThisStoreSells')}
        note={t('resellerStoreDetail.aPriceWithNo')}
        action={
          <RsLink href="/reseller-stores/price-list">
            {t('resellerStoreDetail.yourPriceList')}
          </RsLink>
        }
        flush
      >
        <TableToolbar
          search={{
            value: search,
            onChange: setSearch,
            label: t('resellerStoreDetail.searchByProductOr'),
            placeholder: t('resellerStoreDetail.productOrSku'),
          }}
          filters={
            <Switch
              checked={onlySold}
              onCheckedChange={setOnlySold}
              label={t('resellerStoreDetail.onlyProductsSoldHere')}
            />
          }
        />
        {rows.length === 0 ? (
          <EmptyState
            bare
            icon={terms.data.rows.length === 0 ? undefined : <PackageSearch size={22} />}
            title={
              terms.data.rows.length === 0
                ? t('resellerStoreDetail.noActiveProductsYet')
                : t('resellerStoreDetail.nothingMatches')
            }
            description={
              terms.data.rows.length === 0
                ? t('resellerStoreDetail.addProductsToYour')
                : t('resellerStoreDetail.tryADifferentName')
            }
          />
        ) : (
          <Table caption={t('resellerStoreDetail.whatThisStoreSells')}>
            <THead>
              <Tr>
                <Th>{t('resellerStoreDetail.product')}</Th>
                <Th>{t('resellerStoreDetail.soldHere')}</Th>
                <Th>
                  <GlossaryTerm {...glossaryOf(t).transfer}>
                    {t('resellerStoreDetail.transferPrice')}
                  </GlossaryTerm>
                </Th>
                <Th>{t('resellerStoreDetail.stock')}</Th>
                <Th align="right">{t('resellerStoreDetail.availableReal')}</Th>
                <Th align="right">{t('resellerStoreDetail.storeSees')}</Th>
                <Th>{t('resellerStoreDetail.actions')}</Th>
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
                        r.sellable
                          ? t('resellerStoreDetail.yes')
                          : reasonWordsOf(t)[r.notSellableReason ?? 'NOT_ENABLED']
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
                    {r.stockMode === 'SET_ASIDE'
                      ? t('resellerStoreDetail.setAside', { setAsideQty: r.setAsideQty ?? 0 })
                      : t('resellerStoreDetail.shared')}
                    {r.hiddenPercent > 0
                      ? t('resellerStoreDetail.hidden', { hiddenPercent: r.hiddenPercent })
                      : ''}
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
                        {t('resellerStoreDetail.edit')}
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
          title={t('resellerStoreDetail.setAsidesWeReduced')}
          note={t('resellerStoreDetail.whenStockFellBelow')}
          flush
        >
          <Table caption={t('resellerStoreDetail.setAsidesWeReduced')}>
            <THead>
              <Tr>
                <Th>{t('resellerStoreDetail.when')}</Th>
                <Th>{t('resellerStoreDetail.sku')}</Th>
                <Th>
                  <GlossaryTerm {...glossaryOf(t).setAside}>
                    {t('resellerStoreDetail.setAside2')}
                  </GlossaryTerm>
                </Th>
                <Th align="right">{t('resellerStoreDetail.onHandThen')}</Th>
              </Tr>
            </THead>
            <TBody>
              {terms.data.recentShrinks.map((s) => (
                <Tr key={s.id}>
                  <Td className="rs-when sk-figure">{when(s.createdAt, locale)}</Td>
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
  const t = useT();
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
      setError(verdict(err, t));
      // Rethrown so the confirmation stays open with the verdict on it.
      throw err;
    }
    toast.success(t('resellerStoreDetail.savedForThisStore', { skuCode: row.skuCode }));
    onClose();
  }

  function addPicture(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file === undefined) return;
    upload.mutate(
      { storeId, variantId: row.variantId, file },
      {
        onSuccess: () => toast.success(t('resellerStoreDetail.pictureAdded')),
        onError: (err) => toast.error(verdict(err, t)),
      },
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('resellerStoreDetail.thisStore', { productName: row.productName })}
      description={t('resellerStoreDetail.availableNowCouldBe', {
        skuCode: row.skuCode,
        realAvailable: row.realAvailable,
        freeToSetAside: row.freeToSetAside,
      })}
      icon={<Pencil size={18} />}
      size="lg"
      footer={
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={onClose}>
            {t('resellerStoreDetail.cancel')}
          </Button>
          <AsyncButton
            type="submit"
            form="rs-terms-form"
            variant="primary"
            size="md"
            state={pendingPhase(save.isPending)}
            labels={{ idle: t('resellerStoreDetail.save'), busy: t('resellerStoreDetail.saving') }}
          />
        </DialogFooter>
      }
    >
      <form id="rs-terms-form" onSubmit={review} className="rs-form">
        <div className="rs-switches">
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            label={t('resellerStoreDetail.thisStoreMaySell')}
          />
          <Switch
            checked={ownPrice}
            onCheckedChange={setOwnPrice}
            label={t('resellerStoreDetail.giveThisStoreIts')}
          />
        </div>
        {ownPrice ? (
          <PriceFields idPrefix="own-price" value={price} onChange={setPrice} />
        ) : (
          <p className="rs-muted">
            {row.defaultPrice === null
              ? t('resellerStoreDetail.thisProductHasNo')
              : t('resellerStoreDetail.usesYourDefaultPrice')}
          </p>
        )}

        <div className="rs-grid-3">
          <Select
            id="terms-mode"
            label={t('resellerStoreDetail.stock')}
            value={stockMode}
            onChange={(e) => setStockMode(e.target.value as StockMode)}
          >
            <option value="SHARED">{t('resellerStoreDetail.sharedWithYourOther')}</option>
            <option value="SET_ASIDE">{t('resellerStoreDetail.aSetAsideFor')}</option>
          </Select>
          {stockMode === 'SET_ASIDE' ? (
            <TextField
              id="terms-qty"
              label={t('resellerStoreDetail.unitsSetAside')}
              hint={t('resellerStoreDetail.freeRightNow', { freeToSetAside: row.freeToSetAside })}
              inputMode="numeric"
              inputClassName="sk-figure"
              value={setAside}
              onChange={(e) => setSetAside(e.target.value)}
            />
          ) : null}
          <TextField
            id="terms-hidden"
            label={t('resellerStoreDetail.hiddenShare')}
            hint={t('resellerStoreDetail.0To90')}
            inputMode="numeric"
            inputClassName="sk-figure"
            value={hidden}
            onChange={(e) => setHidden(e.target.value)}
          />
        </div>
        <p className="rs-faint">
          <GlossaryTerm {...glossaryOf(t).setAside}>
            {t('resellerStoreDetail.setAside2')}
          </GlossaryTerm>{' '}
          and{' '}
          <GlossaryTerm {...glossaryOf(t).hidden}>
            {t('resellerStoreDetail.hiddenShare2')}
          </GlossaryTerm>{' '}
          {t('resellerStoreDetail.decideWhatTheStore')}
        </p>

        <TextField
          id="terms-title"
          label={t('resellerStoreDetail.whatTheStoreCalls')}
          hint={t('resellerStoreDetail.blankUsesYourProduct')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <TextArea
          id="terms-desc"
          label={t('resellerStoreDetail.descriptionForTheStore')}
          hint={t('resellerStoreDetail.blankUsesYourProduct2')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <div className="rs-stack rs-stack--tight">
          <p className="rs-body">{t('resellerStoreDetail.picturesForThisStore')}</p>
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
                    {t('resellerStoreDetail.remove')}
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
            title={t('resellerStoreDetail.removeThisPicture')}
            entity={`${row.productName} · ${row.skuCode}`}
            consequence={t('resellerStoreDetail.theStoreStopsShowing')}
            confirmLabel={t('resellerStoreDetail.removeThePicture')}
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
                toast.success(t('resellerStoreDetail.pictureRemoved'));
              } catch (err) {
                toast.error(verdict(err, t));
              }
              setRemovingImageId(null);
            }}
          />
          {/* A file picker stays a real file input — the text field
              primitive draws a text box and would be wrong here. */}
          <div className="rs-file">
            <label className="rs-file__label" htmlFor="terms-picture">
              {t('resellerStoreDetail.addAPicture')}
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
              {t('resellerStoreDetail.jpgPngOrWebp')}
            </span>
          </div>
        </div>

        {error !== null && !confirming ? <RsError>{error}</RsError> : null}
      </form>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('resellerStoreDetail.saveTheseTermsFor')}
        entity={storeName}
        consequence={t('resellerStoreDetail.theStoreSeesThe')}
        confirmLabel={t('resellerStoreDetail.save')}
        cancelLabel={t('resellerStoreDetail.back')}
        onConfirm={submit}
        error={error}
      >
        <ul className="rs-confirm-list">
          <li>
            <b>{t('resellerStoreDetail.product2')}</b> {row.productName} ·{' '}
            <span className="sk-ident">{row.skuCode}</span>
          </li>
          <li>
            <b>{t('resellerStoreDetail.thisStoreMaySell2')}</b>{' '}
            {enabled ? t('resellerStoreDetail.yes') : t('resellerStoreDetail.no')}
          </li>
          <li>
            <b>{t('resellerStoreDetail.price')}</b>{' '}
            {ownPrice ? (
              <>
                {richMessage(t('resellerStoreDetail.itsOwnAUnit'), {
                  convert:
                    price.transferPriceInr.trim() === '' ||
                    !Number.isFinite(Number(price.transferPriceInr.trim())) ? (
                      price.transferPriceInr.trim()
                    ) : (
                      <Money amount={price.transferPriceInr.trim()} convert={false} />
                    ),
                })}
              </>
            ) : (
              t('resellerStoreDetail.yourDefaultPriceList')
            )}
          </li>
          <li>
            <b>{t('resellerStoreDetail.stock2')}</b>{' '}
            {stockMode === 'SET_ASIDE'
              ? t('resellerStoreDetail.aSetAsideFor2', { setAside: setAside.trim() })
              : t('resellerStoreDetail.sharedWithYourOther')}
            {' · '}
            {t('resellerStoreDetail.percentHidden', { hidden: hidden.trim() })}
          </li>
        </ul>
      </ConfirmDialog>
    </Dialog>
  );
}
