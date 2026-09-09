'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import type { SellerVariantSearchHit } from '@skydrop/api-client';
import { OrderedProducts, ProductCatalogue, type PickedLine } from '@/components/product-picker';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  FormField,
  Input,
  Money,
  PageHeader,
  Select,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
import { ArrowLeft, Banknote, CreditCard, MapPin, Scale, Store } from 'lucide-react';
import { ApiError } from '@skydrop/api-client';
import {
  useCreateOrder,
  useCustomerDeliveryFee,
  useStockList,
  useSubmitOrder,
} from '@/lib/api-hooks';
import { useSellerIdentity } from '@skydrop/auth/client';
import { useStores } from '@/lib/store-hooks';
import {
  ADDRESS_LINE_1_HINT,
  ADDRESS_LINE_2_HINT,
  DUPLICATE_LINES_ERROR,
  linesAreDuplicated,
} from '@/lib/address-guidance';
import { prefixHint, stripSellerPrefix } from '@/lib/seller-prefix';
import { CustomerHistoryPanel } from './customer-history-panel';
import { DuplicateOrderDialog, type DuplicateCandidate } from './duplicate-order-dialog';
import { useServiceability } from '@/lib/ops-hooks';
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
  /** Which shopfront. Pre-filled with the default. */
  storeId: string;
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
  storeId: '',
};

export function NewOrderForm(): ReactElement {
  const sellerInitials = useSellerIdentity()?.initials ?? null;
  const stores = useStores();
  // CLOSED stores are left out: the server refuses one by name, and a
  // form should not offer an option it knows will be rejected.
  const openStores = (stores.data ?? []).filter((s) => s.isActive);
  const defaultStoreId = openStores.find((s) => s.isDefault)?.id ?? openStores[0]?.id ?? '';
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(INITIAL);
  // Asked while they type, so a bad pin is caught before they commit
  // rather than after the order exists. Cached server-side for a day.
  const serviceability = useServiceability(form.recipientPostalCode, form.paymentMode);
  // Pre-select the default once the list arrives, and only while the
  // field is untouched: a seller who has already picked a shopfront
  // must not have it changed underneath them by a late response.
  useEffect(() => {
    if (defaultStoreId === '') return;
    setForm((f) => (f.storeId === '' ? { ...f, storeId: defaultStoreId } : f));
  }, [defaultStoreId]);

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

  /**
   * The customs declared value the server would default to: the CATALOGUE
   * value per line × quantity, matching `Σ(item declared value × qty)`
   * from the snapshot. Computed from the catalogue figure rather than the
   * editable selling price, so the preview is what the order would
   * actually carry.
   */
  const computedDeclaredValue = useMemo(
    () =>
      items.reduce((n, it) => {
        const q = Number(it.quantity);
        const v = Number(it.catalogueValueInr ?? '');
        return n + (Number.isFinite(v) ? v : 0) * (Number.isFinite(q) && q > 0 ? q : 0);
      }, 0),
    [items],
  );

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
   * Fill the recipient block from where this seller last sent to this
   * number.
   *
   * OVERWRITES rather than filling only the blanks: the seller clicked a
   * button that says "use these details", and half-applying it would
   * leave a mix of two addresses — which is worse than either, and
   * invisible until a parcel goes to the wrong door.
   *
   * The PHONE is untouched. It is what the lookup was keyed on, so it
   * already matches, and rewriting the field someone is typing in is how
   * a cursor jumps mid-digit.
   *
   * Landmark folds into line 2 when line 2 is empty, because line 2 IS
   * the landmark on this form now (ORD-5) and an older order may have
   * carried it in the separate column.
   */
  function useLastDetails(r: {
    name: string;
    addressLine1: string;
    addressLine2: string | null;
    landmark: string | null;
    postalCode: string;
  }): void {
    setForm((p) => ({
      ...p,
      // The STORED name carries the seller code ("MSt Tasin") because
      // that is what goes on a label; this input sits behind a fixed
      // prefix box, so filling it raw showed "MSt MSt Tasin". Strip it,
      // exactly as the edit form does when round-tripping an order.
      //
      // Display-only either way: the server's compose is idempotent, so
      // the double prefix could never reach the database. It could
      // certainly reach a seller's eyes and make them edit the name to
      // fix something that was not broken.
      recipientName: stripSellerPrefix(sellerInitials, r.name),
      recipientAddressLine1: r.addressLine1,
      recipientAddressLine2:
        r.addressLine2 !== null && r.addressLine2 !== '' ? r.addressLine2 : (r.landmark ?? ''),
      recipientPostalCode: r.postalCode,
    }));
    toast.success('Filled from their last order — check it is still right.');
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
        skuCode: hit.skuCode,
        productName: hit.productName,
        variantLabel: hit.variantLabel,
        imageUrl: hit.primaryImageUrl,
        weightGrams: hit.effectiveWeightGrams,
        catalogueValueInr: hit.effectiveDeclaredValueInr,
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
    if (items.length === 0)
      return 'At least one product is required — add one from the list on the right.';
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
      // Omitted rather than guessed when the list has not loaded: the
      // server falls back to the default store, which is the same
      // answer this form would have pre-filled.
      ...(form.storeId === '' ? {} : { storeId: form.storeId }),
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

  /**
   * A card title with a short accent rule in front of it.
   *
   * The tinted header band alone is nearly invisible in dark, where the
   * band and the card are within a few percent of each other; the rule
   * is what makes a section start read as a section start in BOTH
   * themes rather than only in light.
   */
  const sectionTitle = (label: string): ReactElement => (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="bg-accent inline-block h-3.5 w-[3px] rounded-full" />
      {label}
    </span>
  );

  /** The three actions, rendered twice — at the top and on the sticky
   *  bar. A long form whose only submit is 1,400px below the fold makes
   *  a seller scroll past everything they have just checked. */
  const actions = (
    <>
      {/* Desktop only in BOTH placements. On a phone the sticky bar is
          the only action strip, and "Back to orders" sits at the top of
          the page doing the same thing — a third row of buttons there
          costs more screen than the duplicate is worth. */}
      <Button
        type="button"
        variant="ghost"
        size="md"
        // `max-sm:hidden`, NOT `hidden sm:inline-flex`: the Button
        // primitive's own base classes carry `inline-flex`, and which of
        // two unprefixed display utilities wins is decided by Tailwind's
        // generated source order rather than by the class attribute — so
        // the plain `hidden` lost and the button stayed visible. A
        // variant outranks a bare utility, which settles it.
        className="max-sm:hidden"
        disabled={busy !== null}
        onClick={() => router.push('/orders')}
      >
        Cancel
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="md"
        className="whitespace-nowrap max-sm:flex-1"
        disabled={busy !== null}
        onClick={(e) => void go('draft', e)}
      >
        {busy === 'draft' ? 'Saving…' : 'Save as draft'}
      </Button>
      <Button
        type="submit"
        variant="primary"
        size="md"
        className="whitespace-nowrap max-sm:flex-1"
        disabled={busy !== null}
      >
        {busy === 'submit' ? 'Submitting…' : 'Submit for confirmation'}
      </Button>
    </>
  );

  const serviceabilityChip =
    serviceability.data?.known !== true ? null : serviceability.data.serviceable ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--status-delivered-bg)] px-2 py-0.5 text-[11px] font-semibold tracking-wide text-[var(--status-delivered-fg)] uppercase">
        <MapPin size={11} aria-hidden />
        We deliver there
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--status-pending-bg)] px-2 py-0.5 text-[11px] font-semibold tracking-wide text-[var(--status-pending-fg)] uppercase">
        <MapPin size={11} aria-hidden />
        May not be serviceable
      </span>
    );

  return (
    <form onSubmit={(e) => void go('submit', e)}>
      <Link
        href="/orders"
        className="text-text-muted hover:text-text-bright mb-3 inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft size={14} aria-hidden />
        Back to orders
      </Link>

      <PageHeader
        title="New order"
        subtitle="Enter recipient + line details. Stock is reserved when the call centre confirms the order."
        // Desktop only. The sticky bar carries the same three actions and
        // is always on screen; on a phone the pair together cost about a
        // fifth of the viewport before a single field is visible.
        action={<div className="hidden flex-wrap items-center gap-2 sm:flex">{actions}</div>}
      />

      {/* Who they are shipping to — rendered ABOVE the columns, because a
          warning read after the address has been typed is a warning read
          too late. Renders nothing for a first-time customer. */}
      <CustomerHistoryPanel phoneE164={form.recipientPhoneE164} onUseLastDetails={useLastDetails} />

      {/*
        Two columns, and which half a card sits in is the point.

        LEFT is what the seller TYPES from what the customer said —
        address, landmark, reference, notes. RIGHT is what the seller
        CHOOSES and what follows from it — the catalogue, the lines, and
        the money those lines add up to. Reading down one column is one
        task; the old single stack interleaved them, so the collectable
        amount sat a screen and a half below the products that decide it.
      */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {/* ── Left: what the customer told them ─────────────────── */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              tone="accent"
              title={sectionTitle('Recipient')}
              action={serviceabilityChip}
            />
            <CardBody>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField
                  label="Full name"
                  required
                  className="sm:col-span-2"
                  hint={prefixHint(sellerInitials)}
                >
                  {/* The seller code is CHROME, exactly like the +91 below:
                      it cannot be edited or deleted, and the field holds only
                      the customer's name. The API composes the stored value,
                      so a CSV import lands the same shape as this form. */}
                  <div className="flex items-stretch">
                    {sellerInitials !== null && sellerInitials !== '' && (
                      <span
                        aria-hidden
                        className="border-border-strong text-text-muted bg-surface-raised inline-flex shrink-0 items-center rounded-l-[6px] border border-r-0 px-2.5 font-mono text-sm"
                      >
                        {sellerInitials}
                      </span>
                    )}
                    <Input
                      className={
                        sellerInitials !== null && sellerInitials !== ''
                          ? 'rounded-l-none'
                          : undefined
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
                  className="sm:col-span-2"
                  hint={`${IN_DIAL} — ${IN_LOCAL_LENGTH} digits, starting 6-9`}
                >
                  {/* The dial code is CHROME, not input: it cannot be edited
                      or deleted, so a seller cannot clear it, type 0091, or
                      paste a differently-formatted number into it. The field
                      itself holds only the ten national digits. */}
                  <div className="flex items-stretch">
                    <span
                      aria-hidden
                      className="border-border-strong text-text-muted bg-surface-raised inline-flex shrink-0 items-center rounded-l-[6px] border border-r-0 px-2.5 font-mono text-sm"
                    >
                      {IN_DIAL}
                    </span>
                    <Input
                      className="rounded-l-none"
                      value={toLocalDigits(form.recipientPhoneE164)}
                      onChange={(e) =>
                        set('recipientPhoneE164', toE164(sanitiseLocal(e.target.value)))
                      }
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
                  className="sm:col-span-2"
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
                  label="Address line 2 (the landmark)"
                  required
                  className="sm:col-span-2"
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
                <FormField
                  label="PIN code"
                  required
                  // A WARNING, so `notice` and not `hint`: it is the one
                  // thing on this field the seller did not ask about and
                  // needs anyway, and folding it behind the (i) would mean
                  // it is read after the parcel is refused rather than
                  // before it is placed.
                  //
                  // Advisory all the same. The answer can be a day stale
                  // and a seller knows their customer's area better than a
                  // lookup does, so it informs and never blocks the submit.
                  notice={
                    serviceability.data?.known === true && !serviceability.data.serviceable
                      ? (serviceability.data.reason ??
                        'Our courier may not deliver here — the order can still be placed.')
                      : undefined
                  }
                  hint="Delhivery routes on the PIN and works the locality out itself."
                >
                  <Input
                    value={form.recipientPostalCode}
                    onChange={(e) =>
                      set('recipientPostalCode', e.target.value.replace(/\D/g, '').slice(0, 6))
                    }
                    placeholder="560001"
                    inputMode="numeric"
                    className="font-mono tabular-nums"
                    required
                  />
                </FormField>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              tone="accent"
              title={sectionTitle('Reference & notes')}
              subtitle="Yours and the call agent's — none of it reaches the customer."
            />
            <CardBody>
              <div className="grid grid-cols-1 gap-3">
                {/*
                  Always SHOWN, only sometimes a CHOICE.

                  A dropdown with one option is a question nobody asked —
                  but hiding the field entirely leaves somebody with two
                  shopfronts in mind wondering where the setting went, and
                  somebody with one unable to see which brand their order is
                  filed under. One store reads as a statement with a way to
                  add another; two or more becomes a select.
                */}
                <FormField
                  label="Store"
                  hint={
                    openStores.length > 1
                      ? 'Which of your shopfronts this order was placed on'
                      : 'Every order is filed under a shopfront. Add another to sell under more than one brand.'
                  }
                >
                  {openStores.length > 1 ? (
                    <Select value={form.storeId} onChange={(e) => set('storeId', e.target.value)}>
                      {openStores.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.name}
                          {st.isDefault ? ' (default)' : ''}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <div className="border-border bg-surface-raised flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <Store size={14} aria-hidden className="text-text-muted shrink-0" />
                        <span className="truncate">
                          {openStores[0]?.name ?? 'Your default store'}
                        </span>
                      </span>
                      <Link
                        href="/settings/stores"
                        className="text-text-muted hover:text-text shrink-0 text-xs underline underline-offset-2"
                      >
                        Manage stores
                      </Link>
                    </div>
                  )}
                </FormField>
                <FormField
                  label="Your reference"
                  hint="Optional. Your own order ID — unique per store."
                >
                  <Input
                    value={form.sellerOrderRef}
                    onChange={(e) => set('sellerOrderRef', e.target.value)}
                    maxLength={120}
                    placeholder="ORD-2024-9981"
                    className="font-mono"
                  />
                </FormField>
                <FormField
                  label="Notes for the call agent"
                  hint="Read out on the confirmation call — a preferred time, a fragile item, a second number."
                >
                  <Textarea
                    rows={3}
                    value={form.sellerNotes}
                    onChange={(e) => set('sellerNotes', e.target.value)}
                    placeholder="Anything the call agent should know"
                  />
                </FormField>
              </div>
            </CardBody>
          </Card>
        </div>

        {/* ── Right: what they are sending, and what it comes to ─── */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              tone="accent"
              title={sectionTitle('Click to add products')}
              subtitle="Price and stock are on the row, before you choose."
            />
            <ProductCatalogue
              lines={items}
              stockByVariant={stockByVariant}
              onAdd={addFromCatalogue}
            />
          </Card>

          <Card>
            <CardHeader
              tone="accent"
              title={sectionTitle(
                `Ordered products (${items.length} ${items.length === 1 ? 'item' : 'items'})`,
              )}
              action={
                items.length === 0 ? null : (
                  <span className="text-text-bright font-mono text-sm tabular-nums">
                    Subtotal <Money amount={itemsTotal} convert={false} />
                  </span>
                )
              }
            />
            <OrderedProducts
              lines={items}
              stockByVariant={stockByVariant}
              onPatch={patchItem}
              onRemove={removeItem}
            />
          </Card>

          {shortLines.length > 0 && (
            <div className="rounded-[7px] border border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] px-4 py-3">
              <p className="text-critical text-sm font-medium">
                {shortLines.length === 1
                  ? 'One product is short of stock'
                  : `${shortLines.length} products are short of stock`}
              </p>
              <ul className="text-text-muted mt-1 space-y-0.5 text-xs">
                {shortLines.map((l) => (
                  <li key={l.variantId}>
                    asked for {l.want},{' '}
                    {l.have === 0 ? 'none available' : `only ${l.have} available`}
                  </li>
                ))}
              </ul>
              <p className="text-text-muted mt-1.5 text-xs">
                You can still place it — stock on its way in will cover it once it lands. But the
                call centre cannot confirm an order we cannot pick, so it waits until then.
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

          <Card>
            <CardHeader tone="accent" title={sectionTitle('Payment & physical')} />
            <CardBody>
              {/*
                A segmented pair, not a dropdown. There are exactly two
                answers, one of them is nearly always the right one, and
                which is chosen changes what the rest of this card means
                — a collapsed select hides the most consequential choice
                on the form behind a click.
              */}
              <fieldset>
                <legend className="text-text-muted mb-1.5 text-xs font-medium">
                  Payment mode <span className="text-critical">*</span>
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { mode: 'COD' as const, label: 'Cash on delivery', Icon: Banknote },
                      { mode: 'PREPAID' as const, label: 'Prepaid', Icon: CreditCard },
                    ] satisfies ReadonlyArray<{
                      mode: 'COD' | 'PREPAID';
                      label: string;
                      Icon: typeof Banknote;
                    }>
                  ).map(({ mode, label, Icon }) => {
                    const on = form.paymentMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={on}
                        onClick={() => set('paymentMode', mode)}
                        className={`skydrop-hit inline-flex items-center justify-center gap-2 rounded-[5px] border px-3 py-2 text-sm font-medium transition-colors ${
                          on
                            ? 'border-accent bg-accent-fill text-accent-fg'
                            : 'border-border bg-surface text-text-body hover:border-border-strong hover:text-text-bright'
                        }`}
                      >
                        <Icon size={15} aria-hidden />
                        {label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField
                  label="Delivery fee (INR)"
                  hint={
                    feeDefault.data === undefined
                      ? 'Added to the collectable amount.'
                      : `Added to the collectable. Your default is ₹${feeDefault.data.amountInr}; change it in Settings.`
                  }
                >
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.deliveryFeeInr}
                    onChange={(e) => set('deliveryFeeInr', e.target.value)}
                    className="tabular-nums"
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
                    className="tabular-nums"
                  />
                </FormField>
                <FormField label="Discount (INR)" hint="Deducted from the collectable.">
                  <Input
                    type="number"
                    step="0.01"
                    value={form.discountInr}
                    onChange={(e) => set('discountInr', e.target.value)}
                    placeholder="0"
                    className="tabular-nums"
                  />
                </FormField>
                <FormField
                  label="Declared value (INR)"
                  hint={
                    computedDeclaredValue > 0
                      ? `For customs, not collection. Adds up to ₹${computedDeclaredValue.toLocaleString('en-IN')} from the catalogue.`
                      : "The parcel's value for customs — not what is collected."
                  }
                >
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.declaredValueInr}
                    onChange={(e) => set('declaredValueInr', e.target.value)}
                    className="tabular-nums"
                    placeholder={
                      computedDeclaredValue > 0
                        ? computedDeclaredValue.toLocaleString('en-IN')
                        : 'Sum of the line values'
                    }
                  />
                </FormField>
                <FormField
                  // The unit is the suffix on the field itself; saying
                  // it twice reads as two different things being asked for.
                  label="Total weight"
                  className="sm:col-span-2"
                  hint={
                    computedWeight > 0
                      ? `Adds up to ${computedWeight.toLocaleString('en-IN')} g from the catalogue. Type a number to override it.`
                      : 'None of these products has a recorded weight, so this stays 0 unless you set it.'
                  }
                >
                  <div className="flex items-stretch">
                    <Input
                      type="number"
                      min={0}
                      className="rounded-r-none tabular-nums"
                      value={form.totalWeightGrams}
                      onChange={(e) => set('totalWeightGrams', e.target.value)}
                      placeholder={
                        computedWeight > 0 ? computedWeight.toLocaleString('en-IN') : '0'
                      }
                    />
                    {/* A SUFFIX. The unit follows the figure when it is
                        spoken, and a "grams" box in front of an empty
                        field reads as a label for the wrong thing. */}
                    <span
                      aria-hidden
                      className="border-border-strong text-text-muted bg-surface-raised inline-flex shrink-0 items-center gap-1.5 rounded-r-[6px] border border-l-0 px-2.5 text-xs"
                    >
                      <Scale size={13} />
                      grams
                    </span>
                  </div>
                </FormField>
              </div>

              {form.paymentMode === 'COD' ? (
                /*
                  The one figure the customer is asked for at the door,
                  and the one the call centre reads out. It used to look
                  exactly like the three inputs feeding it; now it is the
                  loudest thing on the card, with its own arithmetic
                  printed underneath so it can be checked at a glance.
                */
                <div className="border-accent/30 mt-4 rounded-[7px] border bg-[var(--color-accent-tint)] px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label
                      htmlFor="collectable-amount"
                      className="text-text-muted text-xs font-semibold tracking-wide uppercase"
                    >
                      Collectable amount (INR)
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span className="text-text-bright text-xl font-semibold" aria-hidden>
                        ₹
                      </span>
                      <Input
                        id="collectable-amount"
                        type="number"
                        min={0.01}
                        step="0.01"
                        className="border-accent h-11 w-40 text-right text-xl font-semibold tabular-nums ring-1 ring-[var(--color-accent-tint)]"
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
                            const before =
                              itemsTotal + num(p.deliveryFeeInr) - num(p.advanceAmountInr);
                            return { ...p, discountInr: String(before - target) };
                          });
                        }}
                        required
                      />
                    </div>
                  </div>
                  <p className="text-text-muted mt-2 font-mono text-xs tabular-nums">
                    {/* The arithmetic, spelled out. A number the call centre
                        reads to a customer should be checkable at a glance. */}
                    {itemsTotal.toLocaleString('en-IN')} of goods
                    {num(form.deliveryFeeInr) !== 0
                      ? ` + ${num(form.deliveryFeeInr).toLocaleString('en-IN')} delivery`
                      : ''}
                    {num(form.advanceAmountInr) !== 0
                      ? ` − ${num(form.advanceAmountInr).toLocaleString('en-IN')} advance`
                      : ''}
                    {/* A NEGATIVE discount is a surcharge, and reads as one.
                        "− -40 discount" is arithmetic nobody should have to
                        parse to check their own total. */}
                    {num(form.discountInr) > 0
                      ? ` − ${num(form.discountInr).toLocaleString('en-IN')} discount`
                      : num(form.discountInr) < 0
                        ? ` + ${Math.abs(num(form.discountInr)).toLocaleString('en-IN')} surcharge`
                        : ''}
                    {` = ${computedCollectable.toLocaleString('en-IN')}`}
                  </p>
                </div>
              ) : (
                <div className="border-border bg-surface-raised mt-4 rounded-[7px] border px-4 py-3">
                  <p className="text-text-body text-sm font-medium">
                    Nothing to collect at the door
                  </p>
                  <p className="text-text-muted mt-1 text-xs">
                    Prepaid — the driver hands it over and takes no money. The goods still come to{' '}
                    <span className="font-mono tabular-nums">
                      ₹{itemsTotal.toLocaleString('en-IN')}
                    </span>
                    , which is what the seller is charged against.
                  </p>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="text-critical mt-4 rounded-[5px] border border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] px-3 py-2 text-xs"
        >
          {error}
        </div>
      )}

      {/*
        The sticky bar carries the totals as well as the buttons: the
        two things a seller checks before committing are "did I get the
        money right" and "how many lines", and both were a scroll away
        from the button that commits them.
      */}
      <div className="border-border bg-surface/95 sticky bottom-0 z-10 mt-4 -mx-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t px-3 py-2 backdrop-blur sm:-mx-5 sm:px-5 sm:py-3 lg:-mx-6 lg:px-6">
        {/*
          The refusal goes HERE, next to the button that was refused.

          It used to render only at the bottom of the form, which on a
          two-column layout is well below the fold — so pressing Submit
          with an empty field looked like pressing Submit did nothing,
          and the reason was a scroll away. The bar is the one part of
          this page that is always on screen.
        */}
        {error === null ? (
          <p className="text-text-muted text-xs">
            {items.length === 0
              ? 'No products yet'
              : // "products", not "lines" — a line is what the order model
                // calls it and nobody outside this codebase does.
                `${items.length} ${items.length === 1 ? 'product' : 'products'}`}
            {form.paymentMode === 'COD' && computedCollectable > 0 && (
              <>
                {' · '}
                <span className="text-text-bright font-mono tabular-nums">
                  ₹{computedCollectable.toLocaleString('en-IN')}
                </span>{' '}
                to collect
              </>
            )}
          </p>
        ) : (
          <p className="text-critical min-w-0 flex-1 text-xs font-medium max-sm:w-full">{error}</p>
        )}
        <div className="flex items-center gap-2 max-sm:w-full">{actions}</div>
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
