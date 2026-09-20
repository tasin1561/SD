'use client';

import Link from 'next/link';
import { ArrowLeft, Barcode, Boxes, Percent, Wallet } from 'lucide-react';
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
import { serverVerdict } from '@/lib/server-verdict';
import {
  BandBody,
  Button,
  Crumbs,
  DescriptionList,
  ErrorState,
  FormActions,
  FormField,
  Input,
  LoadingState,
  MetaChip,
  Modal,
  ModalFooter,
  Money,
  PageHeader,
  SectionBand,
  Stat,
  StatusBadge,
  useToast,
} from '@skydrop/ui/components';
import { VariantImageUpload } from './image-upload';
import { StockConfigPanel } from './stock-config-panel';

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
  const detail = useVariantDetail(productId, variantId);
  // The product, so a blank variant field can be shown as the value it
  // actually resolves to rather than as a dash.
  const product = useProductDetail(productId);
  const [editing, setEditing] = useState(false);

  return (
    <div>
      <Link
        href={`/products/${productId}`}
        className="inline-flex items-center gap-1.5 text-text-muted hover:text-text-body text-xs mb-4 transition-colors"
      >
        <ArrowLeft size={12} /> Product
      </Link>

      {detail.isLoading ? (
        <LoadingState label="Loading variant…" />
      ) : detail.isError ? (
        <ErrorState
          message={detail.error?.message ?? 'Failed to load variant.'}
          retry={() => void detail.refetch()}
        />
      ) : !detail.data ? (
        <ErrorState message="Variant not found." />
      ) : (
        <>
          <PageHeader
            breadcrumb={
              <Crumbs
                items={[
                  { label: 'Seller console' },
                  { label: 'Products', href: '/products' },
                  { label: product.data?.name ?? 'Product', href: `/products/${productId}` },
                  { label: detail.data.skuCode },
                ]}
                Link={Link}
              />
            }
            title={<span className="font-mono">{detail.data.skuCode}</span>}
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
                <MetaChip tone="accent">{product.data.name}</MetaChip>
              )
            }
            action={
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
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
              </div>
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
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Ships at"
              icon={<Boxes size={13} aria-hidden />}
              value={
                effective(detail.data.weightGrams, product.data?.defaultWeightGrams) ?? (
                  <span className="text-text-faint text-base">Not set</span>
                )
              }
              unit={
                effective(detail.data.weightGrams, product.data?.defaultWeightGrams) === null
                  ? undefined
                  : 'g'
              }
              tone={
                effective(detail.data.weightGrams, product.data?.defaultWeightGrams) === null
                  ? 'warn'
                  : 'neutral'
              }
              hint={inheritHint(detail.data.weightGrams, product.data?.defaultWeightGrams)}
            />
            <Stat
              label="Declared value"
              icon={<Wallet size={13} aria-hidden />}
              value={
                effective(detail.data.declaredValueInr, product.data?.defaultDeclaredValueInr) ===
                null ? (
                  <span className="text-text-faint text-base">Not set</span>
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
                detail.data.declaredValueInr,
                product.data?.defaultDeclaredValueInr,
              )}
            />
            <Stat
              label="GST rate"
              icon={<Percent size={13} aria-hidden />}
              value={
                detail.data.gstRate === null ? (
                  <span className="text-text-faint text-base">Not set</span>
                ) : (
                  detail.data.gstRate
                )
              }
              unit={detail.data.gstRate === null ? undefined : '%'}
              tone="neutral"
              hint={detail.data.gstRate === null ? 'Falls back to the system rate.' : undefined}
            />
            <Stat
              label="Scans as"
              icon={<Barcode size={13} aria-hidden />}
              /*
                LBL-2: the pack bench resolves a scan to
                `variant.barcode ?? skuCode`, and accepts BOTH. So the
                SKU code is not a placeholder here — it is the code on
                the sticker until the seller fills in a real EAN.
              */
              value={
                <span className="font-mono text-base break-all">
                  {detail.data.barcode ?? detail.data.skuCode}
                </span>
              }
              tone="neutral"
              hint={
                detail.data.barcode === null
                  ? 'Your SKU code — add a barcode and both keep working.'
                  : 'Your own barcode.'
              }
            />
          </div>

          <div>
            <SectionBand
              index="01"
              title="Details"
              note="What this SKU is, and what it inherits."
              action={
                !editing && (
                  <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                    Edit variant
                  </Button>
                )
              }
            />
            <BandBody className="mb-4">
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
            </BandBody>
          </div>

          <StockConfigPanel productId={productId} variantId={variantId} />

          <div>
            <SectionBand
              index="03"
              title="Pictures"
              note="What the customer sees beside this SKU."
            />
            <BandBody>
              <VariantImageUpload variantId={variantId} />
            </BandBody>
          </div>
        </>
      )}
    </div>
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
          ? `${skuCode} archived — it can no longer be ordered or received.`
          : `${skuCode} restored — it can be ordered again.`,
      );
    } catch (err) {
      const verdict = serverVerdict(err);
      if (nextArchived) setError(verdict);
      else toast.error(verdict);
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        disabled={archive.isPending}
        onClick={() => (archived ? void run(false) : setConfirming(true))}
      >
        {archive.isPending && archived
          ? 'Restoring…'
          : archived
            ? 'Restore variant'
            : 'Archive variant'}
      </Button>
      <Modal
        open={confirming}
        onOpenChange={(next) => {
          setConfirming(next);
          if (!next) setError(null);
        }}
        title={`Archive ${skuCode}?`}
        description="It stops being orderable and no new stock can be received against it. Its order history and any stock already here stay as they are, and you can restore it at any time."
      >
        {error !== null && (
          <p role="alert" className="text-critical text-sm">
            {error}
          </p>
        )}
        <ModalFooter>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={archive.isPending} onClick={() => void run(true)}>
            {archive.isPending ? 'Archiving…' : 'Archive variant'}
          </Button>
        </ModalFooter>
      </Modal>
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
    <span title="From the product default">
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
  // No <Card>: the band's own `BandBody` is the bordered surface.
  return (
    <DescriptionList
      columns={2}
      items={[
        { label: 'SKU', value: <span className="font-mono text-xs">{variant.skuCode}</span> },
        { label: 'Label', value: variant.variantLabel ?? <Dash /> },
        {
          label: 'Weight',
          value: (
            <span className="font-mono">
              <Inherited
                own={variant.weightGrams}
                fallback={product?.defaultWeightGrams}
                suffix=" g"
              />
            </span>
          ),
        },
        {
          label: 'Box (L × W × H)',
          value: (
            <span className="font-mono text-xs">
              {variant.lengthCm !== null ? (
                `${variant.lengthCm} × ${variant.widthCm ?? '—'} × ${variant.heightCm ?? '—'} cm`
              ) : product?.defaultLengthCm != null ? (
                <span title="From the product default">
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
          label: 'Declared value',
          value: (
            <span className="font-mono">
              <Inherited
                own={variant.declaredValueInr}
                fallback={product?.defaultDeclaredValueInr}
              />
            </span>
          ),
        },
        {
          label: 'GST rate',
          value:
            variant.gstRate === null ? (
              <Dash />
            ) : (
              <span className="font-mono">{variant.gstRate} %</span>
            ),
        },
        {
          label: 'Barcode',
          value:
            variant.barcode === null ? (
              <Dash />
            ) : (
              <span className="font-mono text-xs break-all">{variant.barcode}</span>
            ),
        },
      ]}
    />
  );
}

function Dash(): ReactElement {
  return <span className="text-text-faint">—</span>;
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
  own: string | number | null,
  fallback: string | number | null | undefined,
): string | undefined {
  if (own !== null) return undefined;
  if (fallback === null || fallback === undefined) return 'Set it here or on the product.';
  return 'From the product default.';
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
        setServerError('Update failed. Please try again.');
      }
    }
  }

  return (
    <>
      <form onSubmit={handleSave} className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FormField label="SKU" htmlFor="sku" hint="Immutable">
            <Input id="sku" value={variant.skuCode} disabled className="font-mono text-xs" />
          </FormField>
          <FormField label="Label" htmlFor="variantLabel">
            <Input
              id="variantLabel"
              value={variantLabel}
              onChange={(e) => setVariantLabel(e.target.value)}
              disabled={update.isPending}
            />
          </FormField>
          <FormField label="Weight (g)" htmlFor="weightGrams">
            <Input
              id="weightGrams"
              type="number"
              min="0"
              value={weightGrams}
              onChange={(e) => setWeightGrams(e.target.value)}
              disabled={update.isPending}
            />
          </FormField>
          <FormField label="Length (cm)" htmlFor="lengthCm">
            <Input
              id="lengthCm"
              type="number"
              min="0"
              step="0.1"
              value={lengthCm}
              onChange={(e) => setLengthCm(e.target.value)}
              disabled={update.isPending}
            />
          </FormField>
          <FormField label="Width (cm)" htmlFor="widthCm">
            <Input
              id="widthCm"
              type="number"
              min="0"
              step="0.1"
              value={widthCm}
              onChange={(e) => setWidthCm(e.target.value)}
              disabled={update.isPending}
            />
          </FormField>
          <FormField label="Height (cm)" htmlFor="heightCm">
            <Input
              id="heightCm"
              type="number"
              min="0"
              step="0.1"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              disabled={update.isPending}
            />
          </FormField>
          <FormField label="Declared (INR)" htmlFor="declaredValueInr">
            <Input
              id="declaredValueInr"
              type="number"
              step="0.01"
              value={declaredValueInr}
              onChange={(e) => setDeclaredValueInr(e.target.value)}
              disabled={update.isPending}
            />
          </FormField>
          <FormField label="GST rate (%)" htmlFor="gstRate">
            <Input
              id="gstRate"
              type="number"
              step="0.01"
              value={gstRate}
              onChange={(e) => setGstRate(e.target.value)}
              disabled={update.isPending}
            />
          </FormField>
          <FormField label="Barcode" htmlFor="barcode">
            <Input
              id="barcode"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              disabled={update.isPending}
            />
          </FormField>
        </div>
        {serverError && (
          <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-2.5 py-1.5 rounded-[5px]">
            {serverError}
          </div>
        )}
        <FormActions>
          <Button variant="ghost" onClick={onCancel} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </FormActions>
      </form>
    </>
  );
}
