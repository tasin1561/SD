'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { ProductStatus } from '@skydrop/db';
import { AddVariantPanel } from './add-variant-panel';
import { ApiError } from '@skydrop/api-client';
import type { SellerProductView } from '@skydrop/api-client';
import {
  useArchiveProduct,
  useProductDetail,
  useProductVariants,
  useUpdateProduct,
} from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  FormActions,
  FormField,
  Input,
  LoadingState,
  PageHeader,
  Section,
  StatusBadge,
  Table,
  TBody,
  Td,
  Textarea,
  Th,
  THead,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { useRouter } from 'next/navigation';

/**
 * Seller product detail. Inline edit (no separate edit page) — write
 * pattern-setter. The product info card has a read mode + an edit
 * mode toggled by "Edit product" button. The variants table is
 * read-only here; clicking a variant navigates to its detail where
 * the same inline-edit + image upload primitives live (CP2.B.4).
 *
 * FE-2 discipline: on update mutation failure, surface the server's
 * `[code] message` VERBATIM from the ApiError. No client-side mirror
 * of validation.
 */
export function ProductDetailView({ productId }: { productId: string }): ReactElement {
  const [addingVariant, setAddingVariant] = useState(false);
  const router = useRouter();
  const detail = useProductDetail(productId);
  const variants = useProductVariants(productId);
  const archive = useArchiveProduct(productId);
  const toast = useToast();
  const [editing, setEditing] = useState(false);

  const isArchived = detail.data?.status === ProductStatus.ARCHIVED;

  async function onToggleArchive(): Promise<void> {
    try {
      await archive.mutateAsync({ archived: !isArchived });
      toast.success(
        isArchived
          ? 'Restored. Its variants stay archived — restore the ones you want back.'
          : 'Archived. It and its variants can no longer be ordered or received.',
      );
    } catch (err) {
      toast.error(serverVerdict(err));
    }
  }

  return (
    <div>
      <Link
        href="/catalog"
        className="inline-flex items-center gap-1.5 text-text-muted hover:text-text-body text-xs mb-4 transition-colors"
      >
        <ArrowLeft size={12} /> Catalog
      </Link>

      {detail.isLoading ? (
        <LoadingState label="Loading product…" />
      ) : detail.isError ? (
        <ErrorState
          message={detail.error?.message ?? 'Failed to load product.'}
          retry={() => void detail.refetch()}
        />
      ) : !detail.data ? (
        <ErrorState message="Product not found." />
      ) : (
        <>
          <PageHeader
            title={detail.data.name}
            subtitle={
              detail.data.externalRef ? (
                <span>
                  Ref: <span className="font-mono">{detail.data.externalRef}</span>
                </span>
              ) : undefined
            }
            action={
              <StatusBadge
                kind={
                  detail.data.status === ProductStatus.ACTIVE
                    ? 'confirmed'
                    : detail.data.status === ProductStatus.ARCHIVED
                      ? 'cancelled'
                      : 'pending'
                }
                label={detail.data.status.toLowerCase()}
              />
            }
          />

          <Section
            title="Details"
            action={
              !editing && (
                <div className="flex items-center gap-2">
                  <Button onClick={() => setEditing(true)}>Edit product</Button>
                  {/* ARCHIVED blocks new orders and stock receiving while
                      leaving history intact — the normal way to stop
                      selling something. Delete is deliberately not
                      offered: it hides the row from read paths, which is
                      a bigger hammer and staff-recoverable only. */}
                  <Button
                    variant="secondary"
                    disabled={archive.isPending}
                    onClick={() => void onToggleArchive()}
                  >
                    {archive.isPending
                      ? 'Saving…'
                      : isArchived
                        ? 'Restore product'
                        : 'Archive product'}
                  </Button>
                </div>
              )
            }
          >
            {editing ? (
              <ProductEditForm
                product={detail.data}
                onCancel={() => setEditing(false)}
                onSaved={() => setEditing(false)}
              />
            ) : (
              <ProductReadCard product={detail.data} />
            )}
          </Section>

          <Section
            title={`Variants${variants.data ? ` (${variants.data.length})` : ''}`}
            action={
              addingVariant ? undefined : (
                <Button variant="secondary" size="md" onClick={() => setAddingVariant(true)}>
                  Add variant
                </Button>
              )
            }
          >
            {addingVariant && (
              <AddVariantPanel productId={productId} onDone={() => setAddingVariant(false)} />
            )}
            {variants.isLoading ? (
              <LoadingState label="Loading variants…" />
            ) : variants.isError ? (
              <ErrorState
                message={variants.error?.message ?? 'Failed to load variants.'}
                retry={() => void variants.refetch()}
              />
            ) : !variants.data || variants.data.length === 0 ? (
              <EmptyState
                title="No variants yet"
                description="A product needs at least one variant before it can be ordered — nothing can be stocked or picked against the product itself."
                action={
                  <Button variant="primary" size="md" onClick={() => setAddingVariant(true)}>
                    Add variant
                  </Button>
                }
              />
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>SKU</Th>
                    <Th>Label</Th>
                    <Th align="right">Weight (g)</Th>
                    <Th>Status</Th>
                  </Tr>
                </THead>
                <TBody>
                  {variants.data.map((v) => (
                    <Tr
                      key={v.id}
                      onActivate={() =>
                        router.push(`/catalog/products/${productId}/variants/${v.id}`)
                      }
                    >
                      <Td>
                        <Link
                          href={`/catalog/products/${productId}/variants/${v.id}`}
                          className="text-text-bright hover:underline font-mono text-xs"
                        >
                          {v.skuCode}
                        </Link>
                      </Td>
                      <Td className="text-text-body">{v.variantLabel ?? '—'}</Td>
                      <Td align="right" className="text-text-muted font-mono text-xs">
                        {v.weightGrams ?? '—'}
                      </Td>
                      <Td>
                        <StatusBadge
                          kind={
                            v.status === 'ACTIVE'
                              ? 'confirmed'
                              : v.status === 'ARCHIVED'
                                ? 'cancelled'
                                : 'pending'
                          }
                          label={v.status.toLowerCase()}
                        />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function ProductReadCard({ product }: { product: SellerProductView }): ReactElement {
  return (
    <Card>
      <CardBody>
        <dl className="grid grid-cols-[minmax(84px,36%)_1fr] sm:grid-cols-[160px_1fr] gap-x-3 sm:gap-x-6 gap-y-1.5 text-sm">
          {product.description && (
            <>
              <dt className="text-text-muted">Description</dt>
              <dd className="text-text-body whitespace-pre-wrap">{product.description}</dd>
            </>
          )}
          <dt className="text-text-muted">External ref</dt>
          <dd className="text-text-body font-mono text-xs">{product.externalRef ?? '—'}</dd>
          <dt className="text-text-muted">External SKU</dt>
          <dd className="text-text-body font-mono text-xs">{product.externalSku ?? '—'}</dd>
          <dt className="text-text-muted">Default weight</dt>
          <dd className="text-text-body font-mono">
            {product.defaultWeightGrams ? `${product.defaultWeightGrams} g` : '—'}
          </dd>
          <dt className="text-text-muted">Default dims (LxWxH cm)</dt>
          <dd className="text-text-body font-mono text-xs">
            {product.defaultLengthCm
              ? `${product.defaultLengthCm} × ${product.defaultWidthCm ?? '—'} × ${product.defaultHeightCm ?? '—'}`
              : '—'}
          </dd>
          <dt className="text-text-muted">Default declared (INR)</dt>
          <dd className="text-text-body font-mono">{product.defaultDeclaredValueInr ?? '—'}</dd>
        </dl>
      </CardBody>
    </Card>
  );
}

function ProductEditForm({
  product,
  onCancel,
  onSaved,
}: {
  product: SellerProductView;
  onCancel: () => void;
  onSaved: () => void;
}): ReactElement {
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? '');
  const [externalRef, setExternalRef] = useState(product.externalRef ?? '');
  const [defaultWeight, setDefaultWeight] = useState(
    product.defaultWeightGrams === null ? '' : String(product.defaultWeightGrams),
  );
  const [defaultDeclared, setDefaultDeclared] = useState(product.defaultDeclaredValueInr ?? '');
  const [serverError, setServerError] = useState<string | null>(null);

  const update = useUpdateProduct(product.id);

  async function handleSave(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setServerError(null);
    try {
      await update.mutateAsync({
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
        externalRef: externalRef.trim() === '' ? null : externalRef.trim(),
        defaultWeightGrams: defaultWeight === '' ? null : Number(defaultWeight),
        defaultDeclaredValueInr: defaultDeclared === '' ? null : Number(defaultDeclared),
      });
      onSaved();
    } catch (err) {
      // FE-2: surface the server verdict VERBATIM. The ApiError shape
      // is `[CODE] message` — we render `[code] message` here directly.
      if (err instanceof ApiError) {
        setServerError(`[${err.code}] ${err.message}`);
      } else {
        setServerError('Update failed. Please try again.');
      }
    }
  }

  return (
    <Card>
      <CardHeader title="Edit product" />
      <CardBody>
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormField label="Name" htmlFor="name" required>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={update.isPending}
              />
            </FormField>
          </div>
          <FormField label="Description" htmlFor="description">
            <Textarea
              id="description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={update.isPending}
            />
          </FormField>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <FormField label="External ref" htmlFor="externalRef">
              <Input
                id="externalRef"
                value={externalRef}
                onChange={(e) => setExternalRef(e.target.value)}
                disabled={update.isPending}
              />
            </FormField>
            <FormField label="Default weight (g)" htmlFor="defaultWeight">
              <Input
                id="defaultWeight"
                type="number"
                min="0"
                value={defaultWeight}
                onChange={(e) => setDefaultWeight(e.target.value)}
                disabled={update.isPending}
              />
            </FormField>
            <FormField label="Default declared (INR)" htmlFor="defaultDeclared">
              <Input
                id="defaultDeclared"
                type="number"
                step="0.01"
                value={defaultDeclared}
                onChange={(e) => setDefaultDeclared(e.target.value)}
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
