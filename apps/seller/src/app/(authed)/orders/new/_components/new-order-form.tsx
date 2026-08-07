'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { Button, Card, CardBody, FormField, Input, Select, useToast } from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import {
  useCreateOrder,
  useProductsList,
  useProductVariants,
  useSubmitOrder,
} from '@/lib/api-hooks';
import { CustomerHistoryPanel } from './customer-history-panel';
import { DuplicateOrderDialog, type DuplicateCandidate } from './duplicate-order-dialog';

/**
 * Single-line manual order form.
 *
 * Locked decisions:
 *   - One product → one variant → one quantity. Multi-line is ORD-9
 *     phase-2; the UI can grow into a `lines: []` model when the
 *     backend lifts the single-line restriction.
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

const INDIAN_STATES: ReadonlyArray<string> = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
];

interface FormState {
  recipientName: string;
  recipientPhoneE164: string;
  recipientEmail: string;
  recipientAddressLine1: string;
  recipientAddressLine2: string;
  recipientLandmark: string;
  recipientCity: string;
  recipientStateProvince: string;
  recipientPostalCode: string;
  paymentMode: 'COD' | 'PREPAID';
  codAmountInr: string;
  declaredValueInr: string;
  totalWeightGrams: string;
  sellerOrderRef: string;
  sellerNotes: string;
  productId: string;
  variantId: string;
  quantity: string;
  unitPriceInr: string;
}

const INITIAL: FormState = {
  recipientName: '',
  recipientPhoneE164: '+91',
  recipientEmail: '',
  recipientAddressLine1: '',
  recipientAddressLine2: '',
  recipientLandmark: '',
  recipientCity: '',
  recipientStateProvince: '',
  recipientPostalCode: '',
  paymentMode: 'PREPAID',
  codAmountInr: '',
  declaredValueInr: '',
  totalWeightGrams: '',
  sellerOrderRef: '',
  sellerNotes: '',
  productId: '',
  variantId: '',
  quantity: '1',
  unitPriceInr: '',
};

export function NewOrderForm(): ReactElement {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(INITIAL);
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
  const variants = useProductVariants(form.productId);

  // Auto-pick the first variant when the product changes
  // (UX: the seller usually has one variant per product).
  const variantOptions = useMemo(
    () => variants.data?.filter((v) => v.status === 'ACTIVE') ?? [],
    [variants.data],
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((p) => ({ ...p, [key]: value }));
  }

  function onProductChange(id: string): void {
    setForm((p) => ({ ...p, productId: id, variantId: '' }));
  }

  function validate(): string | null {
    if (!form.recipientName.trim()) return 'Recipient name is required.';
    if (!/^\+[1-9]\d{6,14}$/.test(form.recipientPhoneE164.trim()))
      return 'Recipient phone must be E.164 (e.g. +919812345678).';
    if (!form.recipientAddressLine1.trim()) return 'Address line 1 is required.';
    if (!form.recipientCity.trim()) return 'City is required.';
    if (!form.recipientStateProvince.trim()) return 'State is required.';
    if (!/^[1-9]\d{5}$/.test(form.recipientPostalCode.trim()))
      return 'PIN must be 6 digits (first digit 1-9).';
    if (form.paymentMode === 'COD' && (!form.codAmountInr || Number(form.codAmountInr) <= 0))
      return 'COD amount is required when payment mode is COD.';
    if (!form.productId) return 'Pick a product.';
    if (!form.variantId) return 'Pick a variant.';
    const qty = Number(form.quantity);
    if (!Number.isFinite(qty) || qty < 1) return 'Quantity must be at least 1.';
    return null;
  }

  function buildBody(acknowledgeDuplicate = false) {
    const body: Parameters<typeof create.mutate>[0] = {
      recipientName: form.recipientName.trim(),
      recipientPhoneE164: form.recipientPhoneE164.trim(),
      recipientAddressLine1: form.recipientAddressLine1.trim(),
      recipientCity: form.recipientCity.trim(),
      recipientStateProvince: form.recipientStateProvince.trim(),
      recipientPostalCode: form.recipientPostalCode.trim(),
      paymentMode: form.paymentMode,
      items: [
        {
          variantId: form.variantId,
          quantity: Number(form.quantity),
          ...(form.unitPriceInr.trim() ? { unitPriceInr: Number(form.unitPriceInr) } : {}),
        },
      ],
      ...(form.recipientEmail.trim() ? { recipientEmail: form.recipientEmail.trim() } : {}),
      ...(form.recipientAddressLine2.trim()
        ? { recipientAddressLine2: form.recipientAddressLine2.trim() }
        : {}),
      ...(form.recipientLandmark.trim()
        ? { recipientLandmark: form.recipientLandmark.trim() }
        : {}),
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
            <FormField label="Full name" required>
              <Input
                value={form.recipientName}
                onChange={(e) => set('recipientName', e.target.value)}
                maxLength={160}
                required
              />
            </FormField>
            <FormField label="Phone (E.164)" required>
              <Input
                value={form.recipientPhoneE164}
                onChange={(e) => set('recipientPhoneE164', e.target.value)}
                placeholder="+919812345678"
                required
              />
            </FormField>
            <FormField label="Email">
              <Input
                type="email"
                value={form.recipientEmail}
                onChange={(e) => set('recipientEmail', e.target.value)}
              />
            </FormField>
            <FormField label="Address line 1" required className="col-span-2">
              <Input
                value={form.recipientAddressLine1}
                onChange={(e) => set('recipientAddressLine1', e.target.value)}
                maxLength={200}
                required
              />
            </FormField>
            <FormField label="Address line 2" className="col-span-2">
              <Input
                value={form.recipientAddressLine2}
                onChange={(e) => set('recipientAddressLine2', e.target.value)}
                maxLength={200}
              />
            </FormField>
            <FormField label="Landmark" className="col-span-2">
              <Input
                value={form.recipientLandmark}
                onChange={(e) => set('recipientLandmark', e.target.value)}
                maxLength={120}
              />
            </FormField>
            <FormField label="City" required>
              <Input
                value={form.recipientCity}
                onChange={(e) => set('recipientCity', e.target.value)}
                required
              />
            </FormField>
            <FormField label="State" required>
              <Select
                value={form.recipientStateProvince}
                onChange={(e) => set('recipientStateProvince', e.target.value)}
                required
              >
                <option value="">Select a state</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
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

      {/* Item */}
      <Card>
        <CardBody>
          <h2 className="text-text-bright text-sm font-medium mb-3">Item</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Product" required>
              <Select
                value={form.productId}
                onChange={(e) => onProductChange(e.target.value)}
                required
                disabled={products.isLoading}
              >
                <option value="">
                  {products.isLoading
                    ? 'Loading products…'
                    : products.data?.items.length === 0
                      ? 'No products yet — add one in Catalog first.'
                      : 'Select a product'}
                </option>
                {products.data?.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Variant" required>
              <Select
                value={form.variantId}
                onChange={(e) => set('variantId', e.target.value)}
                required
                disabled={!form.productId || variants.isLoading}
              >
                <option value="">
                  {!form.productId
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
                value={form.quantity}
                onChange={(e) => set('quantity', e.target.value)}
                required
              />
            </FormField>
            <FormField label="Unit price (INR)">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.unitPriceInr}
                onChange={(e) => set('unitPriceInr', e.target.value)}
                placeholder="Optional"
              />
            </FormField>
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
