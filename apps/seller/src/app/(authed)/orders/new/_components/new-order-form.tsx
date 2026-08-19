'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import type { SellerVariantSearchHit } from '@skydrop/api-client';
import { ProductPicker, type PickedLine } from './product-picker';
import { Button, Card, CardBody, FormField, Input, Select, useToast } from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import {
  useCreateOrder,
  useCustomerDeliveryFee,
  useStockList,
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
  advanceAmountInr: string;
  deliveryFeeInr: string;
  discountInr: string;
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
const MAX_ITEMS = 50;

const INITIAL: FormState = {
  recipientName: '',
  recipientPhoneE164: IN_DIAL,
  recipientAddressLine1: '',
  recipientAddressLine2: '',
  recipientPostalCode: '',
  // COD is what almost every Indian order is, and it is the reason the
  // call centre exists. Defaulting to prepaid made the common case the
  // one that needed a change.
  paymentMode: 'COD',
  codAmountInr: '',
  advanceAmountInr: '',
  deliveryFeeInr: '',
  discountInr: '',
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
  const [items, setItems] = useState<readonly PickedLine[]>([]);
  const nextKey = useRef(1);
  const [error, setError] = useState<string | null>(null);
  // The server decides whether this is a duplicate; the dialog only
  // relays its answer and collects the acknowledgement (FE-2 — the UI
  // never pre-empts a server guardrail with its own copy of the rule).
  const [duplicates, setDuplicates] = useState<ReadonlyArray<DuplicateCandidate> | null>(null);
  const [pendingAction, setPendingAction] = useState<'draft' | 'submit' | null>(null);
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
  /**
   * Ticked by the seller when they mean to order stock we do not have
   * yet. Mirrors the duplicate-order acknowledgement already in this
   * form: the block is real, and getting past it is one deliberate act
   * rather than a dialog you dismiss without reading.
   */
  const [acceptShort, setAcceptShort] = useState(false);

  const create = useCreateOrder();
  const feePrefilled = useRef(false);
  /**
   * The collectable is ALWAYS the sum. There is no override state.
   *
   * It used to have one, and the four numbers stopped adding up: a
   * seller typed 1,300, the discount absorbed it, and then they changed
   * the discount by hand — the field kept showing 1,300 while its own
   * arithmetic underneath said 1,260. A total that disagrees with the
   * breakdown printed beneath it is worse than no breakdown.
   *
   * Typing into the field is a SHORTCUT for setting the discount, which
   * is why it still behaves like an editable total. This holds the raw
   * keystrokes only while the field has focus — without it, clearing the
   * box would immediately refill with the computed value and nothing
   * could be retyped.
   */
  const [collectableDraft, setCollectableDraft] = useState<string | null>(null);
  const submit = useSubmitOrder();

  // Load a large-enough product page for picker UX. Sellers with
  // >200 products will need search; for Phase 1A 200 is plenty.
  // 100 is the endpoint's maximum; asking for 200 is a 400, which left
  // the product picker empty with no explanation. A seller with more
  // than 100 active products needs a search-as-you-type picker rather
  // than a bigger page — noted rather than papered over.
  /**
   * Availability per variant, indexed once for every row.
   *
   * ORD-10 means the server takes an order without checking stock and
   * catches it at confirmation — so this is ADVISORY, not a mirror of a
   * server rule (FE-2). It is here because an order placed against stock
   * that is not there fails hours later, in a phone call, and the seller
   * had no way to see it coming.
   */
  // 100 is the endpoint's MAXIMUM; asking for 200 is a 400 and the whole
  // lookup comes back empty — which reads as "this product has no stock"
  // rather than as a failed request. Exactly the trap that once left the
  // product picker blank with no explanation.
  const stock = useStockList({ page: 1, pageSize: 100 });
  /**
   * The parcel's weight, added up from the catalogue. A variant with no
   * recorded weight contributes ZERO rather than making the whole sum
   * unknown — a missing weight is a gap in the catalogue, and refusing to
   * show a total because of it helps nobody.
   */
  const computedWeight = useMemo(
    () =>
      items.reduce((n, it) => {
        const q = Number(it.quantity);
        return n + (it.weightGrams ?? 0) * (Number.isFinite(q) && q > 0 ? q : 0);
      }, 0),
    [items],
  );

  const feeDefault = useCustomerDeliveryFee();

  /**
   * The collectable amount, and where it comes from.
   *
   *   items + delivery fee − advance − discount
   *
   * `codAmountInr` is the field the courier actually collects against.
   * It is NOT `declaredValueInr`, which is the customs figure sent to
   * Delhivery and the trigger for an e-waybill above ₹50,000 — putting a
   * discounted total there would quietly change whether a legal document
   * is required.
   */
  const itemsTotal = useMemo(
    () =>
      items.reduce((n, it) => {
        const price = Number(it.unitPriceInr);
        const qty = Number(it.quantity);
        return n + (Number.isFinite(price) ? price : 0) * (Number.isFinite(qty) ? qty : 0);
      }, 0),
    [items],
  );
  const num = (v: string): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  // Pre-fill ONCE, and only while the field is untouched. Re-applying it
  // on every render would overwrite a seller who deliberately zeroed it.
  if (!feePrefilled.current && feeDefault.data !== undefined && form.deliveryFeeInr.trim() === '') {
    feePrefilled.current = true;
    setForm((p) =>
      p.deliveryFeeInr.trim() === '' ? { ...p, deliveryFeeInr: feeDefault.data.amountInr } : p,
    );
  }

  const computedCollectable =
    itemsTotal + num(form.deliveryFeeInr) - num(form.advanceAmountInr) - num(form.discountInr);

  const stockByVariant = useMemo(() => {
    const m = new Map<string, { available: number; inTransit: number }>();
    for (const r of stock.data?.items ?? []) {
      m.set(r.variantId, { available: r.qtyAvailable, inTransit: r.qtyInTransit });
    }
    return m;
  }, [stock.data]);

  /**
   * Lines the warehouse cannot fill today.
   *
   * ADVISORY, not a mirror of a server rule (FE-2): ORD-10 means the
   * server takes the order and catches it at confirmation. And that is
   * correct — an order placed today against a consignment landing on
   * Friday is exactly what the inbound flow exists for, so this must not
   * be a hard refusal.
   *
   * What it must not do is let one through SILENTLY. An order that fails
   * at confirmation fails in a phone call, hours later, in front of a
   * customer.
   */
  const shortLines = useMemo(
    () =>
      items
        .map((it) => {
          const have = stockByVariant.get(it.variantId)?.available ?? null;
          const want = Number(it.quantity);
          return it.variantId !== '' && have !== null && Number.isFinite(want) && want > have
            ? { variantId: it.variantId, want, have }
            : null;
        })
        .filter((x): x is { variantId: string; want: number; have: number } => x !== null),
    [items, stockByVariant],
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((p) => ({ ...p, [key]: value }));
  }

  /**
   * Adding from the catalogue fills everything the catalogue knows —
   * name, picture, weight and the effective unit value (M4: the
   * variant's own, or the product default where it is blank).
   */
  function addFromCatalogue(hit: SellerVariantSearchHit): void {
    if (items.length >= MAX_ITEMS) return;
    if (items.some((i) => i.variantId === hit.id)) return;
    setItems((prev) => [
      ...prev,
      {
        key: nextKey.current++,
        variantId: hit.id,
        productId: hit.productId,
        skuCode: hit.skuCode,
        productName: hit.productName,
        variantLabel: hit.variantLabel,
        imageUrl: hit.primaryImageUrl,
        weightGrams: hit.effectiveWeightGrams,
        quantity: '1',
        unitPriceInr: hit.effectiveDeclaredValueInr ?? '',
      },
    ]);
  }

  function patchItem(key: number, patch: Partial<PickedLine>): void {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function removeItem(key: number): void {
    setItems((prev) => prev.filter((it) => it.key !== key));
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
    const effectiveCollectable = computedCollectable;
    if (form.paymentMode === 'COD' && !(effectiveCollectable > 0))
      return 'The collectable amount must be more than zero for a cash-on-delivery order.';
    if (shortLines.length > 0 && !acceptShort) {
      return 'Some products are short of stock — see the note below, and tick the box if you mean to order them anyway.';
    }
    // A line cannot exist without a product now — it is created by
    // clicking one — so the only thing left to check is the quantity.
    if (items.length === 0) return 'Add at least one product from the list.';
    for (const it of items) {
      const qty = Number(it.quantity);
      if (!Number.isFinite(qty) || qty < 1) return `Quantity must be at least 1 for ${it.skuCode}.`;
    }
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
      ...(form.paymentMode === 'COD'
        ? {
            codAmountInr: Number(computedCollectable.toFixed(2)),
          }
        : {}),
      // Kept whatever the payment mode — a prepaid order still has an
      // advance and a delivery fee worth reading back later.
      ...(form.advanceAmountInr.trim() ? { advanceAmountInr: Number(form.advanceAmountInr) } : {}),
      ...(form.deliveryFeeInr.trim() ? { deliveryFeeInr: Number(form.deliveryFeeInr) } : {}),
      ...(form.discountInr.trim() ? { discountInr: Number(form.discountInr) } : {}),
      ...(form.declaredValueInr.trim() ? { declaredValueInr: Number(form.declaredValueInr) } : {}),
      // The typed value wins; otherwise the sum we worked out.
      ...(form.totalWeightGrams.trim()
        ? { totalWeightGrams: Number(form.totalWeightGrams) }
        : computedWeight > 0
          ? { totalWeightGrams: computedWeight }
          : {}),
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
          <ProductPicker
            lines={items}
            stockByVariant={stockByVariant}
            onAdd={addFromCatalogue}
            onPatch={patchItem}
            onRemove={removeItem}
          />
        </CardBody>
      </Card>

      {shortLines.length > 0 && (
        <div className="border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] rounded-[6px] border px-3 py-2.5">
          <p className="text-critical text-sm font-medium">
            {shortLines.length === 1
              ? 'One product is short of stock'
              : `${shortLines.length} products are short of stock`}
          </p>
          <ul className="text-text-muted mt-1 space-y-0.5 text-xs">
            {shortLines.map((l) => (
              <li key={l.variantId}>
                asked for {l.want}, {l.have === 0 ? 'none available' : `only ${l.have} available`}
              </li>
            ))}
          </ul>
          <p className="text-text-muted mt-1.5 text-xs">
            You can still place it — stock on its way in will cover it once it lands. But the call
            centre cannot confirm an order we cannot pick, so it waits until then.
          </p>
          <label className="text-text-body mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={acceptShort}
              onChange={(e) => setAcceptShort(e.target.checked)}
              className="h-4 w-4"
            />
            Place it anyway
          </label>
        </div>
      )}

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
            <FormField
              label="Delivery fee (INR)"
              hint={
                feeDefault.data === undefined
                  ? 'Added to the collectable amount.'
                  : `Added to the collectable amount. Pre-filled from your default of ₹${feeDefault.data.amountInr} — change it here, or change the default in Settings.`
              }
            >
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.deliveryFeeInr}
                onChange={(e) => set('deliveryFeeInr', e.target.value)}
              />
            </FormField>
            <FormField label="Advance already paid (INR)" hint="Deducted from the collectable.">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.advanceAmountInr}
                onChange={(e) => set('advanceAmountInr', e.target.value)}
                placeholder="0"
              />
            </FormField>
            <FormField label="Discount (INR)" hint="Deducted from the collectable.">
              <Input
                type="number"
                step="0.01"
                value={form.discountInr}
                onChange={(e) => set('discountInr', e.target.value)}
                placeholder="0"
              />
            </FormField>
            {form.paymentMode === 'COD' && (
              <FormField
                label="Collectable amount (INR)"
                required
                hint={
                  // The arithmetic, spelled out. A number the call centre
                  // reads to a customer should be checkable at a glance.
                  `${itemsTotal.toLocaleString('en-IN')} of goods${
                    num(form.deliveryFeeInr) !== 0
                      ? ` + ${num(form.deliveryFeeInr).toLocaleString('en-IN')} delivery`
                      : ''
                  }${
                    num(form.advanceAmountInr) !== 0
                      ? ` − ${num(form.advanceAmountInr).toLocaleString('en-IN')} advance`
                      : ''
                  }${
                    // A NEGATIVE discount is a surcharge, and reads as one.
                    // "− -40 discount" is arithmetic nobody should have to
                    // parse to check their own total.
                    num(form.discountInr) > 0
                      ? ` − ${num(form.discountInr).toLocaleString('en-IN')} discount`
                      : num(form.discountInr) < 0
                        ? ` + ${Math.abs(num(form.discountInr)).toLocaleString('en-IN')} surcharge`
                        : ''
                  } = ${computedCollectable.toLocaleString('en-IN')}`
                }
              >
                <Input
                  type="number"
                  min={0.01}
                  step="0.01"
                  // The one figure the customer is asked for at the door,
                  // and the one the call centre reads out. It looked
                  // exactly like the three inputs feeding it.
                  className="border-accent text-base font-medium ring-1 ring-[var(--color-accent-tint)]"
                  value={
                    collectableDraft ??
                    (computedCollectable === 0 ? '' : String(computedCollectable))
                  }
                  onBlur={() => setCollectableDraft(null)}
                  // Typing here moves the DISCOUNT, so the four numbers
                  // still add up. A collectable that silently disagrees
                  // with its own breakdown is worse than no breakdown.
                  onChange={(e) => {
                    const typed = e.target.value;
                    setCollectableDraft(typed);
                    const target = Number(typed);
                    if (typed.trim() === '' || !Number.isFinite(target)) return;
                    setForm((p) => {
                      const before = itemsTotal + num(p.deliveryFeeInr) - num(p.advanceAmountInr);
                      return { ...p, discountInr: String(before - target) };
                    });
                  }}
                  required
                />
              </FormField>
            )}
            <FormField
              label="Declared value (INR)"
              hint="The parcel's value for customs — not what is collected."
            >
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.declaredValueInr}
                onChange={(e) => set('declaredValueInr', e.target.value)}
                placeholder="Defaults to sum of line item values"
              />
            </FormField>
            <FormField
              label="Total weight (grams)"
              hint={
                computedWeight > 0
                  ? `Adds up to ${computedWeight.toLocaleString('en-IN')} g from the catalogue. Type a number to override it.`
                  : 'None of these products has a recorded weight, so this stays 0 unless you set it.'
              }
            >
              <Input
                type="number"
                min={0}
                value={form.totalWeightGrams}
                onChange={(e) => set('totalWeightGrams', e.target.value)}
                placeholder={computedWeight > 0 ? computedWeight.toLocaleString('en-IN') : '0'}
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
