'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import type { SellerVariantSearchHit } from '@skydrop/api-client';
import { OrderedProducts, ProductCatalogue, type PickedLine } from '@/components/product-picker';
import { Money } from '@skydrop/ui/components';
import {
  ArrowLeft,
  Banknote,
  CreditCard,
  ListChecks,
  MapPin,
  NotebookPen,
  OctagonX,
  PackageSearch,
  PackageX,
  Save,
  Scale,
  Send,
  Store,
} from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Stepper } from '@skydrop/ui/app/stepper';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { VanDriveOffButton } from '@skydrop/ui/app/van-drive-off';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { ChoiceCards } from '@skydrop/ui/app/choice-cards';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { useToast } from '@skydrop/ui/app/toast';
import { useUatField } from '@skydrop/ui/app/uat-fields';
import { BackLink, Notice, OrdSection } from '../../_components/orders-parts';
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
import { verdict } from '@/i18n/verdict';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';

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
  const t = useT();
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

  // Hidden for UAT (owner, 2026-10-26), code intact. Hidden means the
  // input is not rendered, so each stays at its initial value and the
  // payload omits it — landing on the server defaults the API has
  // always applied: fee 0, discount 0, and a declared value computed
  // from the catalogue. Reversible from UAT Settings when that lands.
  const showDeliveryFee = useUatField('orderDeliveryFee');
  const showDiscount = useUatField('orderDiscount');
  const showDeclaredValue = useUatField('orderDeclaredValue');
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
  // Drives the van's error state only: set when a SUBMIT did not go through.
  const [submitFailed, setSubmitFailed] = useState(false);
  /**
   * Ticked by the seller when they mean to order stock we do not have
   * yet. Mirrors the duplicate-order acknowledgement already in this
   * form: the block is real, and getting past it is one deliberate act
   * rather than a dialog you dismiss without reading.
   */
  const [acceptShort, setAcceptShort] = useState(false);
  /** "Submit for confirmation" asks once before it creates and submits. */
  const [confirmSubmit, setConfirmSubmit] = useState(false);

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
    toast.success(t('orderNew.filledFromTheirLast'));
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
    if (!form.recipientName.trim()) return t('orderNew.recipientNameIsRequired');
    if (!isCompleteLocal(toLocalDigits(form.recipientPhoneE164))) return IN_PHONE_ERROR;
    if (!form.recipientAddressLine1.trim()) return t('orderNew.addressLine1Is');
    if (!form.recipientAddressLine2.trim()) return t('orderNew.addressLine2The');
    // Advisory, NOT a mirror of a server rule — the API has no such
    // check, so a CSV import still gets through. It is here because
    // duplicated lines get the order held by hand downstream, and
    // finding that out at the field beats finding it out afterwards.
    if (linesAreDuplicated(form.recipientAddressLine1, form.recipientAddressLine2))
      return DUPLICATE_LINES_ERROR;
    if (!/^[1-9]\d{5}$/.test(form.recipientPostalCode.trim())) return t('orderNew.pinMustBe6');
    const effectiveCollectable = computedCollectable;
    if (form.paymentMode === 'COD' && !(effectiveCollectable > 0))
      return t('orderNew.theCollectableAmountMust');
    if (shortLines.length > 0 && !acceptShort) {
      return t('orderNew.someProductsAreShort');
    }
    // A line cannot exist without a product now — it is created by
    // clicking one — so the only thing left to check is the quantity.
    if (items.length === 0) return t('orderNew.atLeastOneProduct');
    for (const it of items) {
      const qty = Number(it.quantity);
      if (!Number.isFinite(qty) || qty < 1)
        return t('orderNew.quantityMustBeAt', { skuCode: it.skuCode });
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
    setSubmitFailed(false);
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
        toast.success(
          t('orderNew.orderSubmittedForConfirmation', { orderNumber: created.orderNumber }),
        );
      } else {
        toast.success(t('orderNew.draftOrderSaved', { orderNumber: created.orderNumber }));
      }
      setDuplicates(null);
      router.push(`/orders/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        const b = err.body as {
          code?: unknown;
          details?: { existingOrders?: unknown };
        } | null;
        // The one refusal that gets a conversation rather than a
        // verdict: the seller has to be able to SEE what they would be
        // duplicating, because the question is "is this the same order?"
        if (b?.code === 'DUPLICATE_ORDER_SUSPECTED' && Array.isArray(b.details?.existingOrders)) {
          setDuplicates(b.details.existingOrders as ReadonlyArray<DuplicateCandidate>);
          setPendingAction(action);
          setBusy(null);
          return;
        }
      }
      setError(verdict(err, t, t('orderNew.failedToCreateOrder')));
      if (action === 'submit') setSubmitFailed(true);
      setBusy(null);
    }
  }

  /** What "Submit for confirmation" does, from the button or from Enter:
   *  a form that would be refused goes straight to `go`, which names the
   *  problem exactly as before; only a submit that can go through is
   *  asked to confirm first. */
  function requestSubmit(): void {
    if (validate() !== null) {
      void go('submit', null);
      return;
    }
    setConfirmSubmit(true);
  }

  /** The three actions, rendered twice — at the top and on the sticky
   *  bar. A long form whose only submit is 1,400px below the fold makes
   *  a seller scroll past everything they have just checked.
   *
   *  "Submit for confirmation" is the VAN, as the BUSY state (owner,
   *  2026-09-24): it turns into the van the moment the order is sent and
   *  keeps driving while it is created; the page navigates the instant the
   *  API succeeds, so nothing waits for the animation. If it does not go
   *  through, the van reverses into the button, which shows the error. */
  const actions = (
    <>
      {/* Desktop only in BOTH placements. On a phone the sticky bar is
          the only action strip, and "Back to orders" sits at the top of
          the page doing the same thing. */}
      <Button
        type="button"
        variant="ghost"
        className="ord-desktop-only"
        disabled={busy !== null}
        onClick={() => router.push('/orders')}
      >
        {t('orderNew.cancel')}
      </Button>
      <AsyncButton
        type="button"
        variant="secondary"
        className="ord-nowrap"
        icon={<Save size={15} />}
        state={busy === 'draft' ? 'busy' : undefined}
        labels={{ idle: t('orderNew.saveAsDraft'), busy: t('orderNew.saving') }}
        disabled={busy !== null}
        onClick={(e) => void go('draft', e)}
      />
      <VanDriveOffButton
        type="submit"
        mode="while-busy"
        variant="primary"
        className="ord-nowrap"
        icon={<Send size={15} />}
        label={t('orderNew.submitForConfirmation')}
        busyLabel={t('orderNew.submitting')}
        errorLabel={t('orderNew.notSubmitted')}
        state={busy === 'submit' ? 'busy' : submitFailed ? 'error' : 'idle'}
        disabled={busy === 'draft'}
        onAction={async () => {
          requestSubmit();
        }}
      />
    </>
  );

  const serviceabilityChip =
    serviceability.data?.known !== true ? null : serviceability.data.serviceable ? (
      <span className="ord-serviceable" data-ok="1">
        <MapPin size={12} aria-hidden />
        {t('orderNew.weDeliverThere')}
      </span>
    ) : (
      <span className="ord-serviceable" data-ok="0">
        <MapPin size={12} aria-hidden />
        {t('orderNew.mayNotBeServiceable')}
      </span>
    );

  const storeHint =
    openStores.length > 1 ? t('orderNew.whichOfYourShops') : t('orderNew.everyOrderIsFiled');

  return (
    <form
      className="ord-page"
      onSubmit={(e) => {
        e.preventDefault();
        requestSubmit();
      }}
    >
      <BackLink href="/orders" icon={<ArrowLeft size={14} aria-hidden />}>
        {t('orderNew.backToOrders')}
      </BackLink>

      <PageHeader
        breadcrumbs={[
          { label: t('orderNew.clientConsole') },
          { label: t('orderNew.fulfilment') },
          { label: t('orderNew.orders2'), href: '/orders' },
          { label: t('orderNew.new') },
        ]}
        Link={Link}
        title={t('orderNew.newOrder')}
        subtitle={t('orderNew.whoItGoesTo')}
        // Desktop only. The sticky bar carries the same three actions and
        // is always on screen; on a phone the pair together cost about a
        // fifth of the viewport before a single field is visible.
        action={<div className="ord-row ord-desktop-only">{actions}</div>}
      />

      {/* A progress header over the SAME single form: it marks the
          section in view and scrolls to one on click. Nothing is hidden
          or unmounted — every field stays in the one form. */}
      <Stepper
        mode="sections"
        label={t('orderNew.orderFormSections')}
        sticky
        steps={[
          { id: 'no-recipient', label: t('orderNew.recipient'), icon: <MapPin size={15} /> },
          { id: 'no-notes', label: t('orderNew.reference'), icon: <NotebookPen size={15} /> },
          { id: 'no-products', label: t('orderNew.products'), icon: <PackageSearch size={15} /> },
          { id: 'no-lines', label: t('orderNew.ordered'), icon: <ListChecks size={15} /> },
          { id: 'no-payment', label: t('orderNew.payment'), icon: <Banknote size={15} /> },
        ]}
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
        the money those lines add up to.
      */}
      <div className="ord-split">
        {/* ── Left: what the customer told them ─────────────────── */}
        <div className="ord-stack">
          <OrdSection
            id="no-recipient"
            title={t('orderNew.recipient')}
            note={t('orderNew.whereTheParcelIs')}
            action={serviceabilityChip}
          >
            <div className="ord-stack ord-stack--tight">
              {/* The seller's own order id, FIRST — owner, 2026-10-26.
                  It is the number they already have in their own system
                  and the one they will quote when they ring about this
                  parcel, so it is the first thing they copy across
                  rather than the last. */}
              <TextField
                label={t('orderNew.orderId')}
                hint={t('orderNew.optionalYourOwnOrder')}
                value={form.sellerOrderRef}
                onChange={(e) => set('sellerOrderRef', e.target.value)}
                maxLength={120}
                placeholder={t('orderNew.ord20249981')}
                inputClassName="sk-ident"
              />
              {/* The seller code is CHROME, exactly like the +91 below:
                  it cannot be edited or deleted, and the field holds only
                  the customer's name. The API composes the stored value,
                  so a CSV import lands the same shape as this form. */}
              <TextField
                label={t('orderNew.fullName')}
                required
                hint={prefixHint(sellerInitials)}
                lead={
                  sellerInitials !== null && sellerInitials !== '' ? (
                    <span className="ord-prefix" aria-hidden>
                      {sellerInitials}
                    </span>
                  ) : undefined
                }
                value={form.recipientName}
                onChange={(e) => set('recipientName', e.target.value)}
                maxLength={160}
              />
              {/* The dial code is CHROME, not input: it cannot be edited
                  or deleted, so a seller cannot clear it, type 0091, or
                  paste a differently-formatted number into it. The field
                  itself holds only the ten national digits. */}
              <TextField
                label={t('orderNew.phone')}
                required
                hint={t('orderNew.digitsStarting69', {
                  inDial: IN_DIAL,
                  inLocalLength: IN_LOCAL_LENGTH,
                })}
                lead={
                  <span className="ord-prefix" aria-hidden>
                    {IN_DIAL}
                  </span>
                }
                value={toLocalDigits(form.recipientPhoneE164)}
                onChange={(e) => set('recipientPhoneE164', toE164(sanitiseLocal(e.target.value)))}
                // inputMode drives the numeric keypad on a phone; the
                // sanitiser is what actually enforces digits, because a
                // paste bypasses the keypad entirely.
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={IN_LOCAL_LENGTH}
                placeholder="9812345678"
                aria-label={t('orderNew.phoneNumberThenDigits', {
                  inDial: IN_DIAL,
                  inLocalLength: IN_LOCAL_LENGTH,
                })}
                inputClassName="sk-figure"
              />
              <TextField
                label={t('orderNew.addressLine1')}
                required
                hint={ADDRESS_LINE_1_HINT}
                value={form.recipientAddressLine1}
                onChange={(e) => set('recipientAddressLine1', e.target.value)}
                maxLength={200}
              />
              <TextField
                label={t('orderNew.addressLine2The2')}
                required
                hint={ADDRESS_LINE_2_HINT}
                error={
                  linesAreDuplicated(form.recipientAddressLine1, form.recipientAddressLine2)
                    ? DUPLICATE_LINES_ERROR
                    : undefined
                }
                value={form.recipientAddressLine2}
                onChange={(e) => set('recipientAddressLine2', e.target.value)}
                maxLength={200}
              />
              <TextField
                label={t('orderNew.pinCode')}
                required
                // A WARNING, so `notice` and not `hint`: it is the one
                // thing on this field the seller did not ask about and
                // needs anyway. Advisory all the same — it informs and
                // never blocks the submit.
                notice={
                  serviceability.data?.known === true && !serviceability.data.serviceable
                    ? (serviceability.data.reason ?? t('orderNew.ourCourierMayNot'))
                    : undefined
                }
                hint={t('orderNew.delhiveryRoutesOnThe')}
                value={form.recipientPostalCode}
                onChange={(e) =>
                  set('recipientPostalCode', e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                placeholder="560001"
                inputMode="numeric"
                inputClassName="sk-figure"
              />
            </div>
          </OrdSection>

          <OrdSection
            id="no-notes"
            title={t('orderNew.referenceNotes')}
            note={t('orderNew.yoursAndTheCall')}
          >
            <div className="ord-stack ord-stack--tight">
              {/*
                Always SHOWN, only sometimes a CHOICE.

                A dropdown with one option is a question nobody asked —
                but hiding the field entirely leaves somebody with two
                shopfronts in mind wondering where the setting went. One
                store reads as a statement with a way to add another; two
                or more becomes a select.
              */}
              {openStores.length > 1 ? (
                <Select
                  label={t('orderNew.store')}
                  hint={storeHint}
                  value={form.storeId}
                  onChange={(e) => set('storeId', e.target.value)}
                >
                  {openStores.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                      {st.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </Select>
              ) : (
                <div className="ord-stack ord-stack--tight">
                  <span className="ord-strong">{t('orderNew.store')}</span>
                  <div className="ord-store-line">
                    <span className="ord-store-line__name">
                      <Store size={14} aria-hidden />
                      <span>{openStores[0]?.name ?? t('orderNew.yourDefaultStore')}</span>
                    </span>
                    <Link href="/settings/stores" className="ord-link">
                      {t('orderNew.manageStores')}
                    </Link>
                  </div>
                  <span className="ord-faint">{storeHint}</span>
                </div>
              )}
              <TextArea
                label={t('orderNew.deliveryNotes')}
                hint={t('orderNew.readOutOnThe')}
                rows={3}
                value={form.sellerNotes}
                onChange={(e) => set('sellerNotes', e.target.value)}
                placeholder={t('orderNew.anythingTheCallAgent')}
              />
            </div>
          </OrdSection>
        </div>

        {/* ── Right: what they are sending, and what it comes to ─── */}
        <div className="ord-stack">
          <OrdSection
            id="no-products"
            title={t('orderNew.clickToAddProducts')}
            note={t('orderNew.priceAndStockAre')}
            flush
          >
            <ProductCatalogue
              lines={items}
              stockByVariant={stockByVariant}
              onAdd={addFromCatalogue}
            />
          </OrdSection>

          <OrdSection
            id="no-lines"
            title={t('orderNew.orderedProducts')}
            note={t(items.length === 1 ? 'orderNew.itemCountOne' : 'orderNew.itemCountMany', {
              count: items.length,
            })}
            action={
              items.length === 0 ? null : (
                <span className="ord-strong sk-figure">
                  {richMessage(t('orderNew.subtotal'), {
                    money: <Money amount={itemsTotal} convert={false} />,
                  })}
                </span>
              )
            }
            flush
          >
            <OrderedProducts
              lines={items}
              stockByVariant={stockByVariant}
              onPatch={patchItem}
              onRemove={removeItem}
            />
          </OrdSection>

          {shortLines.length > 0 && (
            <Notice
              tone="bad"
              icon={<PackageX size={16} />}
              title={
                shortLines.length === 1
                  ? t('orderNew.oneProductIsShort')
                  : t('orderNew.productsAreShortOf', { shortLines: shortLines.length })
              }
            >
              <ul className="ord-mini-list">
                {shortLines.map((l) => (
                  <li key={l.variantId} className="ord-faint">
                    {l.have === 0
                      ? t('orderNew.askedForNone', { want: l.want })
                      : t('orderNew.askedForOnly', { want: l.want, have: l.have })}
                  </li>
                ))}
              </ul>
              <span className="ord-faint">{t('orderNew.youCanStillPlace')}</span>
              <Checkbox
                checked={acceptShort}
                onChange={(e) => setAcceptShort(e.target.checked)}
                label={t('orderNew.placeItAnyway')}
              />
            </Notice>
          )}

          <OrdSection
            id="no-payment"
            title={t('orderNew.paymentParcel')}
            note={t('orderNew.whatTheCustomerPays')}
          >
            {/*
              Two cards, not a dropdown. There are exactly two answers,
              one of them is nearly always the right one, and which is
              chosen changes what the rest of this card means.
            */}
            <ChoiceCards
              label={t('orderNew.paymentMode')}
              required
              columns={2}
              value={form.paymentMode}
              onChange={(v) => set('paymentMode', v === 'PREPAID' ? 'PREPAID' : 'COD')}
              options={[
                { value: 'COD', title: t('orderNew.cashOnDelivery'), icon: <Banknote size={16} /> },
                { value: 'PREPAID', title: t('orderNew.prepaid'), icon: <CreditCard size={16} /> },
              ]}
            />

            {/* The collectable sits DIRECTLY under the payment mode
                (owner, 2026-10-26). It is the number the call centre
                reads to the customer and the one the driver asks for,
                so it belongs with the choice that decides whether it is
                collected at all — not at the bottom behind the parcel's
                weight. */}
            {form.paymentMode === 'COD' ? (
              /*
                The one figure the customer is asked for at the door,
                and the one the call centre reads out — the loudest thing
                on the card, with its own arithmetic printed underneath
                so it can be checked at a glance.
              */
              <div className="ord-collect">
                <TextField
                  id="collectable-amount"
                  label={t('orderNew.collectableAmountInr')}
                  required
                  className="ord-collect__field"
                  lead={
                    <span className="ord-prefix" aria-hidden>
                      ₹
                    </span>
                  }
                  type="number"
                  min={0.01}
                  step="0.01"
                  inputClassName="sk-figure"
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
                />
                <p className="ord-collect__sum sk-figure">
                  {/* The arithmetic, spelled out. A number the call centre
                      reads to a customer should be checkable at a glance. */}
                  {t('orderNew.ofGoods', { total: itemsTotal.toLocaleString('en-IN') })}
                  {num(form.deliveryFeeInr) !== 0
                    ? t('orderNew.delivery', {
                        deliveryFeeInr: num(form.deliveryFeeInr).toLocaleString('en-IN'),
                      })
                    : ''}
                  {num(form.advanceAmountInr) !== 0
                    ? t('orderNew.advance', {
                        advanceAmountInr: num(form.advanceAmountInr).toLocaleString('en-IN'),
                      })
                    : ''}
                  {/* A NEGATIVE discount is a surcharge, and reads as one.
                      "− -40 discount" is arithmetic nobody should have to
                      parse to check their own total. */}
                  {num(form.discountInr) > 0
                    ? t('orderNew.discount', {
                        discountInr: num(form.discountInr).toLocaleString('en-IN'),
                      })
                    : num(form.discountInr) < 0
                      ? t('orderNew.surcharge', {
                          discountInr: Math.abs(num(form.discountInr)).toLocaleString('en-IN'),
                        })
                      : ''}
                  {` = ${computedCollectable.toLocaleString('en-IN')}`}
                </p>
              </div>
            ) : (
              <Notice
                tone="neutral"
                icon={<CreditCard size={16} />}
                title={t('orderNew.nothingToCollectAt')}
              >
                <span className="ord-faint">
                  {richMessage(t('orderNew.prepaidNote'), {
                    amount: (
                      <span className="sk-figure">₹{itemsTotal.toLocaleString('en-IN')}</span>
                    ),
                  })}
                </span>
              </Notice>
            )}

            <div className="ord-grid-2" style={{ marginTop: 'var(--sp-3)' }}>
              {showDeliveryFee ? (
                <TextField
                  label={t('orderNew.deliveryFeeInr')}
                  hint={
                    feeDefault.data === undefined
                      ? t('orderNew.addedToTheCollectable')
                      : t('orderNew.addedToTheCollectable2', {
                          amountInr: feeDefault.data.amountInr,
                        })
                  }
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.deliveryFeeInr}
                  onChange={(e) => set('deliveryFeeInr', e.target.value)}
                  inputClassName="sk-figure"
                />
              ) : null}
              <TextField
                label={t('orderNew.advanceAlreadyPaidInr')}
                hint={t('orderNew.deductedFromTheCollectable')}
                type="number"
                min={0}
                step="0.01"
                value={form.advanceAmountInr}
                onChange={(e) => set('advanceAmountInr', e.target.value)}
                placeholder="0"
                inputClassName="sk-figure"
              />
              {showDiscount ? (
                <TextField
                  label={t('orderNew.discountInr')}
                  hint={t('orderNew.deductedFromTheCollectable')}
                  type="number"
                  step="0.01"
                  value={form.discountInr}
                  onChange={(e) => set('discountInr', e.target.value)}
                  placeholder="0"
                  inputClassName="sk-figure"
                />
              ) : null}
              {showDeclaredValue ? (
                <TextField
                  label={t('orderNew.declaredValueInr')}
                  hint={
                    computedDeclaredValue > 0
                      ? t('orderNew.forCustomsNotCollection', {
                          computedDeclaredValue: computedDeclaredValue.toLocaleString('en-IN'),
                        })
                      : t('orderNew.theParcelSValue')
                  }
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.declaredValueInr}
                  onChange={(e) => set('declaredValueInr', e.target.value)}
                  inputClassName="sk-figure"
                  placeholder={
                    computedDeclaredValue > 0
                      ? computedDeclaredValue.toLocaleString('en-IN')
                      : t('orderNew.sumOfTheLine')
                  }
                />
              ) : null}
              <div className="ord-span-2">
                <TextField
                  // The unit is the suffix on the field itself; saying
                  // it twice reads as two different things being asked for.
                  label={t('orderNew.totalWeight')}
                  hint={
                    computedWeight > 0
                      ? t('orderNew.addsUpToG', {
                          computedWeight: computedWeight.toLocaleString('en-IN'),
                        })
                      : t('orderNew.noneOfTheseProducts')
                  }
                  type="number"
                  min={0}
                  inputClassName="sk-figure"
                  value={form.totalWeightGrams}
                  onChange={(e) => set('totalWeightGrams', e.target.value)}
                  placeholder={computedWeight > 0 ? computedWeight.toLocaleString('en-IN') : '0'}
                  // A SUFFIX. The unit follows the figure when it is
                  // spoken, and a "grams" box in front of an empty
                  // field reads as a label for the wrong thing.
                  trail={
                    <span className="ord-suffix" aria-hidden>
                      <Scale size={13} />
                      grams
                    </span>
                  }
                />
              </div>
            </div>
          </OrdSection>
        </div>
      </div>

      {error && (
        <Notice tone="bad" role="alert" icon={<OctagonX size={16} />}>
          <span>{error}</span>
        </Notice>
      )}

      {/*
        The sticky bar carries the totals as well as the buttons: the
        two things a seller checks before committing are "did I get the
        money right" and "how many lines", and both were a scroll away
        from the button that commits them.
      */}
      <div className="ord-bar">
        {/*
          The refusal goes HERE, next to the button that was refused —
          the bar is the one part of this page that is always on screen.
        */}
        {error === null ? (
          <p className="ord-bar__summary">
            {items.length === 0
              ? t('orderNew.noProductsYet')
              : // "products", not "lines" — a line is what the order model
                // calls it and nobody outside this codebase does.
                t(items.length === 1 ? 'orderNew.productCountOne' : 'orderNew.productCountMany', {
                  count: items.length,
                })}
            {form.paymentMode === 'COD' && computedCollectable > 0 && (
              <>
                {' · '}
                <span className="ord-strong sk-figure">
                  ₹{computedCollectable.toLocaleString('en-IN')}
                </span>{' '}
                {t('orderNew.toCollect')}
              </>
            )}
          </p>
        ) : (
          <p className="ord-bar__summary ord-error">{error}</p>
        )}
        <div className="ord-bar__actions">{actions}</div>
      </div>

      <ConfirmDialog
        open={confirmSubmit}
        onOpenChange={setConfirmSubmit}
        title={t('orderNew.submitThisOrderFor')}
        entity={`${form.recipientName.trim()} · ${IN_DIAL} ${toLocalDigits(form.recipientPhoneE164)}`}
        amount={
          form.paymentMode === 'COD' && computedCollectable > 0 ? (
            <>
              {richMessage(t('orderNew.toCollect2'), {
                computedCollectable: computedCollectable.toLocaleString('en-IN'),
              })}
            </>
          ) : (
            t('orderNew.prepaid')
          )
        }
        consequence={t(
          items.length === 1 ? 'orderNew.consequenceOne' : 'orderNew.consequenceMany',
          { count: items.length },
        )}
        confirmLabel={t('orderNew.submitForConfirmation')}
        // Closes at once: the van on the page carries the busy state while
        // the order is created (go() never throws — it reports on the page).
        onConfirm={() => {
          void go('submit', null);
        }}
      />

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
