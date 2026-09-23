'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Boxes,
  Layers,
  Pencil,
  Plus,
  Ruler,
  Wallet,
} from 'lucide-react';
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
import { Money } from '@skydrop/ui/components';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
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
  MetaFacts,
  Panel,
  PanelPad,
  mutationPhase,
  rawCount,
} from '@/app/(authed)/inventory/_components/stock-ui';
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

  // Archive and restore both ASK first, restating the product and what
  // follows. The request is the same one the button always sent; a
  // refusal stays in the dialog, verbatim (FE-2), so it can be retried.
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  async function onToggleArchive(): Promise<void> {
    setArchiveError(null);
    try {
      await archive.mutateAsync({ archived: !isArchived });
      toast.success(
        isArchived
          ? 'Restored. Its variants stay archived — restore the ones you want back.'
          : 'Archived. It and its variants can no longer be ordered or received.',
      );
    } catch (err) {
      setArchiveError(serverVerdict(err));
      throw err;
    }
  }

  const statusChip = (status: string): ReactElement => (
    <StatusChip
      kind={status === 'ACTIVE' ? 'confirmed' : status === 'ARCHIVED' ? 'cancelled' : 'pending'}
      label={status.toLowerCase()}
      size="sm"
    />
  );

  return (
    <AreaPage>
      <BackLink href="/products">
        <ArrowLeft size={14} /> Products
      </BackLink>

      {detail.isLoading ? (
        <SkeletonRows rows={6} label="Loading product…" />
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
            breadcrumbs={[
              { label: 'Seller console' },
              { label: 'Products', href: '/products' },
              { label: detail.data.name },
            ]}
            Link={Link}
            title={detail.data.name}
            subtitle={
              detail.data.externalRef ? (
                <span>
                  Your ref: <span className="sk-ident">{detail.data.externalRef}</span>
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
                <MetaFacts>
                  <MetaFact tone="accent">
                    {variants.data.length} {variants.data.length === 1 ? 'variant' : 'variants'}
                  </MetaFact>
                  {variants.data.some((v) => v.status === 'ARCHIVED') && (
                    <MetaFact dot>
                      {variants.data.filter((v) => v.status === 'ARCHIVED').length} archived
                    </MetaFact>
                  )}
                </MetaFacts>
              )
            }
            action={statusChip(detail.data.status)}
          />

          {/* ── The product's standing facts ──────────────────────────
                 Every one is a column on the product or a count of its
                 own variants. There is no per-product stock figure and
                 no cost anywhere, so there is no "units on hand" tile
                 and no margin — the catalogue LIST carries the stock
                 summary, which is the one place that number is real. */}
          <KpiGrid>
            {variants.data === undefined ? (
              <KpiCard
                label="Variants"
                icon={<Layers size={14} />}
                figure={<Dash />}
                tone="neutral"
              />
            ) : (
              <KpiCard
                label="Variants"
                icon={<Layers size={14} />}
                value={variants.data.length}
                format={rawCount}
                unit="SKUs"
                tone="neutral"
                foot={[
                  {
                    label: 'Sellable',
                    value: variants.data.filter((v) => v.status === 'ACTIVE').length,
                  },
                  {
                    label: 'Archived',
                    value: variants.data.filter((v) => v.status === 'ARCHIVED').length,
                  },
                ]}
              />
            )}
            {detail.data.defaultWeightGrams === null ? (
              <KpiCard
                label="Default weight"
                icon={<Boxes size={14} />}
                figure={<span className="inv-faint">Not set</span>}
                tone="pending"
                hint="A variant that sets none then has none at all."
              />
            ) : (
              <KpiCard
                label="Default weight"
                icon={<Boxes size={14} />}
                value={detail.data.defaultWeightGrams}
                format={rawCount}
                unit="g"
                tone="neutral"
                hint="Used by any variant that sets none."
              />
            )}
            <KpiCard
              label="Default box"
              icon={<Ruler size={14} />}
              figure={
                detail.data.defaultLengthCm === null ? (
                  <span className="inv-faint">Not set</span>
                ) : (
                  <span>
                    {detail.data.defaultLengthCm} × {detail.data.defaultWidthCm ?? '—'} ×{' '}
                    {detail.data.defaultHeightCm ?? '—'}
                  </span>
                )
              }
              {...(detail.data.defaultLengthCm === null ? {} : { unit: 'cm' })}
              tone="neutral"
            />
            <KpiCard
              label="Declared value"
              icon={<Wallet size={14} />}
              figure={
                detail.data.defaultDeclaredValueInr === null ? (
                  <span className="inv-faint">Not set</span>
                ) : (
                  <Money amount={detail.data.defaultDeclaredValueInr} />
                )
              }
              tone="neutral"
              hint="What a parcel of this is worth for customs."
            />
          </KpiGrid>

          <AreaSection
            title="Details"
            note="The defaults every variant inherits."
            action={
              !editing && (
                <Actions>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Pencil size={14} />}
                    onClick={() => setEditing(true)}
                  >
                    Edit product
                  </Button>
                  {/* ARCHIVED blocks new orders and stock receiving while
                      leaving history intact — the normal way to stop
                      selling something. Delete is deliberately not
                      offered: it hides the row from read paths, which is
                      a bigger hammer and staff-recoverable only. */}
                  <AsyncButton
                    variant="ghost"
                    size="sm"
                    icon={isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                    labels={{
                      idle: isArchived ? 'Restore product' : 'Archive product',
                      busy: 'Saving…',
                    }}
                    state={mutationPhase(archive)}
                    disabled={archive.isPending}
                    onClick={() => {
                      setArchiveError(null);
                      setConfirmArchive(true);
                    }}
                  />
                </Actions>
              )
            }
          >
            <Panel>
              {editing ? (
                <ProductEditForm
                  product={detail.data}
                  onCancel={() => setEditing(false)}
                  onSaved={() => setEditing(false)}
                />
              ) : (
                <ProductReadCard product={detail.data} />
              )}
            </Panel>
          </AreaSection>

          <ConfirmDialog
            open={confirmArchive}
            onOpenChange={setConfirmArchive}
            title={isArchived ? 'Restore this product?' : 'Archive this product?'}
            entity={
              detail.data.externalRef
                ? `${detail.data.name} · ${detail.data.externalRef}`
                : detail.data.name
            }
            consequence={
              isArchived
                ? 'It can be ordered and received again. Its variants stay archived — restore the ones you want back.'
                : 'It and its variants can no longer be ordered or received. History stays, and you can restore it later.'
            }
            confirmLabel={isArchived ? 'Restore product' : 'Archive product'}
            destructive={!isArchived}
            error={archiveError ?? undefined}
            onConfirm={onToggleArchive}
          />

          <AreaSection
            title="Variants"
            note={
              variants.data === undefined
                ? undefined
                : `${variants.data.length} ${variants.data.length === 1 ? 'SKU' : 'SKUs'}`
            }
            action={
              addingVariant ? undefined : (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={14} />}
                  onClick={() => setAddingVariant(true)}
                >
                  Add variant
                </Button>
              )
            }
          >
            <Panel flush>
              {addingVariant && (
                <PanelPad>
                  <AddVariantPanel productId={productId} onDone={() => setAddingVariant(false)} />
                </PanelPad>
              )}
              {variants.isLoading ? (
                <PanelPad>
                  <SkeletonRows rows={3} cols={5} label="Loading variants…" />
                </PanelPad>
              ) : variants.isError ? (
                <PanelPad>
                  <ErrorState
                    message={variants.error?.message ?? 'Failed to load variants.'}
                    retry={() => void variants.refetch()}
                  />
                </PanelPad>
              ) : !variants.data || variants.data.length === 0 ? (
                <PanelPad>
                  <EmptyState
                    bare
                    title="No variants yet"
                    description="A product needs at least one variant before it can be ordered — nothing can be stocked or picked against the product itself."
                    action={
                      <Button
                        variant="primary"
                        size="md"
                        icon={<Plus size={15} />}
                        onClick={() => setAddingVariant(true)}
                      >
                        Add variant
                      </Button>
                    }
                  />
                </PanelPad>
              ) : (
                <Table caption="Variants">
                  <THead>
                    <Tr>
                      <Th aria-label="Image" />
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
                            <img src={v.primaryImageUrl} alt="" className="prd-thumb" />
                          ) : (
                            <div className="prd-thumb" aria-hidden />
                          )}
                        </Td>
                        <Td>
                          <Link
                            href={`/products/${productId}/variants/${v.id}`}
                            className="inv-strong-link sk-ident"
                          >
                            {v.skuCode}
                          </Link>
                        </Td>
                        <Td>{v.variantLabel ?? '—'}</Td>
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
                        <Td align="right" className="sk-figure">
                          {v.weightGrams !== null ? (
                            <span>{v.weightGrams}</span>
                          ) : detail.data?.defaultWeightGrams != null ? (
                            // The product default, shown plainly. It IS the
                            // weight this variant ships at, so dressing it up
                            // as second-class only invites the question the
                            // dash used to raise.
                            <span title="From the product default">
                              {detail.data.defaultWeightGrams}
                            </span>
                          ) : (
                            <span className="inv-muted">—</span>
                          )}
                        </Td>
                        <Td>{statusChip(v.status)}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </Panel>
          </AreaSection>
        </>
      )}
    </AreaPage>
  );
}

/**
 * The product's own columns, read-only.
 *
 * No card of its own: the section's panel IS the surface, and nesting
 * one drew a second border a hair inside the first.
 */
function ProductReadCard({ product }: { product: SellerProductView }): ReactElement {
  return (
    <Facts
      columns={2}
      items={[
        ...(product.description
          ? [
              {
                label: 'Description',
                value: <span style={{ whiteSpace: 'pre-wrap' }}>{product.description}</span>,
              },
            ]
          : []),
        {
          label: 'Your reference',
          value:
            product.externalRef === null ? (
              <Dash />
            ) : (
              <span className="sk-ident">{product.externalRef}</span>
            ),
        },
        {
          label: 'Default weight',
          value:
            product.defaultWeightGrams === null ? (
              <Dash />
            ) : (
              <span className="sk-figure">{product.defaultWeightGrams} g</span>
            ),
        },
        {
          label: 'Default box (L × W × H)',
          value:
            product.defaultLengthCm === null ? (
              <Dash />
            ) : (
              <span className="sk-figure">
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
    <form onSubmit={handleSave} className="inv-stack">
      <FieldGrid columns={2}>
        <TextField
          label="Name"
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={update.isPending}
        />
      </FieldGrid>
      <TextArea
        label="Description"
        id="description"
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={update.isPending}
      />
      <FieldGrid columns={3}>
        <TextField
          label="External ref"
          id="externalRef"
          value={externalRef}
          onChange={(e) => setExternalRef(e.target.value)}
          disabled={update.isPending}
          inputClassName="sk-ident"
        />
        <TextField
          label="Default weight (g)"
          id="defaultWeight"
          type="number"
          min="0"
          value={defaultWeight}
          onChange={(e) => setDefaultWeight(e.target.value)}
          disabled={update.isPending}
        />
        <TextField
          label="Default length (cm)"
          id="defaultLength"
          type="number"
          min="0"
          step="0.1"
          value={defaultLength}
          onChange={(e) => setDefaultLength(e.target.value)}
          disabled={update.isPending}
        />
        <TextField
          label="Default width (cm)"
          id="defaultWidth"
          type="number"
          min="0"
          step="0.1"
          value={defaultWidth}
          onChange={(e) => setDefaultWidth(e.target.value)}
          disabled={update.isPending}
        />
        <TextField
          label="Default height (cm)"
          id="defaultHeight"
          type="number"
          min="0"
          step="0.1"
          value={defaultHeight}
          onChange={(e) => setDefaultHeight(e.target.value)}
          disabled={update.isPending}
        />
        <TextField
          label="Default declared (INR)"
          id="defaultDeclared"
          type="number"
          step="0.01"
          value={defaultDeclared}
          onChange={(e) => setDefaultDeclared(e.target.value)}
          disabled={update.isPending}
        />
      </FieldGrid>
      {serverError && <InlineError message={serverError} />}
      <Actions>
        <AsyncButton
          type="submit"
          variant="primary"
          labels={{ idle: 'Save changes', busy: 'Saving…' }}
          state={mutationPhase(update)}
        />
        <Button variant="ghost" onClick={onCancel} disabled={update.isPending}>
          Cancel
        </Button>
      </Actions>
    </form>
  );
}
