'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  FormField,
  Input,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import { useCreateProduct, useCreateVariant } from '@/lib/api-hooks';

/**
 * Add a product, with its first variant, in one step.
 *
 * ── WHY ONE FORM AND NOT TWO ─────────────────────────────────────────
 * A product with no variant cannot be ordered, received, or picked —
 * nothing downstream can reference it. Making them two separate screens
 * would let a seller stop halfway and leave a catalogue entry that looks
 * present and cannot be sold. The second colour or size is added from
 * the product page afterwards, where the product demonstrably exists.
 *
 * ── THE TWO-CALL PROBLEM, STATED ─────────────────────────────────────
 * The API has no combined endpoint, so this is POST product then POST
 * variant. If the variant call fails, the product is already created.
 * Rather than pretend otherwise, the failure says so and navigates to
 * the product — from where "Add variant" finishes the job. Silently
 * retrying or deleting the product would both be worse: one hides the
 * state, the other throws away a name the seller typed.
 *
 * Physical fields live on the VARIANT here. They can be set as product
 * defaults later; asking for both on a first-run form would be asking
 * the same question twice (M4 inheritance: variant → product.default*).
 */

interface FormState {
  name: string;
  externalRef: string;
  description: string;
  skuCode: string;
  variantLabel: string;
  weightGrams: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  declaredValueInr: string;
  hsCode: string;
}

const INITIAL: FormState = {
  name: '',
  externalRef: '',
  description: '',
  skuCode: '',
  variantLabel: '',
  weightGrams: '',
  lengthCm: '',
  widthCm: '',
  heightCm: '',
  declaredValueInr: '',
  hsCode: '',
};

/** A blank optional number must be OMITTED, not sent as 0 — a declared
 *  value of zero is a customs statement, not "unknown". */
function num(v: string): number | undefined {
  const t = v.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function text(v: string): string | undefined {
  const t = v.trim();
  return t === '' ? undefined : t;
}

export function NewProductForm(): ReactElement {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const createProduct = useCreateProduct();
  // productId is only known after the first call, so the hook is bound
  // lazily by passing the id at mutate time via a second instance.
  const [createdProductId, setCreatedProductId] = useState<string | null>(null);
  const createVariant = useCreateVariant(createdProductId ?? '');

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((p) => ({ ...p, [key]: value }));
  }

  function validate(): string | null {
    if (!form.name.trim()) return 'Product name is required.';
    if (!form.skuCode.trim())
      return 'SKU is required — it is how every order, pick and stock count refers to this item.';
    for (const [label, v] of [
      ['Weight', form.weightGrams],
      ['Length', form.lengthCm],
      ['Width', form.widthCm],
      ['Height', form.heightCm],
      ['Declared value', form.declaredValueInr],
    ] as const) {
      const t = v.trim();
      if (t !== '' && (!Number.isFinite(Number(t)) || Number(t) < 0)) {
        return `${label} must be a number of 0 or more.`;
      }
    }
    return null;
  }

  function fmtError(err: unknown): string {
    if (err instanceof ApiError) {
      const body = err.body as { code?: string; message?: string } | undefined;
      // FE-2: the server's verdict, verbatim.
      return body?.code ? `[${body.code}] ${body.message ?? err.message}` : err.message;
    }
    return err instanceof Error ? err.message : 'Something went wrong.';
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const bad = validate();
    if (bad !== null) {
      setError(bad);
      return;
    }
    setError(null);
    setBusy(true);

    let productId = createdProductId;
    try {
      // Skip re-creating the product if a previous attempt got that far
      // and only the variant failed — otherwise a retry leaves a
      // duplicate product behind every time.
      if (productId === null) {
        const product = await createProduct.mutateAsync({
          name: form.name.trim(),
          ...(text(form.externalRef) ? { externalRef: text(form.externalRef)! } : {}),
          ...(text(form.description) ? { description: text(form.description)! } : {}),
        });
        productId = product.id;
        setCreatedProductId(product.id);
      }
    } catch (err) {
      setError(fmtError(err));
      setBusy(false);
      return;
    }

    try {
      await createVariant.mutateAsync({
        skuCode: form.skuCode.trim(),
        ...(text(form.variantLabel) ? { variantLabel: text(form.variantLabel)! } : {}),
        ...(num(form.weightGrams) !== undefined ? { weightGrams: num(form.weightGrams)! } : {}),
        ...(num(form.lengthCm) !== undefined ? { lengthCm: num(form.lengthCm)! } : {}),
        ...(num(form.widthCm) !== undefined ? { widthCm: num(form.widthCm)! } : {}),
        ...(num(form.heightCm) !== undefined ? { heightCm: num(form.heightCm)! } : {}),
        ...(num(form.declaredValueInr) !== undefined
          ? { declaredValueInr: num(form.declaredValueInr)! }
          : {}),
        ...(text(form.hsCode) ? { hsCode: text(form.hsCode)! } : {}),
      });
      toast.success('Product created.');
      router.push(`/catalog/products/${productId}`);
    } catch (err) {
      // The product EXISTS at this point. Say so — a bare error here
      // would send the seller back to add it again.
      setError(
        `${fmtError(err)} — the product was created; fix the SKU and save again, or add the variant from the product page.`,
      );
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
      {error !== null && (
        <div className="border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] text-critical rounded-md border px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <Card>
        <CardBody>
          <h2 className="text-text-bright mb-3 text-sm font-medium">Product</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Product name" required className="col-span-2">
              <Input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                maxLength={200}
                required
              />
            </FormField>
            <FormField
              label="Your product ID"
              className="col-span-2"
              hint="Optional, and only worth setting if you import by CSV. A re-upload matches on the SKU first; this is what tells us a NEW size or colour belongs to this product rather than to a second product with the same name."
            >
              <Input
                value={form.externalRef}
                onChange={(e) => set('externalRef', e.target.value)}
                maxLength={120}
              />
            </FormField>
            <FormField label="Description" className="col-span-2">
              <Textarea
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                maxLength={4000}
                rows={3}
              />
            </FormField>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h2 className="text-text-bright mb-1 text-sm font-medium">First variant</h2>
          <p className="text-text-muted mb-3 text-xs">
            Every product needs at least one, because orders and stock are counted against the
            variant rather than the product. Add more sizes or colours from the product page.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              label="SKU"
              required
              hint="Unique across your catalogue, and permanent — it cannot be changed later."
            >
              <Input
                value={form.skuCode}
                onChange={(e) => set('skuCode', e.target.value)}
                maxLength={120}
                required
              />
            </FormField>
            <FormField label="Variant label" hint="e.g. Red / M. Leave blank if there is only one.">
              <Input
                value={form.variantLabel}
                onChange={(e) => set('variantLabel', e.target.value)}
                maxLength={120}
              />
            </FormField>
            <FormField
              label="Weight (g)"
              hint="What the courier bills on. Leaving it blank means the rate is estimated."
            >
              <Input
                inputMode="numeric"
                value={form.weightGrams}
                onChange={(e) => set('weightGrams', e.target.value)}
              />
            </FormField>
            <FormField label="Declared value (₹)" hint="Used for customs and for RTO write-offs.">
              <Input
                inputMode="decimal"
                value={form.declaredValueInr}
                onChange={(e) => set('declaredValueInr', e.target.value)}
              />
            </FormField>
            <FormField label="Length (cm)">
              <Input
                inputMode="decimal"
                value={form.lengthCm}
                onChange={(e) => set('lengthCm', e.target.value)}
              />
            </FormField>
            <FormField label="Width (cm)">
              <Input
                inputMode="decimal"
                value={form.widthCm}
                onChange={(e) => set('widthCm', e.target.value)}
              />
            </FormField>
            <FormField label="Height (cm)">
              <Input
                inputMode="decimal"
                value={form.heightCm}
                onChange={(e) => set('heightCm', e.target.value)}
              />
            </FormField>
            <FormField label="HS code" hint="Customs classification. Ask your freight contact.">
              <Input
                value={form.hsCode}
                onChange={(e) => set('hsCode', e.target.value)}
                maxLength={20}
              />
            </FormField>
          </div>
        </CardBody>
      </Card>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="md" disabled={busy}>
          {busy ? 'Saving…' : createdProductId !== null ? 'Retry variant' : 'Create product'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="md"
          disabled={busy}
          onClick={() => router.push('/catalog')}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
