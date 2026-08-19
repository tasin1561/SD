'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Button, Card, CardBody, FormField, Input, Select, useToast } from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import {
  useCreateOrder,
  useProductsList,
  useProductVariants,
  useSubmitOrder,
} from '@/lib/api-hooks';
import { useSellerIdentity } from '@skydrop/auth/client';
import {
  ADDRESS_LINE_1_HINT,
  ADDRESS_LINE_2_HINT,
  DUPLICATE_LINES_ERROR,
  linesAreDuplicated,
} from '@/lib/address-guidance';
import { prefixHint } from '@/lib/seller-prefix';
import { CustomerHistoryPanel } from './customer-history-panel';
import { DuplicateOrderDialog, type DuplicateCandidate } from './duplicate-order-dialog';
import {
  IN_DIAL,
  IN_LOCAL_LENGTH,
  IN_PHONE_ERROR,
  isCompleteLocal,
  sanitiseLocal,
  toE164,
  toLocalDigits,
} from '@/lib/phone';

/**
 * Manual order form.
 *
 * Locked decisions:
 *   - MANY products, each with its own variant and quantity. This was one
 *     product for a long time, on the stated grounds that "multi-line is
 *     ORD-9 phase-2" — but ORD-9 governs CSV IMPORT ("one row = one
 *     order, single line"), and `CreateOrderDto.items` has carried
 *     `@ArrayMinSize(1) @ArrayMaxSize(200)` since M6. The restriction was
 *     never in the backend; a customer buying two things simply could not
 *     be entered by hand.
 *   - The submitted payload mirrors the server's CreateOrderDto
 *     exactly. Server-side rejection (validation, address validity,
 *     unknown variant, etc.) surfaces verbatim via FE-2.
 *   - Two action buttons:
 *       "Save as draft" → POST /seller/orders (status DRAFT).
 *       "Submit for confirmation" → POST then POST /:id/submit, which
 *       enqueues the new order for the call centre.
 *     A success on either path navigates to the order detail page +
 *     fires a toast.
 */

interface FormState {
  recipientName: string;
  recipientPhoneE164: string;
  recipientAddressLine1: string;
  recipientAddressLine2: string;
  recipientPostalCode: string;
  paymentMode: 'COD' | 'PREPAID';
  codAmountInr: string;
  declaredValueInr: string;
  totalWeightGrams: string;
  sellerOrderRef: string;
  sellerNotes: string;
}

/**
 * One line of the order. `key` is a client-side identity so React can
 * keep inputs stable across add/remove — the variant id cannot serve,
 * because a freshly added row has none yet and two rows may briefly
 * share the empty string.
 */
interface ItemDraft {
  readonly key: number;
  productId: string;
  variantId: string;
  quantity: string;
  unitPriceInr: string;
}

const MAX_ITEMS = 50;

function emptyItem(key: number): ItemDraft {
  return { key, productId: '', variantId: '', quantity: '1', unitPriceInr: '' };
}

const INITIAL: FormState = {
  recipientName: '',
  recipientPhoneE164: IN_DIAL,
  recipientAddressLine1: '',
  recipientAddressLine2: '',
  recipientPostalCode: '',
  paymentMode: 'PREPAID',
  codAmountInr: '',
  declaredValueInr: '',
  totalWeightGrams: '',
  sellerOrderRef: '',
  sellerNotes: '',
};

export function NewOrderForm(): ReactElement {
  const sellerInitials = useSellerIdentity()?.initials ?? null;
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [items, setItems] = useState<readonly ItemDraft[]>([emptyItem(0)]);
  const nextKey = useRef(1);
  const [error, setError] = useState<string | null>(null);
  // The server decides whether this is a duplicate; the dialog only
  // relays its answer and collects the acknowledgement (FE-2 — the UI
  // never pre-empts a server guardrail with its own copy of the rule).
  const [duplicates, setDuplicates] = useState<ReadonlyArray<DuplicateCandidate> | null>(null);
  const [pendingAction, setPendingAction] = useState<'draft' | 'submit' | null>(null);
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);

  const create = useCreateOrder();
  const submit = useSubmitOrder();

  // Load a large-enough product page for picker UX. Sellers with
  // >200 products will need search; for Phase 1A 200 is plenty.
  // 100 is the endpoint's maximum; asking for 200 is a 400, which left
  // the product picker empty with no explanation. A seller with more
  // than 100 active products needs a search-as-you-type picker rather
  // than a bigger page — noted rather than papered over.
  const products = useProductsList({ status: 'ACTIVE', page: 1, pageSize: 100 });

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((p) => ({ ...p, [key]: value }));
  }

  function patchItem(key: number, patch: Partial<ItemDraft>): void {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function addItem(): void {
    setItems((prev) => (prev.length >= MAX_ITEMS ? prev : [...prev, emptyItem(nextKey.current++)]));
  }

  function removeItem(key: number): void {
    // Never below one line. An order with no items is a 400 the seller
    // would have to decode; an always-present empty row says what to do.
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((it) => it.key !== key)));
  }

  function validate(): string | null {
    if (!form.recipientName.trim()) return 'Recipient name is required.';
    if (!isCompleteLocal(toLocalDigits(form.recipientPhoneE164))) return IN_PHONE_ERROR;
    if (!form.recipientAddressLine1.trim()) return 'Address line 1 is required.';
    if (!form.recipientAddressLine2.trim()) return 'Address line 2 (the landmark) is required.';
    // Advisory, NOT a mirror of a server rule — the API has no such
    // check, so a CSV import still gets through. It is here because
    // duplicated lines get the order held by hand downstream, and
    // finding that out at the field beats finding it out afterwards.
    if (linesAreDuplicated(form.recipientAddressLine1, form.recipientAddressLine2))
      return DUPLICATE_LINES_ERROR;
    if (!/^[1-9]\d{5}$/.test(form.recipientPostalCode.trim()))
      return 'PIN must be 6 digits (first digit 1-9).';
    if (form.paymentMode === 'COD' && (!form.codAmountInr || Number(form.codAmountInr) <= 0))
      return 'COD amount is required when payment mode is COD.';
    for (const [i, it] of items.entries()) {
      const n = items.length === 1 ? '' : ` on product ${i + 1}`;
      if (!it.productId) return `Pick a product${n}.`;
      if (!it.variantId) return `Pick a variant${n}.`;
      const qty = Number(it.quantity);
      if (!Number.isFinite(qty) || qty < 1) return `Quantity must be at least 1${n}.`;
    }
    // Advisory, NOT a mirror of a server rule — the API happily accepts
    // the same variant on two lines. It is here because two lines of one
    // SKU is a slip in every case we can think of, and the picker has no
    // other way to say "you already added this".
    const picked = items.map((it) => it.variantId);
    if (new Set(picked).size !== picked.length)
      return 'The same variant is on more than one line — raise its quantity instead.';
    return null;
  }

  function buildBody(acknowledgeDuplicate = false) {
    const body: Parameters<typeof create.mutate>[0] = {
      recipientName: form.recipientName.trim(),
      recipientPhoneE164: form.recipientPhoneE164.trim(),
      recipientAddressLine1: form.recipientAddressLine1.trim(),
      recipientAddressLine2: form.recipientAddressLine2.trim(),
      recipientPostalCode: form.recipientPostalCode.trim(),
      paymentMode: form.paymentMode,
      items: items.map((it) => ({
        variantId: it.variantId,
        quantity: Number(it.quantity),
        ...(it.unitPriceInr.trim() ? { unitPriceInr: Number(it.unitPriceInr) } : {}),
      })),
      ...(form.paymentMode === 'COD' ? { codAmountInr: Number(form.codAmountInr) } : {}),
      ...(form.declaredValueInr.trim() ? { declaredValueInr: Number(form.declaredValueInr) } : {}),
      ...(form.totalWeightGrams.trim() ? { totalWeightGrams: Number(form.totalWeightGrams) } : {}),
      ...(form.sellerOrderRef.trim() ? { sellerOrderRef: form.sellerOrderRef.trim() } : {}),
      ...(form.sellerNotes.trim() ? { sellerNotes: form.sellerNotes.trim() } : {}),
      ...(acknowledgeDuplicate ? { acknowledgeDuplicate: true } : {}),
    };
    return body;
  }

  async function go(
    action: 'draft' | 'submit',
    e: FormEvent | null,
    acknowledgeDuplicate = false,
  ): Promise<void> {
    e?.preventDefault();
    setError(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setBusy(action);
    try {
      const created = await create.mutateAsync(buildBody(acknowledgeDuplicate));
      if (action === 'submit') {
        await submit.mutateAsync({ id: created.id });
        toast.success(`Order ${created.orderNumber} submitted for confirmation.`);
      } else {
        toast.success(`Draft order ${created.orderNumber} saved.`);
      }
      setDuplicates(null);
      router.push(`/orders/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        const b = err.body as {
          code?: unknown;
          message?: unknown;
          details?: { existingOrders?: unknown };
        } | null;
        const code = typeof b?.code === 'string' ? b.code : null;
        const msg = typeof b?.message === 'string' ? b.message : err.message;
        // The one refusal that gets a conversation rather than a
        // verdict: the seller has to be able to SEE what they would be
        // duplicating, because the question is "is this the same order?"
        if (code === 'DUPLICATE_ORDER_SUSPECTED' && Array.isArray(b?.details?.existingOrders)) {
          setDuplicates(b.details.existingOrders as ReadonlyArray<DuplicateCandidate>);
          setPendingAction(action);
          setBusy(null);
          return;
        }
        setError(code ? `[${code}] ${msg}` : msg);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to create order.');
      }
      setBusy(null);
    }
  }

  return (
    <form className="space-y-4" onSubmit={(e) => void go('submit', e)}>
      {/* Who they are shipping to — rendered ABOVE the form, because a
          warning read after the address has been typed is a warning read
          too late. Renders nothing for a first-time customer. */}
      <CustomerHistoryPanel phoneE164={form.recipientPhoneE164} />

      {/* Recipient */}
      <Card>
        <CardBody>
          <h2 className="text-text-bright text-sm font-medium mb-3">Recipient</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Full name" required hint={prefixHint(sellerInitials)}>
              {/* The seller code is CHROME, exactly like the +91 below:
                  it cannot be edited or deleted, and the field holds only
                  the customer's name. The API composes the stored value,
                  so a CSV import lands the same shape as this form. */}
              <div className="flex items-stretch">
                {sellerInitials !== null && sellerInitials !== '' && (
                  <span
                    aria-hidden
                    className="border-border-strong text-text-muted inline-flex select-none items-center rounded-l-[6px] border border-r-0 px-2.5 text-sm"
                  >
                    {sellerInitials}
                  </span>
                )}
                <Input
                  className={
                    sellerInitials !== null && sellerInitials !== '' ? 'rounded-l-none' : undefined
                  }
                  value={form.recipientName}
                  onChange={(e) => set('recipientName', e.target.value)}
                  maxLength={160}
                  required
                />
              </div>
            </FormField>
            <FormField
              label="Phone"
              required
              hint={`${IN_DIAL} — ${IN_LOCAL_LENGTH} digits, starting 6-9`}
            >
              {/* The dial code is CHROME, not input: it cannot be edited
                  or deleted, so a seller cannot clear it, type 0091, or
                  paste a differently-formatted number into it. The field
                  itself holds only the ten national digits. */}
              <div className="flex items-stretch">
                <span
                  aria-hidden
                  className="border-border-strong text-text-muted inline-flex select-none items-center rounded-l-[6px] border border-r-0 px-2.5 text-sm"
                >
                  {IN_DIAL}
                </span>
                <Input
                  className="rounded-l-none"
                  value={toLocalDigits(form.recipientPhoneE164)}
                  onChange={(e) => set('recipientPhoneE164', toE164(sanitiseLocal(e.target.value)))}
                  // inputMode drives the numeric keypad on a phone; the
                  // sanitiser is what actually enforces digits, because a
                  // paste bypasses the keypad entirely.
                  inputMode="numeric"
                  autoComplete="tel-national"
                  maxLength={IN_LOCAL_LENGTH}
                  placeholder="9812345678"
                  aria-label={`Phone number, ${IN_DIAL} then ${IN_LOCAL_LENGTH} digits`}
                  required
                />
              </div>
            </FormField>
            <FormField
              label="Address line 1"
              required
              className="col-span-2"
              hint={ADDRESS_LINE_1_HINT}
            >
              <Input
                value={form.recipientAddressLine1}
                onChange={(e) => set('recipientAddressLine1', e.target.value)}
                maxLength={200}
                required
              />
            </FormField>
            <FormField
              label="Address line 2"
              required
              className="col-span-2"
              hint={ADDRESS_LINE_2_HINT}
              error={
                linesAreDuplicated(form.recipientAddressLine1, form.recipientAddressLine2)
                  ? DUPLICATE_LINES_ERROR
                  : undefined
              }
            >
              <Input
                value={form.recipientAddressLine2}
                onChange={(e) => set('recipientAddressLine2', e.target.value)}
                maxLength={200}
                required
              />
            </FormField>
            <FormField label="PIN code" required>
              <Input
                value={form.recipientPostalCode}
                onChange={(e) =>
                  set('recipientPostalCode', e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                placeholder="560001"
                inputMode="numeric"
                required
              />
            </FormField>
          </div>
        </CardBody>
      </Card>

      {/* Items */}
      <Card>
        <CardBody>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-text-bright text-sm font-medium">
              {items.length === 1 ? 'Product' : `Products (${items.length})`}
            </h2>
            <Button
              type="button"
              variant="secondary"
              onClick={addItem}
              disabled={items.length >= MAX_ITEMS}
            >
              Add another product
            </Button>
          </div>
          <div className="flex flex-col gap-4">
            {items.map((it, i) => (
              <ItemRow
                key={it.key}
                item={it}
                index={i}
                total={items.length}
                products={products.data?.items ?? []}
                productsLoading={products.isLoading}
                onPatch={patchItem}
                onRemove={removeItem}
              />
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Payment + physical */}
      <Card>
        <CardBody>
          <h2 className="text-text-bright text-sm font-medium mb-3">Payment &amp; physical</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Payment mode" required>
              <Select
                value={form.paymentMode}
                onChange={(e) => set('paymentMode', e.target.value as 'COD' | 'PREPAID')}
              >
                <option value="PREPAID">Prepaid</option>
                <option value="COD">Cash on Delivery</option>
              </Select>
            </FormField>
            {form.paymentMode === 'COD' && (
              <FormField label="COD amount (INR)" required>
                <Input
                  type="number"
                  min={0.01}
                  step="0.01"
                  value={form.codAmountInr}
                  onChange={(e) => set('codAmountInr', e.target.value)}
                  required
                />
              </FormField>
            )}
            <FormField label="Declared value (INR)">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.declaredValueInr}
                onChange={(e) => set('declaredValueInr', e.target.value)}
                placeholder="Defaults to sum of line item values"
              />
            </FormField>
            <FormField label="Total weight (grams)">
              <Input
                type="number"
                min={0}
                value={form.totalWeightGrams}
                onChange={(e) => set('totalWeightGrams', e.target.value)}
                placeholder="Defaults to sum of variant weights"
              />
            </FormField>
          </div>
        </CardBody>
      </Card>

      {/* Notes */}
      <Card>
        <CardBody>
          <h2 className="text-text-bright text-sm font-medium mb-3">Notes</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Your reference">
              <Input
                value={form.sellerOrderRef}
                onChange={(e) => set('sellerOrderRef', e.target.value)}
                maxLength={120}
                placeholder="Your own order ID (optional, must be unique)"
              />
            </FormField>
            <FormField label="Seller notes">
              <Input
                value={form.sellerNotes}
                onChange={(e) => set('sellerNotes', e.target.value)}
                placeholder="Anything the call agent should know"
              />
            </FormField>
          </div>
        </CardBody>
      </Card>

      {error && (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px]">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          size="md"
          disabled={busy !== null}
          onClick={() => router.push('/orders')}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="md"
          disabled={busy !== null}
          onClick={(e) => void go('draft', e)}
        >
          {busy === 'draft' ? 'Saving…' : 'Save as draft'}
        </Button>
        <Button type="submit" variant="primary" size="md" disabled={busy !== null}>
          {busy === 'submit' ? 'Submitting…' : 'Submit for confirmation'}
        </Button>
      </div>

      <DuplicateOrderDialog
        open={duplicates !== null}
        candidates={duplicates ?? []}
        busy={busy !== null}
        onCancel={() => {
          setDuplicates(null);
          setPendingAction(null);
        }}
        onConfirm={() => {
          const action = pendingAction ?? 'submit';
          setDuplicates(null);
          setPendingAction(null);
          void go(action, null, true);
        }}
      />
    </form>
  );
}

/**
 * One order line.
 *
 * A component rather than inline JSX because each row needs its OWN
 * variant list, and `useProductVariants` is a hook — it cannot be called
 * inside a map. Lifting one shared list would be wrong anyway: two rows
 * are usually two different products.
 */
function ItemRow({
  item,
  index,
  total,
  products,
  productsLoading,
  onPatch,
  onRemove,
}: {
  readonly item: ItemDraft;
  readonly index: number;
  readonly total: number;
  readonly products: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly productsLoading: boolean;
  readonly onPatch: (key: number, patch: Partial<ItemDraft>) => void;
  readonly onRemove: (key: number) => void;
}): ReactElement {
  const variants = useProductVariants(item.productId);
  const variantOptions = useMemo(
    () => variants.data?.filter((v) => v.status === 'ACTIVE') ?? [],
    [variants.data],
  );

  return (
    <div className="border-border-subtle rounded-[8px] border p-3">
      {total > 1 && (
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-text-muted text-xs font-medium">Product {index + 1}</span>
          <button
            type="button"
            onClick={() => onRemove(item.key)}
            className="text-text-muted hover:text-status-failed-fg text-xs underline"
          >
            Remove
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Product" required>
          <Select
            value={item.productId}
            // Clearing the variant is the point: a variant belongs to one
            // product, so keeping the old id would submit a line whose
            // SKU is not in the product the seller just chose.
            onChange={(e) => onPatch(item.key, { productId: e.target.value, variantId: '' })}
            required
            disabled={productsLoading}
          >
            <option value="">
              {productsLoading
                ? 'Loading products…'
                : products.length === 0
                  ? 'No products yet — add one in Products first.'
                  : 'Select a product'}
            </option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Variant" required>
          <Select
            value={item.variantId}
            onChange={(e) => onPatch(item.key, { variantId: e.target.value })}
            required
            disabled={!item.productId || variants.isLoading}
          >
            <option value="">
              {!item.productId
                ? 'Pick a product first'
                : variants.isLoading
                  ? 'Loading variants…'
                  : variantOptions.length === 0
                    ? 'No active variants'
                    : 'Select a variant'}
            </option>
            {variantOptions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.skuCode}
                {v.variantLabel ? ` — ${v.variantLabel}` : ''}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Quantity" required>
          <Input
            type="number"
            min={1}
            max={100000}
            value={item.quantity}
            onChange={(e) => onPatch(item.key, { quantity: e.target.value })}
            required
          />
        </FormField>
        <FormField label="Unit price (INR)">
          <Input
            type="number"
            min={0}
            step="0.01"
            value={item.unitPriceInr}
            onChange={(e) => onPatch(item.key, { unitPriceInr: e.target.value })}
            placeholder="Optional"
          />
        </FormField>
      </div>
    </div>
  );
}
