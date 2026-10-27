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
import { verdict } from '@/i18n/verdict';
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
import { useT } from '@/i18n/client';

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
  const t = useT();
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
      <RsBack href="/reseller-stores">{t('resellerPriceList.memberStores')}</RsBack>
      <PageHeader
        breadcrumbs={[
          { label: t('resellerPriceList.clientConsole') },
          { label: t('resellerPriceList.reselling') },
          { label: t('resellerPriceList.priceList') },
        ]}
        Link={Link}
        title={t('resellerPriceList.memberStorePriceList')}
        subtitle={t('resellerPriceList.yourDefaultPriceTo')}
        meta={
          list.data === undefined ? undefined : (
            <RsFacts>
              <RsFact tone={priced > 0 ? 'accent' : 'warn'}>
                {priced} of {all.length} priced
              </RsFact>
              {list.data.truncated && (
                <RsFact tone="warn">{t('resellerPriceList.first2000Products')}</RsFact>
              )}
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
        <SkeletonRows rows={6} cols={7} label={t('resellerPriceList.loadingYourProducts')} />
      </div>
    );
  }
  if (list.isError) {
    return (
      <div className="rs-page">
        {header}
        <ErrorState message={verdict(list.error, t)} retry={() => void list.refetch()} />
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
          label={t('resellerPriceList.pricedForResale')}
          icon={<Tag size={14} />}
          value={priced}
          unit={`of ${all.length}`}
          tone={priced === 0 ? 'pending' : 'neutral'}
          hint={t('resellerPriceList.aProductWithNo')}
        />
        <KpiCard
          label={t('resellerPriceList.beingSoldByA')}
          icon={<Store size={14} />}
          value={inStores}
          unit={inStores === 1 ? 'product' : 'products'}
          tone="neutral"
          hint={t('resellerPriceList.switchedOnForAt')}
        />
        <KpiCard
          label={t('resellerPriceList.unitsAvailable')}
          icon={<Boxes size={14} />}
          figure={<Num value={available} />}
          unit="units"
          tone="neutral"
          hint={t('resellerPriceList.sellableStockAcrossThe')}
        />
      </div>

      <RsSection
        title={t('resellerPriceList.products')}
        note={
          list.data.truncated
            ? t('resellerPriceList.yourFirst2000')
            : `${rows.length} ${rows.length === 1 ? 'product' : 'products'}`
        }
        flush
      >
        <TableToolbar
          search={{
            value: search,
            onChange: setSearch,
            label: t('resellerPriceList.searchByProductOr'),
            placeholder: t('resellerPriceList.productOrSku'),
          }}
          action={
            search !== '' ? (
              <Button variant="ghost" size="sm" onClick={() => setSearch('')}>
                {t('resellerPriceList.reset')}
              </Button>
            ) : undefined
          }
        />
        {rows.length === 0 ? (
          <EmptyState
            bare
            icon={search === '' ? undefined : <PackageSearch size={22} />}
            title={
              search === ''
                ? t('resellerPriceList.noActiveProductsYet')
                : t('resellerPriceList.nothingMatchesThatSearch')
            }
            description={
              search === ''
                ? t('resellerPriceList.addProductsToYour')
                : t('resellerPriceList.tryADifferentName')
            }
            action={
              search === '' ? undefined : (
                <Button variant="secondary" size="md" onClick={() => setSearch('')}>
                  {t('resellerPriceList.resetSearch')}
                </Button>
              )
            }
          />
        ) : (
          <Table caption={t('resellerPriceList.memberStorePrices')}>
            <THead>
              <Tr>
                <Th>{t('resellerPriceList.product')}</Th>
                <Th align="right">{t('resellerPriceList.available')}</Th>
                <Th align="right">
                  <GlossaryTerm
                    title={t('resellerPriceList.transferPrice')}
                    description={t('resellerPriceList.whatAMemberStore')}
                  >
                    {t('resellerPriceList.transferPrice')}
                  </GlossaryTerm>
                </Th>
                <Th>{t('resellerPriceList.retailRange')}</Th>
                <Th align="right">{t('resellerPriceList.suggested')}</Th>
                <Th align="right">{t('resellerPriceList.storesSellingIt')}</Th>
                <Th>{t('resellerPriceList.actions')}</Th>
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
                        {r.price === null
                          ? t('resellerPriceList.setPrice')
                          : t('resellerPriceList.edit')}
                      </Button>
                      {r.price !== null ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Trash2 size={13} />}
                          onClick={() => setRemoving(r)}
                        >
                          {t('resellerPriceList.remove')}
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
            label={t('resellerPriceList.priced')}
            value={`${priced} / ${all.length}`}
            tone={priced === 0 ? 'warn' : 'good'}
          />
          <RsStripFact label={t('resellerPriceList.inAStore')} value={inStores} />
          <RsStripFact label={t('resellerPriceList.shown')} value={`${rows.length} products`} />
        </RsStrip>
      )}

      {editing !== null ? <EditPriceModal row={editing} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={
          removing === null
            ? ''
            : t('resellerPriceList.removeThePriceOf', { skuCode: removing.skuCode })
        }
        entity={removing?.skuCode ?? ''}
        entityIsIdentifier
        consequence={t('resellerPriceList.storesThatSellIt')}
        confirmLabel={t('resellerPriceList.remove')}
        closeOnSuccess={false}
        onConfirm={async () => {
          if (removing === null) return;
          try {
            await remove.mutateAsync({ variantId: removing.variantId });
            toast.success(t('resellerPriceList.priceRemoved'));
            setRemoving(null);
          } catch (err) {
            toast.error(verdict(err, t));
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
  const t = useT();
  if (p.minRetailInr === null && p.maxRetailInr === null) return <>{t('resellerPriceList.any')}</>;
  return (
    <span className="rs-nowrap">
      {p.minRetailInr === null ? (
        t('resellerPriceList.upTo')
      ) : (
        <Money amount={p.minRetailInr} convert={false} />
      )}
      {p.minRetailInr !== null && p.maxRetailInr !== null ? ' – ' : null}
      {p.maxRetailInr === null ? (
        t('resellerPriceList.orMore')
      ) : (
        <Money amount={p.maxRetailInr} convert={false} />
      )}
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
  const t = useT();
  const toast = useToast();
  const save = useSetResellerDefaultPrice();
  const [draft, setDraft] = useState<PriceDraft>(draftFrom(row.price));
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      await save.mutateAsync({ variantId: row.variantId, body: priceBody(draft) });
      toast.success(t('resellerPriceList.savedTheMemberStore', { skuCode: row.skuCode }));
      onClose();
    } catch (err) {
      setError(verdict(err, t));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('resellerPriceList.memberStorePrice', { productName: row.productName })}
      description={t('resellerPriceList.storesWithAPrice', { skuCode: row.skuCode })}
      icon={<Tag size={18} />}
      footer={
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={onClose}>
            {t('resellerPriceList.cancel')}
          </Button>
          <AsyncButton
            type="submit"
            form="rs-price-form"
            variant="primary"
            size="md"
            state={pendingPhase(save.isPending)}
            labels={{ idle: t('resellerPriceList.savePrice'), busy: t('resellerPriceList.saving') }}
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
