'use client';

import { useRouter } from 'next/navigation';

import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import {
  Banknote,
  CreditCard,
  MapPin,
  NotebookPen,
  OctagonX,
  PackageSearch,
  Save,
  Send,
  Trash2,
} from 'lucide-react';
import { Stepper } from '@skydrop/ui/app/stepper';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { ChoiceCards } from '@skydrop/ui/app/choice-cards';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { useUatField } from '@skydrop/ui/app/uat-fields';
import { Notice, OrdSection } from '../../../_components/orders-parts';
import { OrderedProducts, ProductCatalogue, type PickedLine } from '@/components/product-picker';
import {
  useDiscardDraftOrder,
  useOrderDetail,
  useStockList,
  useSubmitOrder,
  useUpdateOrder,
  type UpdateOrderInput,
} from '@/lib/api-hooks';
import { useSellerIdentity } from '@skydrop/auth/client';
import { verdict } from '@/i18n/verdict';
import {
  PACKAGE_TYPES,
  isPackageType,
  packageWords,
  type PackageTypeValue,
} from '@/lib/package-type';
import { useStores } from '@/lib/store-hooks';
import { linesAreDuplicated } from '@/lib/address-guidance';
import { prefixHint, stripSellerPrefix } from '@/lib/seller-prefix';
import {
  IN_DIAL,
  IN_LOCAL_LENGTH,
  isCompleteLocal,
  sanitiseLocal,
  toE164,
  toLocalDigits,
} from '@/lib/phone';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';

/**
 * Edit form for a DRAFT or PENDING_CONFIRMATION order.
 *
 * ── THE WHOLE ORDER IS EDITABLE UNTIL THE CALL CONFIRMS IT ───────────
 * Rewritten 2026-09-09. It previously locked the economics and the
 * lines the moment the order left DRAFT, on two arguments that did not
 * survive being checked:
 *
 *   - "the lines need a productId lookup OrderItemView doesn't carry" —
 *     the picker set `productId` and read it nowhere, so nothing needed
 *     one. The field is gone.
 *   - "it prevents the seller rewriting an item the agent has already
 *     discussed" — that moved to the server as EDIT_DURING_CALL, and on
 *     2026-09-18 the owner removed it too. The agent is told on their
 *     own screen that the order changed under them and re-reads it;
 *     refusing the seller bought nothing, because the call station was
 *     reading a snapshot the guard never protected anyway.
 *
 * Nothing is committed before CONFIRMED — no stock reserved (ORD-10),
 * no waybill booked (CUR-2b), no shipment — so an edit here rewrites a
 * row and nothing else. "Discard & recreate to swap a line" was also
 * advice that only worked on a DRAFT: a PENDING order with a wrong
 * product had no remedy at all short of cancelling it.
 *
 * A RESELLER STORE's order is edited here too (owner, 2026-09-18). The
 * seller owns the goods and the risk, so the whole order is theirs to
 * change; the store is emailed what moved, and the store's money is
 * recalculated to the new order under the terms it was PLACED on. Two
 * things the server still refuses and the UI does not pre-empt (FE-2):
 * a line with no transfer price in that store's catalogue, and changing
 * how a priced order is paid for.
 *   - "Discard draft" is a destructive secondary action with an
 *     inline typed-confirm.
 *   - "Save changes" PATCHes. "Save + submit" PATCHes then submits
 *     to the call queue (DRAFT only).
 *   - FE-2: server rejection surfaces `[code] message` VERBATIM.
 */

interface FormState {
  recipientName: string;
  recipientPhoneE164: string;
  recipientAltPhoneE164: string;
  recipientAddressLine1: string;
  recipientAddressLine2: string;
  recipientPostalCode: string;
  paymentMode: 'COD' | 'PREPAID';
  codAmountInr: string;
  /*
    THE THREE FIGURES THE COLLECTABLE IS MADE OF.

    The edit form asked for the COD amount but not the advance, the
    delivery fee or the discount it is derived from — so a seller could
    change the total and not the arithmetic behind it, and adding a
    product left the collectable stale. The create form has always asked
    for all four; the API accepts them on create and, since today, on
    edit too.
  */
  advanceAmountInr: string;
  deliveryFeeInr: string;
  discountInr: string;
  declaredValueInr: string;
  totalWeightGrams: string;
  /** '' means the order states none, which is a legitimate answer. */
  packageType: PackageTypeValue | '';
  isUrgent: boolean;
  sellerOrderRef: string;
  storeId: string;
  sellerNotes: string;
}

/** A figure said inside a sentence — the same en-IN grouping `Money` uses. */
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

export function EditOrderForm({ orderId }: { readonly orderId: string }): ReactElement {
  const t = useT();
  const sellerInitials = useSellerIdentity()?.initials ?? null;
  const router = useRouter();
  const toast = useToast();

  const detail = useOrderDetail(orderId);
  const update = useUpdateOrder(orderId);
  const submit = useSubmitOrder();
  const discard = useDiscardDraftOrder(orderId);

  const [form, setForm] = useState<FormState | null>(null);
  // Hidden for UAT (owner, 2026-10-26), code intact. Hidden on EDIT as
  // well as on create, deliberately: hiding a field on one and not the
  // other would mean an order could still acquire a discount after it
  // was placed, which is the same field arriving by the back door.
  const showDeliveryFee = useUatField('orderDeliveryFee');
  const showDiscount = useUatField('orderDiscount');
  const showDeclaredValue = useUatField('orderDeclaredValue');
  const [busy, setBusy] = useState<'save' | 'submit' | 'discard' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** "Save + submit" asks once before it saves and joins the call queue. */
  const [confirmSubmit, setConfirmSubmit] = useState(false);

  useEffect(() => {
    if (form !== null || !detail.data) return;
    const d = detail.data;
    setForm({
      // The stored value carries the seller code; the input holds the
      // NAME. Re-composed server-side on save, idempotently, so a stale
      // strip here can never double the prefix in the database.
      recipientName: stripSellerPrefix(sellerInitials, d.recipientName),
      recipientPhoneE164: d.recipientPhoneE164,
      recipientAltPhoneE164: d.recipientAltPhoneE164 ?? '',
      recipientAddressLine1: d.recipientAddressLine1,
      recipientAddressLine2: d.recipientAddressLine2 ?? '',
      recipientPostalCode: d.recipientPostalCode,
      paymentMode: d.paymentMode as 'COD' | 'PREPAID',
      codAmountInr: d.codAmountInr?.toString() ?? '',
      advanceAmountInr: d.advanceAmountInr?.toString() ?? '',
      deliveryFeeInr: d.deliveryFeeInr?.toString() ?? '',
      discountInr: d.discountInr?.toString() ?? '',
      declaredValueInr: d.declaredValueInr?.toString() ?? '',
      totalWeightGrams: d.totalWeightGrams?.toString() ?? '',
      // NOT defaulted to a value: an order with no package type stated
      // keeps none, and inventing one here would write a fact nobody
      // gave us onto every order anybody edits.
      packageType: isPackageType(d.packageType) ? d.packageType : '',
      isUrgent: d.isUrgent,
      sellerOrderRef: d.sellerOrderRef ?? '',
      storeId: d.storeId ?? '',
      sellerNotes: d.sellerNotes ?? '',
    });
    // sellerInitials is in the deps for correctness, though in practice
    // identity is hydrated by the (authed) layout before this query
    // resolves. If it ever were late, the seed would keep the prefix
    // visible in the input — cosmetic, because the server's compose is
    // idempotent and will not stack a second one on save.
  }, [detail.data, form, sellerInitials]);

  /*
    THE LINES ARE EDITABLE NOW.

    They were rendered read-only with "discard & recreate to swap" — an
    instruction that only works on a DRAFT, so a PENDING order with a
    wrong line had no remedy at all short of cancelling it. The API
    accepted an items replacement the whole time; nothing offered it,
    which is the same as it not existing.

    Seeded from the order's own snapshot (ORD-6) rather than re-resolved
    from the catalogue, so a line whose product was since renamed still
    reads as what the customer ordered. Sending `items` REPLACES the set
    — that is the server's contract, so the form always sends the whole
    list rather than a diff.
  */
  const stock = useStockList({ page: 1, pageSize: 100 });
  const [lines, setLines] = useState<PickedLine[] | null>(null);
  const [nextKey, setNextKey] = useState(1);

  useEffect(() => {
    if (lines !== null || detail.data === undefined) return;
    setLines(
      detail.data.items.map((it, i) => ({
        key: i,
        variantId: it.variantId,
        skuCode: it.skuCode,
        productName: it.productName,
        variantLabel: it.variantLabel,
        imageUrl: it.imageUrl,
        weightGrams: it.unitWeightGrams,
        catalogueValueInr: it.unitDeclaredValueInr,
        quantity: String(it.quantity),
        unitPriceInr: it.unitPriceInr ?? '',
      })),
    );
    setNextKey(detail.data.items.length);
  }, [detail.data, lines]);

  const stockByVariant = useMemo(() => {
    const m = new Map<string, { available: number; inTransit: number }>();
    for (const r of stock.data?.items ?? []) {
      m.set(r.variantId, { available: r.qtyAvailable, inTransit: r.qtyInTransit });
    }
    return m;
  }, [stock.data]);

  const stores = useStores();
  /** Only shopfronts still taking orders — plus the one this order is
   *  already on, so a retired store does not vanish from its own
   *  order and read as a data loss. */
  const openStores = useMemo(
    () => (stores.data ?? []).filter((st) => st.isActive || st.id === form?.storeId),
    [stores.data, form?.storeId],
  );

  /**
   * What the customer should be asked for, from the parts.
   *
   * The same expression the create form uses, so the two screens cannot
   * disagree about what a collectable is.
   */
  const computedCollectable = useMemo(() => {
    const num = (v: string): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const itemsTotal = (lines ?? []).reduce((n, l) => n + num(l.unitPriceInr) * num(l.quantity), 0);
    return (
      itemsTotal +
      num(form?.deliveryFeeInr ?? '') -
      num(form?.advanceAmountInr ?? '') -
      num(form?.discountInr ?? '')
    );
  }, [lines, form?.deliveryFeeInr, form?.advanceAmountInr, form?.discountInr]);

  /** Have the lines actually changed? Sending an unchanged set would
   *  delete and re-create every row for nothing, and would put "items"
   *  in the order's event timeline when nothing moved. */
  const linesChanged = useMemo(() => {
    if (lines === null || detail.data === undefined) return false;
    const before = detail.data.items.map(
      (i) => `${i.variantId}:${i.quantity}:${i.unitPriceInr ?? ''}`,
    );
    const after = lines.map((l) => `${l.variantId}:${Number(l.quantity)}:${l.unitPriceInr.trim()}`);
    return before.join('|') !== after.join('|');
  }, [lines, detail.data]);

  // The error check comes FIRST: `form` is only built from a loaded
  // order, so a failed load would otherwise sit on the spinner forever.
  if (detail.isError)
    return (
      <ErrorState
        message={verdict(detail.error, t, t('orderEdit.failedToLoadOrder'))}
        retry={() => void detail.refetch()}
      />
    );
  if (detail.isLoading || form === null)
    return <SkeletonRows rows={6} cols={2} label={t('orderEdit.loadingOrder')} />;
  if (!detail.data) return <ErrorState message={t('orderEdit.orderNotFound')} />;

  const status = detail.data.status;
  const isDraft = status === 'DRAFT';
  const isPending = status === 'PENDING_CONFIRMATION';
  const canEdit = isDraft || isPending;

  if (!canEdit) {
    return (
      <Notice tone="neutral" title={t('orderEdit.thisOrderIsNo')}>
        <span className="ord-p">
          {richMessage(t('orderEdit.statusTheServerAllows'), {
            span: <span className="sk-ident ord-strong">{status}</span>,
          })}
        </span>
        <div>
          <Button variant="secondary" onClick={() => router.push(`/orders/${orderId}`)}>
            {t('orderEdit.backToOrder')}
          </Button>
        </div>
      </Notice>
    );
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((p) => (p ? { ...p, [key]: value } : p));
  }

  function buildPatch(): UpdateOrderInput {
    if (!form || !detail.data) return {};
    // Use a mutable record then cast once at return — UpdateOrderInput
    // is readonly to prevent accidental mutation of the request body
    // after construction.
    const body: Record<string, unknown> = {
      recipientName: form.recipientName.trim(),
      recipientPhoneE164: form.recipientPhoneE164.trim(),
      recipientAddressLine1: form.recipientAddressLine1.trim(),
      recipientPostalCode: form.recipientPostalCode.trim(),
      paymentMode: form.paymentMode,
    };
    body.recipientAddressLine2 = form.recipientAddressLine2.trim();
    if (form.paymentMode === 'COD' && form.codAmountInr.trim())
      body.codAmountInr = Number(form.codAmountInr);
    // Sent as 0 rather than omitted when cleared: omitting a key means
    // "leave it alone" under PATCH semantics, so a seller removing a
    // discount would find it still there.
    body.advanceAmountInr = Number(form.advanceAmountInr) || 0;
    body.deliveryFeeInr = Number(form.deliveryFeeInr) || 0;
    body.discountInr = Number(form.discountInr) || 0;
    // Only when there IS one. Sending '' would be a 400, and sending an
    // invented default would silently state a package type the seller
    // never chose.
    if (form.packageType !== '') body.packageType = form.packageType;
    body.isUrgent = form.isUrgent;
    if (form.recipientAltPhoneE164.trim())
      body.recipientAltPhoneE164 = form.recipientAltPhoneE164.trim();
    if (form.sellerOrderRef !== (detail.data.sellerOrderRef ?? '')) {
      body.sellerOrderRef = form.sellerOrderRef.trim();
    }
    if (form.storeId !== '' && form.storeId !== (detail.data.storeId ?? '')) {
      body.storeId = form.storeId;
    }
    if (form.declaredValueInr.trim()) body.declaredValueInr = Number(form.declaredValueInr);
    if (form.totalWeightGrams.trim()) body.totalWeightGrams = Number(form.totalWeightGrams);
    if (form.sellerNotes !== (detail.data.sellerNotes ?? '')) {
      body.sellerNotes = form.sellerNotes;
    }
    if (linesChanged && lines !== null) {
      body.items = lines.map((l) => ({
        variantId: l.variantId,
        quantity: Number(l.quantity),
        ...(l.unitPriceInr.trim() ? { unitPriceInr: Number(l.unitPriceInr) } : {}),
      }));
    }
    return body as UpdateOrderInput;
  }

  function fmtError(err: unknown): string {
    return verdict(err, t, t('orderEdit.actionFailed'));
  }

  /** The same gate the create form uses, from the same module — the two
   *  screens edit the same field and must refuse the same values. */
  function phoneProblem(): string | null {
    if (!form) return null;
    return isCompleteLocal(toLocalDigits(form.recipientPhoneE164))
      ? null
      : t('guidance.phoneError', { len: IN_LOCAL_LENGTH, dial: IN_DIAL });
  }

  /** Same shape, same reason: the create form refuses duplicated address
   *  lines, so editing must not be the way round it. Advisory — the API
   *  has no such rule; the consequence downstream is a held order. */
  function addressProblem(): string | null {
    if (!form) return null;
    if (!form.recipientAddressLine2.trim()) return t('orderEdit.addressLine2The');
    return linesAreDuplicated(form.recipientAddressLine1, form.recipientAddressLine2)
      ? t('guidance.duplicateLines')
      : null;
  }

  async function onSave(e: FormEvent): Promise<void> {
    e.preventDefault();
    const bad = phoneProblem() ?? addressProblem();
    if (bad !== null) {
      setError(bad);
      return;
    }
    setError(null);
    setBusy('save');
    try {
      await update.mutateAsync(buildPatch());
      toast.success(t('orderEdit.changesSaved'));
      router.push(`/orders/${orderId}`);
    } catch (err) {
      setError(fmtError(err));
    } finally {
      setBusy(null);
    }
  }

  async function onSaveAndSubmit(): Promise<void> {
    // Same gate as onSave. It was missing here, so "Save + submit" was
    // a way around the phone and address rules that "Save" enforces —
    // a validation only one of two buttons runs is not a validation.
    const bad = phoneProblem() ?? addressProblem();
    if (bad !== null) {
      setError(bad);
      return;
    }
    setError(null);
    setBusy('submit');
    try {
      await update.mutateAsync(buildPatch());
      await submit.mutateAsync({ id: orderId });
      toast.success(t('orderEdit.savedAndSubmittedFor'));
      router.push(`/orders/${orderId}`);
    } catch (err) {
      setError(fmtError(err));
    } finally {
      setBusy(null);
    }
  }

  async function onDiscard(): Promise<void> {
    setError(null);
    setBusy('discard');
    try {
      await discard.mutateAsync();
      toast.success(t('orderEdit.draftDiscarded'));
      router.push('/orders');
    } catch (err) {
      setError(fmtError(err));
    } finally {
      setBusy(null);
    }
  }

  /*
    THE WHOLE ORDER IS EDITABLE UNTIL THE CALL CONFIRMS IT.

    This was `!isDraft` — the economics went read-only the moment the
    order entered the call queue. Nothing is committed before
    confirmation (no stock reserved, no waybill booked, no shipment), so
    the lock was earlier than the business needs.

    And editable DURING the call too (owner, 2026-09-18): the moment an
    agent is told the flat number is wrong is exactly when it needs
    fixing. The call station re-reads the order it holds and says on
    screen that it changed, which is what the refusal was standing in
    for and never actually achieved.
  */

  return (
    <form className="ord-page" onSubmit={(e) => void onSave(e)}>
      <p className="ord-p">
        {richMessage(t('orderEdit.editingOrderStatus'), {
          span: <span className="sk-ident ord-strong">{detail.data.orderNumber}</span>,
          span2: <span className="sk-ident ord-strong">{status}</span>,
          span3: isPending && <span>{t('orderEdit.editableUntilTheConfirmation')}</span>,
        })}
      </p>

      {/* A progress header over the SAME single form: it marks the
          section in view and scrolls to one on click. Nothing is hidden
          or unmounted — every field stays in the one form. */}
      <Stepper
        mode="sections"
        label={t('orderEdit.orderFormSections')}
        sticky
        steps={[
          { id: 'eo-items', label: t('orderEdit.items'), icon: <PackageSearch size={15} /> },
          { id: 'eo-recipient', label: t('orderEdit.recipient'), icon: <MapPin size={15} /> },
          { id: 'eo-payment', label: t('orderEdit.payment'), icon: <Banknote size={15} /> },
          { id: 'eo-notes', label: t('orderEdit.notes'), icon: <NotebookPen size={15} /> },
        ]}
      />

      {/* The lines — editable, because a wrong product on an order
          nobody has confirmed yet is a correction, not a reason to
          cancel and start again. */}
      <OrdSection
        id="eo-items"
        title={t('orderEdit.items')}
        note={
          linesChanged ? (
            <span className="ord-tone-warn">{t('orderEdit.changedSaveToApply')}</span>
          ) : (
            t('orderEdit.whatIsInThe')
          )
        }
      >
        {lines === null ? (
          <SkeletonRows rows={3} cols={3} label={t('orderEdit.loadingTheItems')} />
        ) : (
          <div className="ord-stack ord-stack--tight">
            <OrderedProducts
              lines={lines}
              stockByVariant={stockByVariant}
              onPatch={(key: number, patch: Partial<PickedLine>) =>
                setLines((prev) =>
                  (prev ?? []).map((l) => (l.key === key ? { ...l, ...patch } : l)),
                )
              }
              onRemove={(key) => setLines((prev) => (prev ?? []).filter((l) => l.key !== key))}
            />
            <ProductCatalogue
              lines={lines}
              stockByVariant={stockByVariant}
              onAdd={(hit) => {
                setLines((prev) => {
                  const existing = (prev ?? []).find((l) => l.variantId === hit.id);
                  // Adding something already on the order means "one
                  // more of those", not a second line for the same SKU.
                  if (existing !== undefined) {
                    return (prev ?? []).map((l) =>
                      l.variantId === hit.id
                        ? { ...l, quantity: String(Number(l.quantity || '0') + 1) }
                        : l,
                    );
                  }
                  return [
                    ...(prev ?? []),
                    {
                      key: nextKey,
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
                  ];
                });
                setNextKey((k) => k + 1);
              }}
            />
          </div>
        )}
      </OrdSection>

      <OrdSection
        id="eo-recipient"
        title={t('orderEdit.recipient')}
        note={t('orderEdit.whereItIsGoing')}
      >
        <div className="ord-grid-2">
          {/* Chrome, like the +91 below — the seller cannot edit their
              own code, so it is not part of the input. */}
          <TextField
            label={t('orderEdit.fullName')}
            required
            hint={prefixHint(sellerInitials, t)}
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
            label={t('orderEdit.phone')}
            required
            hint={t('orderEdit.digitsStarting69', {
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
            aria-label={t('orderEdit.phoneNumberThenDigits', {
              inDial: IN_DIAL,
              inLocalLength: IN_LOCAL_LENGTH,
            })}
            inputClassName="sk-figure"
          />
          <TextField
            label={t('orderEdit.secondNumber')}
            hint={t('orderEdit.triedWhenTheFirst')}
            lead={
              <span className="ord-prefix" aria-hidden>
                {IN_DIAL}
              </span>
            }
            value={toLocalDigits(form.recipientAltPhoneE164)}
            onChange={(e) =>
              set(
                'recipientAltPhoneE164',
                e.target.value.trim() === '' ? '' : toE164(sanitiseLocal(e.target.value)),
              )
            }
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={IN_LOCAL_LENGTH}
            placeholder="optional"
            aria-label={t('orderEdit.secondPhoneNumberThen', {
              inDial: IN_DIAL,
              inLocalLength: IN_LOCAL_LENGTH,
            })}
            inputClassName="sk-figure"
          />
          <div className="ord-span-2">
            <TextField
              label={t('orderEdit.addressLine1')}
              required
              hint={t('guidance.addressLine1Hint')}
              value={form.recipientAddressLine1}
              onChange={(e) => set('recipientAddressLine1', e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="ord-span-2">
            <TextField
              label={t('orderEdit.addressLine2')}
              required
              hint={t('guidance.addressLine2Hint')}
              error={
                linesAreDuplicated(form.recipientAddressLine1, form.recipientAddressLine2)
                  ? t('guidance.duplicateLines')
                  : undefined
              }
              value={form.recipientAddressLine2}
              onChange={(e) => set('recipientAddressLine2', e.target.value)}
              maxLength={200}
            />
          </div>
          <TextField
            label={t('orderEdit.pinCode')}
            required
            value={form.recipientPostalCode}
            onChange={(e) =>
              set('recipientPostalCode', e.target.value.replace(/\D/g, '').slice(0, 6))
            }
            inputMode="numeric"
            inputClassName="sk-figure"
          />
        </div>
      </OrdSection>

      <OrdSection
        id="eo-payment"
        title={t('orderEdit.paymentParcel')}
        note={t('orderEdit.whatTheCustomerPays')}
      >
        <div className="ord-stack ord-stack--tight">
          <ChoiceCards
            label={t('orderEdit.paymentMode')}
            required
            columns={2}
            value={form.paymentMode}
            onChange={(v) => set('paymentMode', v as 'COD' | 'PREPAID')}
            options={[
              { value: 'PREPAID', title: t('orderEdit.prepaid'), icon: <CreditCard size={16} /> },
              { value: 'COD', title: t('orderEdit.cashOnDelivery'), icon: <Banknote size={16} /> },
            ]}
          />
          <div className="ord-grid-2">
            {showDeliveryFee ? (
              <TextField
                label={t('orderEdit.deliveryFeeChargedTo')}
                type="number"
                min={0}
                step="0.01"
                value={form.deliveryFeeInr}
                onChange={(e) => set('deliveryFeeInr', e.target.value)}
                inputClassName="sk-figure"
              />
            ) : null}
            <TextField
              label={t('orderEdit.advanceAlreadyPaidInr')}
              type="number"
              min={0}
              step="0.01"
              value={form.advanceAmountInr}
              onChange={(e) => set('advanceAmountInr', e.target.value)}
              inputClassName="sk-figure"
            />
            {showDiscount ? (
              <TextField
                label={t('orderEdit.discountInr')}
                type="number"
                min={0}
                step="0.01"
                value={form.discountInr}
                onChange={(e) => set('discountInr', e.target.value)}
                inputClassName="sk-figure"
              />
            ) : null}
            {form.paymentMode === 'COD' && (
              <TextField
                label={t('orderEdit.codAmountInr')}
                required
                /*
                  The same arithmetic the create form shows. It is a
                  NOTICE and not an auto-write: the field holds what the
                  order currently says, and quietly overwriting a figure
                  a seller typed on purpose — a rounded-down total, a
                  waived charge — is worse than telling them the parts no
                  longer add up.
                */
                notice={
                  Math.abs(computedCollectable - (Number(form.codAmountInr) || 0)) > 0.005
                    ? t('orderEdit.itemsDeliveryAdvanceDiscount', {
                        inr: inr.format(computedCollectable),
                      })
                    : undefined
                }
                type="number"
                min={0.01}
                step="0.01"
                value={form.codAmountInr}
                onChange={(e) => set('codAmountInr', e.target.value)}
                inputClassName="sk-figure"
                after={
                  Math.abs(computedCollectable - (Number(form.codAmountInr) || 0)) > 0.005 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => set('codAmountInr', computedCollectable.toFixed(2))}
                    >
                      {richMessage(t('orderEdit.use'), { inr: inr.format(computedCollectable) })}
                    </Button>
                  ) : undefined
                }
              />
            )}
            {showDeclaredValue ? (
              <TextField
                label={t('orderEdit.declaredValueInr')}
                type="number"
                min={0}
                step="0.01"
                value={form.declaredValueInr}
                onChange={(e) => set('declaredValueInr', e.target.value)}
                inputClassName="sk-figure"
              />
            ) : null}
            <TextField
              label={t('orderEdit.totalWeightGrams')}
              type="number"
              min={0}
              value={form.totalWeightGrams}
              onChange={(e) => set('totalWeightGrams', e.target.value)}
              inputClassName="sk-figure"
            />
            <Select
              label={t('orderEdit.packageType')}
              value={form.packageType}
              onChange={(e) => set('packageType', e.target.value as PackageTypeValue | '')}
            >
              <option value="">{t('orderEdit.notStated')}</option>
              {PACKAGE_TYPES.map((kind) => (
                <option key={kind} value={kind}>
                  {packageWords(kind, t)}
                </option>
              ))}
            </Select>
            <TextField
              label={t('orderEdit.orderId')}
              value={form.sellerOrderRef}
              maxLength={100}
              placeholder={t('orderEdit.eGTheNumber')}
              onChange={(e) => set('sellerOrderRef', e.target.value)}
              inputClassName="sk-ident"
            />
            {openStores.length > 1 && (
              <Select
                label={t('orderEdit.store')}
                hint={t('orderEdit.whichOfYourShops')}
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
            )}
            <Checkbox
              label={t('orderEdit.treatThisOrderAs')}
              checked={form.isUrgent}
              onChange={(e) => set('isUrgent', e.target.checked)}
            />
          </div>
        </div>
      </OrdSection>

      {/* Notes — always editable */}
      <OrdSection id="eo-notes" title={t('orderEdit.notes')} note={t('orderEdit.forUsNeverThe')}>
        <TextArea
          label={t('orderEdit.deliveryNotes')}
          rows={3}
          maxLength={2000}
          value={form.sellerNotes}
          onChange={(e) => set('sellerNotes', e.target.value)}
          placeholder={t('orderEdit.anythingTheCallAgent')}
        />
      </OrdSection>

      {error && (
        <Notice tone="bad" role="alert" icon={<OctagonX size={16} />}>
          <span>{error}</span>
        </Notice>
      )}

      <div className="ord-bar">
        {isDraft ? (
          <Button
            type="button"
            variant="ghost"
            icon={<Trash2 size={15} />}
            disabled={busy !== null}
            onClick={() => setConfirmDiscard(true)}
          >
            {t('orderEdit.discardDraft')}
          </Button>
        ) : (
          <span />
        )}
        <div className="ord-bar__actions">
          <Button
            type="button"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => router.push(`/orders/${orderId}`)}
          >
            {t('orderEdit.cancel')}
          </Button>
          <AsyncButton
            type="submit"
            variant="secondary"
            icon={<Save size={15} />}
            state={busy === 'save' ? 'busy' : undefined}
            labels={{ idle: t('orderEdit.saveChanges'), busy: t('orderEdit.saving') }}
            disabled={busy !== null}
          />
          {isDraft && (
            <AsyncButton
              type="button"
              variant="primary"
              icon={<Send size={15} />}
              state={busy === 'submit' ? 'busy' : undefined}
              labels={{ idle: t('orderEdit.saveSubmit'), busy: t('orderEdit.submitting') }}
              disabled={busy !== null}
              onClick={() => setConfirmSubmit(true)}
            />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmSubmit}
        onOpenChange={setConfirmSubmit}
        title={t('orderEdit.saveAndSubmitFor')}
        entity={detail.data.orderNumber}
        entityIsIdentifier
        amount={
          form.paymentMode === 'COD' && form.codAmountInr.trim() !== ''
            ? t('orderEdit.amountToCollect', { amount: inr.format(Number(form.codAmountInr)) })
            : form.paymentMode === 'COD'
              ? undefined
              : t('orderEdit.prepaid')
        }
        consequence={t('orderEdit.saveSubmitConsequence')}
        confirmLabel={t('orderEdit.saveSubmit')}
        onConfirm={() => onSaveAndSubmit()}
      />
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={t('orderEdit.discardThisDraft')}
        entity={detail.data.orderNumber}
        entityIsIdentifier
        consequence={t('orderEdit.discardConsequence')}
        confirmLabel={t('orderEdit.yesDiscard')}
        destructive
        onConfirm={() => onDiscard()}
      />
    </form>
  );
}
