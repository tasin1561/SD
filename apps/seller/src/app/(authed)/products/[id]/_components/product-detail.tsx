'use client';

import Link from 'next/link';
import { ArrowLeft, Boxes, Layers, Ruler, Wallet } from 'lucide-react';
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
  BandBody,
  Button,
  Crumbs,
  DescriptionList,
  EmptyState,
  ErrorState,
  FormActions,
  FormField,
  Input,
  LoadingState,
  MetaChip,
  Money,
  PageHeader,
  SectionBand,
  Stat,
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
        href="/products"
        className="inline-flex items-center gap-1.5 text-text-muted hover:text-text-body text-xs mb-4 transition-colors"
      >
        <ArrowLeft size={12} /> Products
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
            breadcrumb={
              <Crumbs
                items={[
                  { label: 'Seller console' },
                  { label: 'Products', href: '/products' },
                  { label: detail.data.name },
                ]}
                Link={Link}
              />
            }
            title={detail.data.name}
            subtitle={
              detail.data.externalRef ? (
                <span>
                  Your ref: <span className="font-mono">{detail.data.externalRef}</span>
                </span>
              ) : undefined
            }
            /*
              What the comps put here that we do not have: an HSN code
              and a country of origin. `hsCode` was removed from the
              schema on 2026-08-18 and nothing records an origin — both
              are customs facts a seller would act on.
            */
            meta={
              variants.data === undefined ? undefined : (
                <>
                  <MetaChip tone="accent">
                    {variants.data.length} {variants.data.length === 1 ? 'variant' : 'variants'}
                  </MetaChip>
                  {variants.data.some((v) => v.status === 'ARCHIVED') && (
                    <MetaChip dot>
                      {variants.data.filter((v) => v.status === 'ARCHIVED').length} archived
                    </MetaChip>
                  )}
                </>
              )
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

          {/* ── The product's standing facts ──────────────────────────
                 Every one is a column on the product or a count of its
                 own variants. There is no per-product stock figure and
                 no cost anywhere, so there is no "units on hand" tile
                 and no margin — the catalogue LIST carries the stock
                 summary, which is the one place that number is real. */}
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Variants"
              icon={<Layers size={13} aria-hidden />}
              value={variants.data?.length ?? <span className="text-text-faint">—</span>}
              unit={variants.data === undefined ? undefined : 'SKUs'}
              tone="neutral"
              {...(variants.data === undefined
                ? {}
                : {
                    foot: [
                      {
                        label: 'Sellable',
                        value: variants.data.filter((v) => v.status === 'ACTIVE').length,
                      },
                      {
                        label: 'Archived',
                        value: variants.data.filter((v) => v.status === 'ARCHIVED').length,
                      },
                    ],
                  })}
            />
            <Stat
              label="Default weight"
              icon={<Boxes size={13} aria-hidden />}
              value={
                detail.data.defaultWeightGrams === null ? (
                  <span className="text-text-faint text-base">Not set</span>
                ) : (
                  detail.data.defaultWeightGrams
                )
              }
              unit={detail.data.defaultWeightGrams === null ? undefined : 'g'}
              tone={detail.data.defaultWeightGrams === null ? 'warn' : 'neutral'}
              hint={
                detail.data.defaultWeightGrams === null
                  ? 'A variant that sets none then has none at all.'
                  : 'Used by any variant that sets none.'
              }
            />
            <Stat
              label="Default box"
              icon={<Ruler size={13} aria-hidden />}
              value={
                detail.data.defaultLengthCm === null ? (
                  <span className="text-text-faint text-base">Not set</span>
                ) : (
                  <span className="font-mono text-base">
                    {detail.data.defaultLengthCm} × {detail.data.defaultWidthCm ?? '—'} ×{' '}
                    {detail.data.defaultHeightCm ?? '—'}
                  </span>
                )
              }
              unit={detail.data.defaultLengthCm === null ? undefined : 'cm'}
              tone="neutral"
            />
            <Stat
              label="Declared value"
              icon={<Wallet size={13} aria-hidden />}
              value={
                detail.data.defaultDeclaredValueInr === null ? (
                  <span className="text-text-faint text-base">Not set</span>
                ) : (
                  <Money amount={detail.data.defaultDeclaredValueInr} />
                )
              }
              tone="neutral"
              hint="What a parcel of this is worth for customs."
            />
          </div>

          <div>
            <SectionBand
              index="01"
              title="Details"
              note="The defaults every variant inherits."
              action={
                !editing && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                      Edit product
                    </Button>
                    {/* ARCHIVED blocks new orders and stock receiving while
                        leaving history intact — the normal way to stop
                        selling something. Delete is deliberately not
                        offered: it hides the row from read paths, which is
                        a bigger hammer and staff-recoverable only. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={archive.isPending}
                      onClick={() => void onToggleArchive()}
                    >
                      {archive.isPending
                        ? 'Saving…'
                        : isArchived
                          ? 'Restore product'
                          : 'Archive product'}
                    </Button>
                  </>
                )
              }
            />
            <BandBody className="mb-4">
              {editing ? (
                <ProductEditForm
                  product={detail.data}
                  onCancel={() => setEditing(false)}
                  onSaved={() => setEditing(false)}
                />
              ) : (
                <ProductReadCard product={detail.data} />
              )}
            </BandBody>
          </div>

          <div>
            <SectionBand
              index="02"
              title="Variants"
              note={
                variants.data === undefined
                  ? undefined
                  : `${variants.data.length} ${variants.data.length === 1 ? 'SKU' : 'SKUs'}`
              }
              action={
                addingVariant ? undefined : (
                  <Button variant="secondary" size="sm" onClick={() => setAddingVariant(true)}>
                    Add variant
                  </Button>
                )
              }
            />
            <BandBody flush>
              {addingVariant && (
                <div className="border-border border-b p-3">
                  <AddVariantPanel productId={productId} onDone={() => setAddingVariant(false)} />
                </div>
              )}
              {variants.isLoading ? (
                <div className="p-3">
                  <LoadingState label="Loading variants…" />
                </div>
              ) : variants.isError ? (
                <div className="p-3">
                  <ErrorState
                    message={variants.error?.message ?? 'Failed to load variants.'}
                    retry={() => void variants.refetch()}
                  />
                </div>
              ) : !variants.data || variants.data.length === 0 ? (
                <div className="p-3">
                  <EmptyState
                    title="No variants yet"
                    description="A product needs at least one variant before it can be ordered — nothing can be stocked or picked against the product itself."
                    action={
                      <Button variant="primary" size="md" onClick={() => setAddingVariant(true)}>
                        Add variant
                      </Button>
                    }
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <Tr>
                      <Th className="w-12" aria-label="Image" />
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
                        onActivate={() => router.push(`/products/${productId}/variants/${v.id}`)}
                      >
                        <Td>
                          {/* A colour is something you recognise by looking.
                            Without this the seller decodes AVIATO-GREE-BLAC
                            to find the green one. */}
                          {v.primaryImageUrl != null ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={v.primaryImageUrl}
                              alt=""
                              className="border-border h-9 w-9 rounded-[4px] border object-cover"
                            />
                          ) : (
                            <div
                              className="border-border bg-surface-raised h-9 w-9 rounded-[4px] border"
                              aria-hidden
                            />
                          )}
                        </Td>
                        <Td>
                          <Link
                            href={`/products/${productId}/variants/${v.id}`}
                            className="text-text-bright hover:underline font-mono text-xs"
                          >
                            {v.skuCode}
                          </Link>
                        </Td>
                        <Td className="text-text-body">{v.variantLabel ?? '—'}</Td>
                        {/*
                        The EFFECTIVE weight, not the variant's own column.
                        A blank variant weight means "inherit the product
                        default" (M4: `variant.weightGrams ??
                        product.defaultWeightGrams`), so printing the raw
                        null as "—" told the seller no weight was set while
                        the courier would in fact bill on the product's
                        500g. Inherited values are marked as inherited
                        rather than silently shown as the variant's own.
                      */}
                        <Td align="right" className="font-mono text-xs">
                          {v.weightGrams !== null ? (
                            <span className="text-text-body">{v.weightGrams}</span>
                          ) : detail.data?.defaultWeightGrams != null ? (
                            // The product default, shown plainly. It IS the
                            // weight this variant ships at, so dressing it up
                            // as second-class only invites the question the
                            // dash used to raise.
                            <span className="text-text-body" title="From the product default">
                              {detail.data.defaultWeightGrams}
                            </span>
                          ) : (
                            <span className="text-text-muted">—</span>
                          )}
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
            </BandBody>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The product's own columns, read-only.
 *
 * No `Card`: `BandBody` IS the bordered surface the band above caps,
 * and nesting one drew a second border a hair inside the first.
 */
function ProductReadCard({ product }: { product: SellerProductView }): ReactElement {
  return (
    <DescriptionList
      columns={2}
      items={[
        ...(product.description
          ? [
              {
                label: 'Description',
                value: <span className="whitespace-pre-wrap">{product.description}</span>,
              },
            ]
          : []),
        {
          label: 'Your reference',
          value:
            product.externalRef === null ? (
              <Dash />
            ) : (
              <span className="font-mono text-xs">{product.externalRef}</span>
            ),
        },
        {
          label: 'Default weight',
          value:
            product.defaultWeightGrams === null ? (
              <Dash />
            ) : (
              <span className="font-mono">{product.defaultWeightGrams} g</span>
            ),
        },
        {
          label: 'Default box (L × W × H)',
          value:
            product.defaultLengthCm === null ? (
              <Dash />
            ) : (
              <span className="font-mono text-xs">
                {product.defaultLengthCm} × {product.defaultWidthCm ?? '—'} ×{' '}
                {product.defaultHeightCm ?? '—'} cm
              </span>
            ),
        },
        {
          label: 'Default declared value',
          value:
            product.defaultDeclaredValueInr === null ? (
              <Dash />
            ) : (
              <Money amount={product.defaultDeclaredValueInr} />
            ),
        },
      ]}
    />
  );
}

function Dash(): ReactElement {
  return <span className="text-text-faint">—</span>;
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
  // The dimensions were settable at CREATE, shown in the read view, and
  // absent from this form — so a product created with the wrong box size
  // could never be corrected from any screen. They come back as fields
  // rather than being dropped from the read view, because the courier
  // bills on volumetric weight where it exceeds the actual.
  const [defaultLength, setDefaultLength] = useState(product.defaultLengthCm ?? '');
  const [defaultWidth, setDefaultWidth] = useState(product.defaultWidthCm ?? '');
  const [defaultHeight, setDefaultHeight] = useState(product.defaultHeightCm ?? '');
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
        defaultLengthCm: defaultLength === '' ? null : Number(defaultLength),
        defaultWidthCm: defaultWidth === '' ? null : Number(defaultWidth),
        defaultHeightCm: defaultHeight === '' ? null : Number(defaultHeight),
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
        <FormField label="Default length (cm)" htmlFor="defaultLength">
          <Input
            id="defaultLength"
            type="number"
            min="0"
            step="0.1"
            value={defaultLength}
            onChange={(e) => setDefaultLength(e.target.value)}
            disabled={update.isPending}
          />
        </FormField>
        <FormField label="Default width (cm)" htmlFor="defaultWidth">
          <Input
            id="defaultWidth"
            type="number"
            min="0"
            step="0.1"
            value={defaultWidth}
            onChange={(e) => setDefaultWidth(e.target.value)}
            disabled={update.isPending}
          />
        </FormField>
        <FormField label="Default height (cm)" htmlFor="defaultHeight">
          <Input
            id="defaultHeight"
            type="number"
            min="0"
            step="0.1"
            value={defaultHeight}
            onChange={(e) => setDefaultHeight(e.target.value)}
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
  );
}
