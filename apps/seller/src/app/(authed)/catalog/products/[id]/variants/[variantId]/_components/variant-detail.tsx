'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { ApiError, type SellerVariantView } from '@skydrop/api-client';
import { useUpdateVariant, useVariantDetail } from '@/lib/api-hooks';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  FormActions,
  FormField,
  Input,
  LoadingState,
  PageHeader,
  Section,
  StatusBadge,
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
 * heightCm, declaredValueInr, gstRate, barcode, externalSku.
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
  const [editing, setEditing] = useState(false);

  return (
    <div>
      <Link
        href={`/catalog/products/${productId}`}
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
            title={<span className="font-mono">{detail.data.skuCode}</span>}
            subtitle={detail.data.variantLabel ?? undefined}
            action={
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
            }
          />

          <Section
            title="Details"
            action={!editing && <Button onClick={() => setEditing(true)}>Edit variant</Button>}
          >
            {editing ? (
              <VariantEditForm
                productId={productId}
                variant={detail.data}
                onCancel={() => setEditing(false)}
                onSaved={() => setEditing(false)}
              />
            ) : (
              <VariantReadCard variant={detail.data} />
            )}
          </Section>

          <StockConfigPanel productId={productId} variantId={variantId} />

          <Section title="Images">
            <VariantImageUpload variantId={variantId} />
          </Section>
        </>
      )}
    </div>
  );
}

function VariantReadCard({ variant }: { variant: SellerVariantView }): ReactElement {
  return (
    <Card>
      <CardBody>
        <dl className="grid grid-cols-[minmax(84px,36%)_1fr] sm:grid-cols-[160px_1fr] gap-x-3 sm:gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-text-muted">SKU</dt>
          <dd className="text-text-body font-mono text-xs">{variant.skuCode}</dd>
          <dt className="text-text-muted">Label</dt>
          <dd className="text-text-body">{variant.variantLabel ?? '—'}</dd>
          <dt className="text-text-muted">Weight</dt>
          <dd className="text-text-body font-mono">
            {variant.weightGrams ? `${variant.weightGrams} g` : '—'}
          </dd>
          <dt className="text-text-muted">Dims (LxWxH cm)</dt>
          <dd className="text-text-body font-mono text-xs">
            {variant.lengthCm
              ? `${variant.lengthCm} × ${variant.widthCm ?? '—'} × ${variant.heightCm ?? '—'}`
              : '—'}
          </dd>
          <dt className="text-text-muted">Declared (INR)</dt>
          <dd className="text-text-body font-mono">{variant.declaredValueInr ?? '—'}</dd>
          <dt className="text-text-muted">GST rate (%)</dt>
          <dd className="text-text-body font-mono">{variant.gstRate ?? '—'}</dd>
          <dt className="text-text-muted">Barcode</dt>
          <dd className="text-text-body font-mono text-xs">{variant.barcode ?? '—'}</dd>
          <dt className="text-text-muted">External SKU</dt>
          <dd className="text-text-body font-mono text-xs">{variant.externalSku ?? '—'}</dd>
        </dl>
      </CardBody>
    </Card>
  );
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
  const [gstRate, setGstRate] = useState(variant.gstRate ?? '');
  const [barcode, setBarcode] = useState(variant.barcode ?? '');
  const [externalSku, setExternalSku] = useState(variant.externalSku ?? '');
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
        gstRate: gstRate === '' ? null : Number(gstRate),
        barcode: barcode.trim() === '' ? null : barcode.trim(),
        externalSku: externalSku.trim() === '' ? null : externalSku.trim(),
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
    <Card>
      <CardHeader title="Edit variant" />
      <CardBody>
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
            <FormField label="External SKU" htmlFor="externalSku">
              <Input
                id="externalSku"
                value={externalSku}
                onChange={(e) => setExternalSku(e.target.value)}
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
      </CardBody>
    </Card>
  );
}
