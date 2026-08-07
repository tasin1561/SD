'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
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
import { ApiError } from '@skydrop/api-client';
import {
  useDiscardDraftOrder,
  useOrderDetail,
  useSubmitOrder,
  useUpdateOrder,
  type UpdateOrderInput,
} from '@/lib/api-hooks';

/**
 * Edit form for a DRAFT or PENDING_CONFIRMATION order.
 *
 * Locked decisions:
 *   - Recipient + payment + physical + notes are editable. The line
 *     ITSELF is read-only — the seller cannot swap items here; for a
 *     wrong line they discard the draft and recreate. (Avoids
 *     needing a productId lookup that OrderItemView doesn't carry,
 *     and prevents the seller from accidentally rewriting an item
 *     that the call agent has already discussed with the customer.)
 *   - PENDING_CONFIRMATION orders accept only recipient + notes
 *     edits; physical/economics fields are visually disabled even
 *     though the form gathers them — the server rejects in any case
 *     and we surface FE-2 verbatim.
 *   - "Discard draft" is a destructive secondary action with an
 *     inline typed-confirm.
 *   - "Save changes" PATCHes. "Save + submit" PATCHes then submits
 *     to the call queue (DRAFT only).
 *   - FE-2: server rejection surfaces `[code] message` VERBATIM.
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
  sellerNotes: string;
}

export function EditOrderForm({ orderId }: { readonly orderId: string }): ReactElement {
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
      recipientName: d.recipientName,
      recipientPhoneE164: d.recipientPhoneE164,
      recipientAddressLine1: d.recipientAddressLine1,
      recipientAddressLine2: d.recipientAddressLine2 ?? '',
      recipientLandmark: d.recipientLandmark ?? '',
      recipientCity: d.recipientCity,
      recipientStateProvince: d.recipientStateProvince,
      recipientPostalCode: d.recipientPostalCode,
      paymentMode: d.paymentMode as 'COD' | 'PREPAID',
      codAmountInr: d.codAmountInr?.toString() ?? '',
      declaredValueInr: d.declaredValueInr?.toString() ?? '',
      totalWeightGrams: d.totalWeightGrams?.toString() ?? '',
      sellerNotes: d.sellerNotes ?? '',
    });
  }, [detail.data, form]);

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
      recipientCity: form.recipientCity.trim(),
      recipientStateProvince: form.recipientStateProvince.trim(),
      recipientPostalCode: form.recipientPostalCode.trim(),
      paymentMode: form.paymentMode,
    };
    if (form.recipientAddressLine2.trim())
      body.recipientAddressLine2 = form.recipientAddressLine2.trim();
    if (form.recipientLandmark.trim()) body.recipientLandmark = form.recipientLandmark.trim();
    if (form.paymentMode === 'COD' && form.codAmountInr.trim())
      body.codAmountInr = Number(form.codAmountInr);
    if (form.declaredValueInr.trim()) body.declaredValueInr = Number(form.declaredValueInr);
    if (form.totalWeightGrams.trim()) body.totalWeightGrams = Number(form.totalWeightGrams);
    if (form.sellerNotes !== (detail.data.sellerNotes ?? '')) {
      body.sellerNotes = form.sellerNotes;
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

  async function onSave(e: FormEvent): Promise<void> {
    e.preventDefault();
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

  const economicsLocked = !isDraft;
  const firstItem = detail.data.items[0];

  return (
    <form className="space-y-4" onSubmit={(e) => void onSave(e)}>
      <div className="text-text-muted text-xs">
        Editing order <span className="font-mono text-text-bright">{detail.data.orderNumber}</span>{' '}
        · status <span className="font-mono text-text-bright">{status}</span>
        {economicsLocked && (
          <span className="ml-2 text-pending">
            (recipient + notes only — economics locked once submitted to call queue)
          </span>
        )}
      </div>

      {/* Read-only line (any swap requires discard + recreate) */}
      {firstItem && (
        <Card>
          <CardBody>
            <h2 className="text-text-bright text-sm font-medium mb-2">
              Item{' '}
              <span className="text-text-muted text-xs ml-2">
                (read-only — discard &amp; recreate to swap)
              </span>
            </h2>
            <div className="text-text-body text-sm">
              {firstItem.productName}
              {firstItem.variantLabel && (
                <span className="text-text-muted"> · {firstItem.variantLabel}</span>
              )}
            </div>
            <div className="text-text-faint text-xs mt-0.5 font-mono">
              {firstItem.skuCode} · qty {firstItem.quantity}
              {firstItem.unitPriceInr ? ` · ₹${firstItem.unitPriceInr}/unit` : ''}
            </div>
          </CardBody>
        </Card>
      )}

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
          <h2 className="text-text-bright text-sm font-medium mb-3">
            Payment &amp; physical
            {economicsLocked && <span className="text-text-muted text-xs ml-2">(read-only)</span>}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Payment mode" required>
              <Select
                value={form.paymentMode}
                onChange={(e) => set('paymentMode', e.target.value as 'COD' | 'PREPAID')}
                disabled={economicsLocked}
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
                  disabled={economicsLocked}
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
                disabled={economicsLocked}
              />
            </FormField>
            <FormField label="Total weight (grams)">
              <Input
                type="number"
                min={0}
                value={form.totalWeightGrams}
                onChange={(e) => set('totalWeightGrams', e.target.value)}
                disabled={economicsLocked}
              />
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
