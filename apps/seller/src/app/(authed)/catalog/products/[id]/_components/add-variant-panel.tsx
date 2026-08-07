'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { Button, Card, CardBody, FormField, Input, useToast } from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import { useCreateVariant } from '@/lib/api-hooks';

/**
 * Add another variant to a product that already exists.
 *
 * Inline rather than its own route: the product is on screen, the seller
 * is adding a second size to it, and a page change would lose that
 * context for one short form. It is also a SINGLE call, unlike the
 * create-product flow — the product is already there, so there is no
 * half-created state to explain.
 *
 * Physical fields are omitted deliberately. A second variant usually
 * shares the first one's weight and dimensions, and the variant page
 * edits them; asking again here would make the common case longer to
 * serve the rare one.
 */
export function AddVariantPanel({
  productId,
  onDone,
}: {
  readonly productId: string;
  readonly onDone: () => void;
}): ReactElement {
  const toast = useToast();
  const createVariant = useCreateVariant(productId);
  const [skuCode, setSkuCode] = useState('');
  const [variantLabel, setVariantLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!skuCode.trim()) {
      setError('SKU is required.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await createVariant.mutateAsync({
        skuCode: skuCode.trim(),
        ...(variantLabel.trim() ? { variantLabel: variantLabel.trim() } : {}),
      });
      toast.success('Variant added.');
      setSkuCode('');
      setVariantLabel('');
      onDone();
    } catch (err) {
      // FE-2: the server's verdict verbatim — a duplicate SKU is its
      // call to make, not something guessed at from a stale list here.
      if (err instanceof ApiError) {
        const body = err.body as { code?: string; message?: string } | undefined;
        setError(body?.code ? `[${body.code}] ${body.message ?? err.message}` : err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-3">
      <CardBody>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
          {error !== null && (
            <div className="border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] text-critical rounded-md border px-3 py-2 text-sm">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="SKU" required hint="Unique across your catalogue, and permanent.">
              <Input
                value={skuCode}
                onChange={(e) => setSkuCode(e.target.value)}
                maxLength={120}
                required
              />
            </FormField>
            <FormField label="Variant label" hint="e.g. Blue / L">
              <Input
                value={variantLabel}
                onChange={(e) => setVariantLabel(e.target.value)}
                maxLength={120}
              />
            </FormField>
          </div>
          <p className="text-text-muted text-xs">
            Weight, dimensions and value are set on the variant once it exists — a second size
            usually shares the first one&rsquo;s.
          </p>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="md" disabled={busy}>
              {busy ? 'Adding…' : 'Add variant'}
            </Button>
            <Button type="button" variant="secondary" size="md" disabled={busy} onClick={onDone}>
              Cancel
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
