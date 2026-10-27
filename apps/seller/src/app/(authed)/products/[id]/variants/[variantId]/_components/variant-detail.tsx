'use client';

import Link from 'next/link';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Barcode,
  Boxes,
  Pencil,
  Percent,
  Wallet,
} from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { ApiError, type SellerVariantView } from '@skydrop/api-client';
import type { SellerProductView } from '@skydrop/api-client';
import { useSellerIdentity } from '@skydrop/auth/client';
import {
  useArchiveVariant,
  useProductDetail,
  useUpdateVariant,
  useVariantDetail,
} from '@/lib/api-hooks';
import { can } from '@/lib/page-access';
import { verdict } from '@/i18n/verdict';
// The LEGACY toast on purpose, for `ArchiveVariantButton` only: its
// behaviour test mounts the legacy `Toaster`, and the shell mounts both
// providers while pages move across, so the toast looks the same either way.
import { Money, useToast } from '@skydrop/ui/components';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TextField } from '@skydrop/ui/app/text-field';
import {
  Actions,
  AreaPage,
  AreaSection,
  BackLink,
  Dash,
  FieldGrid,
  Facts,
  InlineError,
  KpiGrid,
  MetaFact,
  Panel,
  mutationPhase,
} from '@/app/(authed)/inventory/_components/stock-ui';
import { VariantImageUpload } from './image-upload';
import { StockConfigPanel } from './stock-config-panel';
import { useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

/**
 * Variant detail. Inline edit (no separate /edit route). SKU code is
 * IMMUTABLE per the round-3 design lock (changing it would break
 * order-item snapshots + reservation history); the form deliberately
 * displays it as read-only.
 *
 * Editable fields: variantLabel, weightGrams, lengthCm, widthCm,
 * Attributes JSON is admin-tooling territory and deferred to a
 * Phase-2 attribute editor.
 *
 * FE-2 discipline: on update failure, surface the server's
 * `[code] message` VERBATIM. The image upload sub-component carries
 * the same discipline at its presign + register call sites.
 */
export function VariantDetailView({
  productId,
  variantId,
}: {
  productId: string;
  variantId: string;
}): ReactElement {
  const t = useT();
  const detail = useVariantDetail(productId, variantId);
  // The product, so a blank variant field can be shown as the value it
  // actually resolves to rather than as a dash.
  const product = useProductDetail(productId);
  const [editing, setEditing] = useState(false);

  const weight = detail.data
    ? effective(detail.data.weightGrams, product.data?.defaultWeightGrams)
    : null;

  return (
    <AreaPage>
      <BackLink href={`/products/${productId}`}>
        <ArrowLeft size={14} /> {t('variantDetail.product2')}
      </BackLink>

      {detail.isLoading ? (
        <SkeletonRows rows={6} label={t('variantDetail.loadingVariant')} />
      ) : detail.isError ? (
        <ErrorState
          message={detail.error?.message ?? t('variantDetail.failedToLoadVariant')}
          retry={() => void detail.refetch()}
        />
      ) : !detail.data ? (
        <ErrorState message={t('variantDetail.variantNotFound')} />
      ) : (
        <>
          <PageHeader
            breadcrumbs={[
              { label: t('variantDetail.clientConsole') },
              { label: t('variantDetail.products'), href: '/products' },
              {
                label: product.data?.name ?? t('variantDetail.product'),
                href: `/products/${productId}`,
              },
              { label: detail.data.skuCode },
            ]}
            Link={Link}
            title={<span className="sk-ident">{detail.data.skuCode}</span>}
            subtitle={detail.data.variantLabel ?? undefined}
            /*
              The comps show a "scans to" chip beside the SKU. What a
              scan resolves to is `barcode ?? skuCode` (LBL-2) and that
              IS shown — as its own tile, where the fallback can be
              stated rather than implied by a chip that reads as a
              second, different code.
            */
            meta={
              product.data === undefined ? undefined : (
                <MetaFact tone="accent">{product.data.name}</MetaFact>
              )
            }
            action={
              <Actions>
                <StatusChip
                  kind={
                    detail.data.status === 'ACTIVE'
                      ? 'confirmed'
                      : detail.data.status === 'ARCHIVED'
                        ? 'cancelled'
                        : 'pending'
                  }
                  label={detail.data.status.toLowerCase()}
                />
                <ArchiveVariantButton
                  productId={productId}
                  variantId={variantId}
                  skuCode={detail.data.skuCode}
                  archived={detail.data.status === 'ARCHIVED'}
                />
              </Actions>
            }
          />

          {/* ── What this SKU ships as ───────────────────────────
                 The EFFECTIVE values, product default included, because
                 that is what the courier is billed on — a variant with
                 no weight of its own is not weightless. Where a figure
                 is inherited the tile says so rather than printing the
                 product's number as the variant's own.

                 No "units in stock" tile: this screen has no stock
                 read, and the number that does exist is per warehouse.
                 The stock SETTINGS below are a different question. */}
          <KpiGrid>
            <KpiCard
              label={t('variantDetail.shipsAt')}
              icon={<Boxes size={14} />}
              figure={weight ?? <span className="inv-faint">{t('variantDetail.notSet')}</span>}
              {...(weight === null ? {} : { unit: 'g' })}
              tone={weight === null ? 'pending' : 'neutral'}
              hint={inheritHint(t, detail.data.weightGrams, product.data?.defaultWeightGrams)}
            />
            <KpiCard
              label={t('variantDetail.declaredValue')}
              icon={<Wallet size={14} />}
              figure={
                effective(detail.data.declaredValueInr, product.data?.defaultDeclaredValueInr) ===
                null ? (
                  <span className="inv-faint">{t('variantDetail.notSet')}</span>
                ) : (
                  <Money
                    amount={
                      detail.data.declaredValueInr ?? product.data?.defaultDeclaredValueInr ?? '0'
                    }
                  />
                )
              }
              tone="neutral"
              hint={inheritHint(
                t,
                detail.data.declaredValueInr,
                product.data?.defaultDeclaredValueInr,
              )}
            />
            <KpiCard
              label={t('variantDetail.gstRate')}
              icon={<Percent size={14} />}
              figure={
                detail.data.gstRate === null ? (
                  <span className="inv-faint">{t('variantDetail.notSet')}</span>
                ) : (
                  detail.data.gstRate
                )
              }
              {...(detail.data.gstRate === null ? {} : { unit: '%' })}
              tone="neutral"
              hint={detail.data.gstRate === null ? t('variantDetail.fallsBackToThe') : undefined}
            />
            <KpiCard
              label={t('variantDetail.scansAs')}
              icon={<Barcode size={14} />}
              /*
                LBL-2: the pack bench resolves a scan to
                `variant.barcode ?? skuCode`, and accepts BOTH. So the
                SKU code is not a placeholder here — it is the code on
                the sticker until the seller fills in a real EAN.
              */
              figure={
                /* `sk-ident--wrap`, not an inline `overflowWrap`: that
                   cannot act on a `nowrap` run, which is what
                   `.sk-ident` sets, so the code stayed on one line and
                   ran 47px out of its card at 768px. The shared modifier
                   turns the nowrap off as well. */
                <span className="sk-ident sk-ident--wrap">
                  {detail.data.barcode ?? detail.data.skuCode}
                </span>
              }
              tone="neutral"
              hint={
                detail.data.barcode === null
                  ? t('variantDetail.yourSkuCodeAdd')
                  : t('variantDetail.yourOwnBarcode')
              }
            />
          </KpiGrid>

          <AreaSection
            title={t('variantDetail.details')}
            note={t('variantDetail.whatThisSkuIs')}
            action={
              !editing && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Pencil size={14} />}
                  onClick={() => setEditing(true)}
                >
                  {t('variantDetail.editVariant')}
                </Button>
              )
            }
          >
            <Panel>
              {editing ? (
                <VariantEditForm
                  productId={productId}
                  variant={detail.data}
                  onCancel={() => setEditing(false)}
                  onSaved={() => setEditing(false)}
                />
              ) : (
                <VariantReadCard variant={detail.data} product={product.data} />
              )}
            </Panel>
          </AreaSection>

          <StockConfigPanel productId={productId} variantId={variantId} />

          <AreaSection
            title={t('variantDetail.pictures')}
            note={t('variantDetail.whatTheCustomerSees')}
          >
            <Panel>
              <VariantImageUpload variantId={variantId} skuCode={detail.data.skuCode} />
            </Panel>
          </AreaSection>
        </>
      )}
    </AreaPage>
  );
}

/**
 * Archive or restore THIS variant.
 *
 * Archiving a product archives its variants, but restoring the product
 * deliberately leaves them archived (which ones go live again is the
 * seller's call) — so without this a restored product's variants could
 * never be brought back. Archiving is confirmed: it stops new orders and
 * stock receiving for the SKU; restoring is not, it only makes it
 * orderable again. Cosmetically gated on catalog.manage, which is what
 * the endpoint enforces (FE-2 — the server refuses regardless).
 */
export function ArchiveVariantButton({
  productId,
  variantId,
  skuCode,
  archived,
}: {
  readonly productId: string;
  readonly variantId: string;
  readonly skuCode: string;
  readonly archived: boolean;
}): ReactElement | null {
  const t = useT();
  const mayManage = can(useSellerIdentity(), 'catalog.manage');
  const archive = useArchiveVariant(productId, variantId);
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!mayManage) return null;

  async function run(nextArchived: boolean): Promise<void> {
    setError(null);
    try {
      await archive.mutateAsync({ archived: nextArchived });
      setConfirming(false);
      toast.success(
        nextArchived
          ? t('variantDetail.archivedItCanNo', { skuCode })
          : t('variantDetail.restoredItCanBe', { skuCode }),
      );
    } catch (err) {
      const message = verdict(err, t);
      if (nextArchived) {
        setError(message);
        // Rejecting keeps the confirm open with the verdict in it.
        throw err;
      } else toast.error(message);
    }
  }

  return (
    <>
      <AsyncButton
        variant="secondary"
        icon={archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
        labels={{
          idle: archived ? t('variantDetail.restoreVariant') : t('variantDetail.archiveVariant'),
          busy: archived ? t('variantDetail.restoring') : t('variantDetail.archiving'),
        }}
        state={mutationPhase(archive)}
        disabled={archive.isPending}
        onClick={() => (archived ? void run(false) : setConfirming(true))}
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={(next) => {
          setConfirming(next);
          if (!next) setError(null);
        }}
        title={t('variantDetail.archive', { skuCode })}
        entity={skuCode}
        entityIsIdentifier
        consequence={t('variantDetail.itStopsBeingOrderable')}
        confirmLabel={t('variantDetail.archiveVariant')}
        destructive
        error={error ?? undefined}
        onConfirm={() => run(true)}
      />
    </>
  );
}

/**
 * A value the variant does not carry, shown as what it actually resolves
 * to.
 *
 * Blank on a variant means INHERIT the product default (M4:
 * `variant.field ?? product.defaultField`), so printing the raw null as
 * "—" said "nothing set" about a variant the courier will happily bill
 * and customs will happily value. The number shown is the one that gets
 * used; the label says where it came from.
 */
function Inherited({
  own,
  fallback,
  suffix = '',
}: {
  readonly own: string | number | null;
  readonly fallback: string | number | null | undefined;
  readonly suffix?: string;
}): ReactElement {
  const t = useT();
  if (own !== null && own !== '') {
    return (
      <>
        {own}
        {suffix}
      </>
    );
  }
  if (fallback === null || fallback === undefined || fallback === '') return <>—</>;
  // Shown plainly: this IS the value the variant ships and is valued at.
  // The tooltip says where it came from for anyone who wonders.
  return (
    <span title={t('variantDetail.fromTheProductDefault')}>
      {fallback}
      {suffix}
    </span>
  );
}

function VariantReadCard({
  variant,
  product,
}: {
  variant: SellerVariantView;
  product: SellerProductView | undefined;
}): ReactElement {
  const t = useT();
  // No card of its own: the section's panel is the surface.
  return (
    <Facts
      columns={2}
      items={[
        {
          label: t('variantDetail.sku'),
          value: <span className="sk-ident">{variant.skuCode}</span>,
        },
        { label: t('variantDetail.label'), value: variant.variantLabel ?? <Dash /> },
        {
          label: t('variantDetail.weight'),
          value: (
            <span className="sk-figure">
              <Inherited
                own={variant.weightGrams}
                fallback={product?.defaultWeightGrams}
                suffix=" g"
              />
            </span>
          ),
        },
        {
          label: t('variantDetail.boxLWH'),
          value: (
            <span className="sk-figure">
              {variant.lengthCm !== null ? (
                `${variant.lengthCm} × ${variant.widthCm ?? '—'} × ${variant.heightCm ?? '—'} cm`
              ) : product?.defaultLengthCm != null ? (
                <span title={t('variantDetail.fromTheProductDefault')}>
                  {product.defaultLengthCm} × {product.defaultWidthCm ?? '—'} ×{' '}
                  {product.defaultHeightCm ?? '—'} cm
                </span>
              ) : (
                <Dash />
              )}
            </span>
          ),
        },
        {
          label: t('variantDetail.declaredValue'),
          value: (
            <span className="sk-figure">
              <Inherited
                own={variant.declaredValueInr}
                fallback={product?.defaultDeclaredValueInr}
              />
            </span>
          ),
        },
        {
          label: t('variantDetail.gstRate'),
          value:
            variant.gstRate === null ? (
              <Dash />
            ) : (
              <span className="sk-figure">{variant.gstRate} %</span>
            ),
        },
        {
          label: t('variantDetail.barcode'),
          value:
            variant.barcode === null ? (
              <Dash />
            ) : (
              <span className="sk-ident">{variant.barcode}</span>
            ),
        },
      ]}
    />
  );
}

/**
 * The value that actually applies — the variant's own, else the
 * product default (M4's inheritance). Returns null when neither is
 * set, which is a real state and not a zero.
 */
function effective(
  own: string | number | null,
  fallback: string | number | null | undefined,
): string | number | null {
  if (own !== null) return own;
  return fallback ?? null;
}

/** Says WHERE the figure came from, because inheriting is not nothing. */
function inheritHint(
  t: Translate<MessageKey>,
  own: string | number | null,
  fallback: string | number | null | undefined,
): string | undefined {
  if (own !== null) return undefined;
  if (fallback === null || fallback === undefined) return t('variantDetail.setItHereOr');
  return t('variantDetail.fromTheProductDefault2');
}

function VariantEditForm({
  productId,
  variant,
  onCancel,
  onSaved,
}: {
  productId: string;
  variant: SellerVariantView;
  onCancel: () => void;
  onSaved: () => void;
}): ReactElement {
  const t = useT();
  const [variantLabel, setVariantLabel] = useState(variant.variantLabel ?? '');
  const [weightGrams, setWeightGrams] = useState(
    variant.weightGrams === null ? '' : String(variant.weightGrams),
  );
  const [declaredValueInr, setDeclaredValueInr] = useState(variant.declaredValueInr ?? '');
  // A variant can differ from its siblings in box size as well as in
  // weight — a 46 comes in a bigger carton — and the courier bills on
  // volumetric weight wherever it exceeds the actual. Blank still means
  // inherit the product default.
  const [lengthCm, setLengthCm] = useState(variant.lengthCm ?? '');
  const [widthCm, setWidthCm] = useState(variant.widthCm ?? '');
  const [heightCm, setHeightCm] = useState(variant.heightCm ?? '');
  const [gstRate, setGstRate] = useState(variant.gstRate ?? '');
  const [barcode, setBarcode] = useState(variant.barcode ?? '');
  const [serverError, setServerError] = useState<string | null>(null);

  const update = useUpdateVariant(productId, variant.id);

  async function handleSave(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setServerError(null);
    try {
      await update.mutateAsync({
        variantLabel: variantLabel.trim() === '' ? null : variantLabel.trim(),
        weightGrams: weightGrams === '' ? null : Number(weightGrams),
        declaredValueInr: declaredValueInr === '' ? null : Number(declaredValueInr),
        lengthCm: lengthCm === '' ? null : Number(lengthCm),
        widthCm: widthCm === '' ? null : Number(widthCm),
        heightCm: heightCm === '' ? null : Number(heightCm),
        gstRate: gstRate === '' ? null : Number(gstRate),
        barcode: barcode.trim() === '' ? null : barcode.trim(),
      });
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(`[${err.code}] ${err.message}`);
      } else {
        setServerError(t('variantDetail.updateFailedPleaseTry'));
      }
    }
  }

  const fields: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly value: string;
    readonly set: (v: string) => void;
    readonly type?: 'number';
    readonly min?: string;
    readonly step?: string;
    readonly ident?: boolean;
  }> = [
    {
      id: 'variantLabel',
      label: t('variantDetail.label'),
      value: variantLabel,
      set: setVariantLabel,
    },
    {
      id: 'weightGrams',
      label: t('variantDetail.weightG'),
      value: weightGrams,
      set: setWeightGrams,
      type: 'number',
      min: '0',
    },
    {
      id: 'lengthCm',
      label: t('variantDetail.lengthCm'),
      value: lengthCm,
      set: setLengthCm,
      type: 'number',
      min: '0',
      step: '0.1',
    },
    {
      id: 'widthCm',
      label: t('variantDetail.widthCm'),
      value: widthCm,
      set: setWidthCm,
      type: 'number',
      min: '0',
      step: '0.1',
    },
    {
      id: 'heightCm',
      label: t('variantDetail.heightCm'),
      value: heightCm,
      set: setHeightCm,
      type: 'number',
      min: '0',
      step: '0.1',
    },
    {
      id: 'declaredValueInr',
      label: t('variantDetail.declaredInr'),
      value: declaredValueInr,
      set: setDeclaredValueInr,
      type: 'number',
      step: '0.01',
    },
    {
      id: 'gstRate',
      label: t('variantDetail.gstRate2'),
      value: gstRate,
      set: setGstRate,
      type: 'number',
      step: '0.01',
    },
    {
      id: 'barcode',
      label: t('variantDetail.barcode'),
      value: barcode,
      set: setBarcode,
      ident: true,
    },
  ];

  return (
    <form onSubmit={handleSave} className="inv-stack">
      <FieldGrid columns={2}>
        <TextField
          label={t('variantDetail.sku')}
          id="sku"
          hint={t('variantDetail.immutable')}
          value={variant.skuCode}
          disabled
          inputClassName="sk-ident"
        />
        {fields.map((f) => (
          <TextField
            key={f.id}
            label={f.label}
            id={f.id}
            {...(f.type === undefined ? {} : { type: f.type })}
            {...(f.min === undefined ? {} : { min: f.min })}
            {...(f.step === undefined ? {} : { step: f.step })}
            value={f.value}
            onChange={(e) => f.set(e.target.value)}
            disabled={update.isPending}
            {...(f.ident === true ? { inputClassName: 'sk-ident' } : {})}
          />
        ))}
      </FieldGrid>
      {serverError && <InlineError message={serverError} />}
      <Actions>
        <AsyncButton
          type="submit"
          variant="primary"
          labels={{ idle: t('variantDetail.saveChanges'), busy: t('variantDetail.saving') }}
          state={mutationPhase(update)}
        />
        <Button variant="ghost" onClick={onCancel} disabled={update.isPending}>
          {t('variantDetail.cancel')}
        </Button>
      </Actions>
    </form>
  );
}
