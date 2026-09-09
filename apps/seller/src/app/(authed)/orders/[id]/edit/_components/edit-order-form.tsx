'use client';

import { useRouter } from 'next/navigation';

import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Select,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
import { OrderedProducts, ProductCatalogue, type PickedLine } from '@/components/product-picker';
import { ApiError } from '@skydrop/api-client';
import {
  useDiscardDraftOrder,
  useOrderDetail,
  useStockList,
  useSubmitOrder,
  useUpdateOrder,
  type UpdateOrderInput,
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
 *     discussed" — the real version of that concern is narrower and now
 *     lives on the SERVER: an items or economics edit is refused while
 *     an agent is actually holding the order (EDIT_DURING_CALL), and
 *     allowed while it merely waits in the queue.
 *
 * Nothing is committed before CONFIRMED — no stock reserved (ORD-10),
 * no waybill booked (CUR-2b), no shipment — so an edit here rewrites a
 * row and nothing else. "Discard & recreate to swap a line" was also
 * advice that only worked on a DRAFT: a PENDING order with a wrong
 * product had no remedy at all short of cancelling it.
 *
 * The mid-call refusal is deliberately NOT mirrored client-side (FE-2):
 * the UI cannot know a call started thirty seconds ago, and a guess
 * would either lock a seller out of an order nobody is calling about or
 * promise an edit the server then refuses. The verdict surfaces
 * verbatim.
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
  packageType: 'STANDARD' | 'FRAGILE' | 'DOCUMENT';
  isUrgent: boolean;
  sellerOrderRef: string;
  storeId: string;
  sellerNotes: string;
}

export function EditOrderForm({ orderId }: { readonly orderId: string }): ReactElement {
  const sellerInitials = useSellerIdentity()?.initials ?? null;
  const router = useRouter();
  const toast = useToast();

  const detail = useOrderDetail(orderId);
  const update = useUpdateOrder(orderId);
  const submit = useSubmitOrder();
  const discard = useDiscardDraftOrder(orderId);

  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState<'save' | 'submit' | 'discard' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

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
      packageType: (d.packageType ?? 'STANDARD') as 'STANDARD' | 'FRAGILE' | 'DOCUMENT',
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

  if (detail.isLoading || form === null) return <LoadingState label="Loading order…" />;
  if (detail.isError)
    return <ErrorState message={detail.error?.message ?? 'Failed to load order.'} />;
  if (!detail.data) return <ErrorState message="Order not found." />;

  const status = detail.data.status;
  const isDraft = status === 'DRAFT';
  const isPending = status === 'PENDING_CONFIRMATION';
  const canEdit = isDraft || isPending;

  if (!canEdit) {
    return (
      <Card>
        <CardBody>
          <div className="text-text-bright text-sm mb-2">This order is no longer editable.</div>
          <p className="text-text-muted text-xs mb-4">
            Status: <span className="font-mono text-text-bright">{status}</span>. The server allows
            edits only for DRAFT (full) and PENDING_CONFIRMATION (recipient + notes).
          </p>
          <Button variant="secondary" size="md" onClick={() => router.push(`/orders/${orderId}`)}>
            Back to order
          </Button>
        </CardBody>
      </Card>
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
    body.packageType = form.packageType;
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
    if (err instanceof ApiError) {
      const b = err.body as { code?: unknown; message?: unknown } | null;
      const code = typeof b?.code === 'string' ? b.code : null;
      const msg = typeof b?.message === 'string' ? b.message : err.message;
      return code ? `[${code}] ${msg}` : msg;
    }
    return err instanceof Error ? err.message : 'Action failed';
  }

  /** The same gate the create form uses, from the same module — the two
   *  screens edit the same field and must refuse the same values. */
  function phoneProblem(): string | null {
    if (!form) return null;
    return isCompleteLocal(toLocalDigits(form.recipientPhoneE164)) ? null : IN_PHONE_ERROR;
  }

  /** Same shape, same reason: the create form refuses duplicated address
   *  lines, so editing must not be the way round it. Advisory — the API
   *  has no such rule; the consequence downstream is a held order. */
  function addressProblem(): string | null {
    if (!form) return null;
    if (!form.recipientAddressLine2.trim()) return 'Address line 2 (the landmark) is required.';
    return linesAreDuplicated(form.recipientAddressLine1, form.recipientAddressLine2)
      ? DUPLICATE_LINES_ERROR
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
      toast.success('Changes saved.');
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
      toast.success('Saved and submitted for confirmation.');
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
      toast.success('Draft discarded.');
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

    The server still refuses these fields while an agent is actually on
    the call (EDIT_DURING_CALL) and the refusal surfaces verbatim
    (FE-2). Deliberately NOT mirrored here: the UI has no way to know a
    call started thirty seconds ago, and a client-side guess would
    either lock a seller out of an order nobody is calling about or
    promise an edit the server then refuses.
  */

  return (
    <form className="space-y-4" onSubmit={(e) => void onSave(e)}>
      <div className="text-text-muted text-xs">
        Editing order <span className="font-mono text-text-bright">{detail.data.orderNumber}</span>{' '}
        · status <span className="font-mono text-text-bright">{status}</span>
        {isPending && (
          <span className="text-text-muted ml-2">
            — editable until the confirmation call is done
          </span>
        )}
      </div>

      {/* The lines — editable, because a wrong product on an order
          nobody has confirmed yet is a correction, not a reason to
          cancel and start again. */}
      <Card>
        <CardBody>
          <h2 className="text-text-bright mb-2 text-sm font-medium">
            Items
            {linesChanged && (
              <span className="text-pending ml-2 text-xs">changed — save to apply</span>
            )}
          </h2>
          {lines === null ? (
            <LoadingState label="Loading the items…" />
          ) : (
            <div className="space-y-3">
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
        </CardBody>
      </Card>

      {/* Recipient */}
      <Card>
        <CardBody>
          <h2 className="text-text-bright text-sm font-medium mb-3">Recipient</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Full name" required hint={prefixHint(sellerInitials)}>
              {/* Chrome, like the +91 below — the seller cannot edit
                  their own code, so it is not part of the input. */}
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
              label="Second number"
              hint="Tried when the first does not answer — the call centre uses it before giving up on an order."
            >
              <div className="flex items-stretch">
                <span
                  aria-hidden
                  className="border-border-strong text-text-muted inline-flex select-none items-center rounded-l-[6px] border border-r-0 px-2.5 text-sm"
                >
                  {IN_DIAL}
                </span>
                <Input
                  className="rounded-l-none"
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
                  aria-label={`Second phone number, ${IN_DIAL} then ${IN_LOCAL_LENGTH} digits`}
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
                inputMode="numeric"
                required
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
            <FormField label="Delivery fee charged to the customer (INR)">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.deliveryFeeInr}
                onChange={(e) => set('deliveryFeeInr', e.target.value)}
              />
            </FormField>
            <FormField label="Advance already paid (INR)">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.advanceAmountInr}
                onChange={(e) => set('advanceAmountInr', e.target.value)}
              />
            </FormField>
            <FormField label="Discount (INR)">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.discountInr}
                onChange={(e) => set('discountInr', e.target.value)}
              />
            </FormField>
            {form.paymentMode === 'COD' && (
              <FormField
                label="COD amount (INR)"
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
                    ? `Items + delivery − advance − discount = ₹${computedCollectable.toFixed(2)}`
                    : undefined
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={form.codAmountInr}
                    onChange={(e) => set('codAmountInr', e.target.value)}
                    required
                  />
                  {Math.abs(computedCollectable - (Number(form.codAmountInr) || 0)) > 0.005 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => set('codAmountInr', computedCollectable.toFixed(2))}
                    >
                      Use ₹{computedCollectable.toFixed(2)}
                    </Button>
                  )}
                </div>
              </FormField>
            )}
            <FormField label="Declared value (INR)">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.declaredValueInr}
                onChange={(e) => set('declaredValueInr', e.target.value)}
              />
            </FormField>
            <FormField label="Total weight (grams)">
              <Input
                type="number"
                min={0}
                value={form.totalWeightGrams}
                onChange={(e) => set('totalWeightGrams', e.target.value)}
              />
            </FormField>
            <FormField label="Package type">
              <Select
                value={form.packageType}
                onChange={(e) =>
                  set('packageType', e.target.value as 'STANDARD' | 'FRAGILE' | 'DOCUMENT')
                }
              >
                <option value="STANDARD">Standard</option>
                <option value="FRAGILE">Fragile</option>
                <option value="DOCUMENT">Document</option>
              </Select>
            </FormField>
            <FormField label="Your reference">
              <Input
                value={form.sellerOrderRef}
                maxLength={100}
                placeholder="e.g. the number your shop gave it"
                onChange={(e) => set('sellerOrderRef', e.target.value)}
              />
            </FormField>
            {openStores.length > 1 && (
              <FormField
                label="Store"
                hint="Which of your shopfronts this order belongs to. Your reference has to be unique within one shopfront, not across them."
              >
                <Select value={form.storeId} onChange={(e) => set('storeId', e.target.value)}>
                  {openStores.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                      {st.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </Select>
              </FormField>
            )}
            <FormField label="Urgent">
              <label className="text-text-body flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isUrgent}
                  onChange={(e) => set('isUrgent', e.target.checked)}
                />
                Treat this order as urgent
              </label>
            </FormField>
          </div>
        </CardBody>
      </Card>

      {/* Notes — always editable */}
      <Card>
        <CardBody>
          <h2 className="text-text-bright text-sm font-medium mb-3">Notes</h2>
          <FormField label="Seller notes">
            <Textarea
              rows={3}
              maxLength={2000}
              value={form.sellerNotes}
              onChange={(e) => set('sellerNotes', e.target.value)}
              placeholder="Anything the call agent should know"
            />
          </FormField>
        </CardBody>
      </Card>

      {error && (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px]">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-2">
        {isDraft ? (
          confirmDiscard ? (
            <div className="flex items-center gap-2">
              <span className="text-critical text-xs">Discard this draft?</span>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busy !== null}
                onClick={() => void onDiscard()}
              >
                {busy === 'discard' ? 'Discarding…' : 'Yes, discard'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDiscard(false)}
              >
                Keep
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="md"
              disabled={busy !== null}
              onClick={() => setConfirmDiscard(true)}
            >
              Discard draft
            </Button>
          )
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="md"
            disabled={busy !== null}
            onClick={() => router.push(`/orders/${orderId}`)}
          >
            Cancel
          </Button>
          <Button type="submit" variant="secondary" size="md" disabled={busy !== null}>
            {busy === 'save' ? 'Saving…' : 'Save changes'}
          </Button>
          {isDraft && (
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={busy !== null}
              onClick={() => void onSaveAndSubmit()}
            >
              {busy === 'submit' ? 'Submitting…' : 'Save + submit'}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
