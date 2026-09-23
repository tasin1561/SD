'use client';

import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { AlertTriangle, ChevronRight, ShieldAlert } from 'lucide-react';
import { OrderCancellationReason, OrderStatus, PackageType, PaymentMode } from '@skydrop/db';
import {
  type ForceMutationFields,
  type ForceMutationRequest,
  type ForceMutationResult,
  type OrderView,
} from '@skydrop/api-client';
import { useForceMutation } from '@/lib/api-hooks';
import { Button } from '@skydrop/ui/app/button';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import './order-core.css';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * The god-mode override surface (CP2.10).
 *
 * ──── The 8 server guardrails the UI MUST reflect (FE-2 — surface,
 * not enforce) ─────────────────────────────────────────────────────
 *   1. reason ≥ 30 chars                  → live counter + disable submit
 *   2. acknowledgeDataIntegrityRisk: true → checkbox; literal-true is the API contract
 *   3. ≥1 of fieldChanges / targetStatus  → submit disabled if both empty
 *   4. order exists                       → server 404 surfaced as-is
 *   5. DB + event + audit in 1 tx         → server-internal; UI shows the response
 *   6. reserve attempted-not-blocking     → reserveOutcomes surfaced post-success
 *   7. 22-field whitelist                 → only the whitelist fields are editable here
 *   8. hasAdminOverride set-once-never-cleared → badge appears in the order header
 *      from this moment forward — permanent record of override usage
 *
 * The UI's job is to make the GRAVITY visible (escalating chrome:
 * Override panel → 30-char reason → risk-ack checkbox → typed
 * confirmation) — but the SERVER enforces every gate. We surface the
 * server's verdict verbatim if it rejects; we do not pre-empt the
 * server's policy with a client-side mirror.
 */

const MIN_REASON_LEN = 30;
const TYPED_CONFIRM = 'FORCE-MUTATE';

const ORDER_STATUSES = Object.values(OrderStatus);
const PAYMENT_MODES = Object.values(PaymentMode);
const PACKAGE_TYPES = Object.values(PackageType);
const CANCELLATION_REASONS = Object.values(OrderCancellationReason);

/** Optional field row — only enabled fields are sent in fieldChanges. */
type FieldKey = keyof ForceMutationFields;

const FIELD_GROUPS: ReadonlyArray<{
  readonly title: string;
  readonly fields: ReadonlyArray<{
    readonly key: FieldKey;
    readonly label: string;
    readonly kind: 'text' | 'long-text' | 'number' | 'bool' | 'select';
    readonly options?: ReadonlyArray<string>;
  }>;
}> = [
  {
    title: 'Recipient',
    fields: [
      { key: 'recipientName', label: 'Name', kind: 'text' },
      { key: 'recipientPhoneE164', label: 'Phone (E.164)', kind: 'text' },
      { key: 'recipientAltPhoneE164', label: 'Alt phone (E.164)', kind: 'text' },
      { key: 'recipientEmail', label: 'Email', kind: 'text' },
      { key: 'recipientAddressLine1', label: 'Address line 1', kind: 'text' },
      { key: 'recipientAddressLine2', label: 'Address line 2', kind: 'text' },
      { key: 'recipientLandmark', label: 'Landmark', kind: 'text' },
      { key: 'recipientCity', label: 'City', kind: 'text' },
      { key: 'recipientStateProvince', label: 'State / province', kind: 'text' },
      { key: 'recipientPostalCode', label: 'Postal code', kind: 'text' },
      { key: 'recipientCountryCode', label: 'Country (ISO)', kind: 'text' },
    ],
  },
  {
    title: 'Payment + value',
    fields: [
      { key: 'paymentMode', label: 'Payment mode', kind: 'select', options: PAYMENT_MODES },
      { key: 'codAmountInr', label: 'COD amount (INR)', kind: 'number' },
      { key: 'declaredValueInr', label: 'Declared value (INR)', kind: 'number' },
    ],
  },
  {
    title: 'Physical',
    fields: [
      { key: 'totalWeightGrams', label: 'Total weight (g)', kind: 'number' },
      { key: 'packageType', label: 'Package type', kind: 'select', options: PACKAGE_TYPES },
      { key: 'isUrgent', label: 'Urgent', kind: 'bool' },
      { key: 'isHighRisk', label: 'High risk', kind: 'bool' },
    ],
  },
  {
    title: 'Notes + cancellation',
    fields: [
      { key: 'sellerNotes', label: 'Seller notes', kind: 'long-text' },
      { key: 'internalNotes', label: 'Internal notes', kind: 'long-text' },
      { key: 'callNotes', label: 'Call notes', kind: 'long-text' },
      {
        key: 'cancellationReason',
        label: 'Cancellation reason',
        kind: 'select',
        options: CANCELLATION_REASONS,
      },
    ],
  },
];

interface FieldState {
  enabled: boolean;
  value: string | number | boolean;
}

export function ForceMutationDialog({
  open,
  onOpenChange,
  order,
  onSuccess,
}: {
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
  readonly order: OrderView;
  readonly onSuccess: (result: ForceMutationResult) => void;
}): ReactElement {
  const [fieldStates, setFieldStates] = useState<Record<FieldKey, FieldState>>(() =>
    initFieldStates(),
  );
  const [changeStatus, setChangeStatus] = useState(false);
  const [targetStatus, setTargetStatus] = useState<OrderStatus>(order.status);
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [stage, setStage] = useState<'edit' | 'typed-confirm'>('edit');
  const [typed, setTyped] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const mutate = useForceMutation(order.id);

  // Reset when dialog opens against a new order or after a prior close.
  useEffect(() => {
    if (open) {
      setFieldStates(initFieldStates());
      setChangeStatus(false);
      setTargetStatus(order.status);
      setReason('');
      setAck(false);
      setStage('edit');
      setTyped('');
      setServerError(null);
    }
  }, [open, order]);

  // Build the request body — only ENABLED fields contribute.
  const fieldChanges = useMemo<ForceMutationFields>(() => {
    const out: Record<string, unknown> = {};
    for (const group of FIELD_GROUPS) {
      for (const f of group.fields) {
        const s = fieldStates[f.key];
        if (!s?.enabled) continue;
        if (f.kind === 'number') {
          const n = Number(s.value);
          if (!Number.isFinite(n)) continue;
          out[f.key] = n;
        } else if (f.kind === 'bool') {
          out[f.key] = Boolean(s.value);
        } else {
          out[f.key] = String(s.value);
        }
      }
    }
    return out as ForceMutationFields;
  }, [fieldStates]);

  const fieldChangeCount = Object.keys(fieldChanges).length;
  const statusChange = changeStatus && targetStatus !== order.status;
  const reasonLen = reason.trim().length;
  const reasonOk = reasonLen >= MIN_REASON_LEN;
  const hasAtLeastOneMutation = fieldChangeCount > 0 || changeStatus;
  const canSubmit = reasonOk && ack && hasAtLeastOneMutation && !mutate.isPending;

  function toggleField(key: FieldKey, currentValueFromOrder: unknown): void {
    setFieldStates((prev) => {
      const wasEnabled = prev[key]?.enabled ?? false;
      return {
        ...prev,
        [key]: {
          enabled: !wasEnabled,
          value: wasEnabled
            ? (prev[key]?.value ?? '')
            : ((currentValueFromOrder as string | number | boolean | null | undefined) ?? ''),
        },
      };
    });
  }

  function setFieldValue(key: FieldKey, value: string | number | boolean): void {
    setFieldStates((prev) => ({
      ...prev,
      [key]: { enabled: prev[key]?.enabled ?? true, value },
    }));
  }

  async function submitToServer(): Promise<void> {
    setServerError(null);
    const body: ForceMutationRequest = {
      reason: reason.trim(),
      acknowledgeDataIntegrityRisk: true,
      ...(fieldChangeCount > 0 ? { fieldChanges } : {}),
      ...(statusChange ? { targetStatus } : {}),
    };
    try {
      const result = await mutate.mutateAsync(body);
      onSuccess(result);
      onOpenChange(false);
    } catch (err) {
      // Server-verdict verbatim — including
      //   FORCE_MUTATION_REASON_TOO_SHORT (we already gate but the
      //     server is the ground truth)
      //   FORCE_MUTATION_RISK_NOT_ACKNOWLEDGED
      //   FORCE_MUTATION_NOOP
      // The UI does NOT reimplement these as client-side errors.
      setServerError(serverVerdict(err, 'Force mutation failed.'));
      setStage('edit');
    }
  }

  const editFooter = (
    <DialogFooter>
      <Button
        variant="ghost"
        size="md"
        onClick={() => onOpenChange(false)}
        disabled={mutate.isPending}
      >
        Cancel
      </Button>
      <Button
        variant="destructive"
        size="md"
        onClick={() => setStage('typed-confirm')}
        disabled={!canSubmit}
        title={
          !reasonOk
            ? `Reason must be at least ${MIN_REASON_LEN} characters`
            : !ack
              ? 'You must acknowledge the data-integrity risk'
              : !hasAtLeastOneMutation
                ? 'Either change a field or change the status (or both)'
                : undefined
        }
      >
        Continue → confirmation
      </Button>
    </DialogFooter>
  );

  const typedOk = typed === TYPED_CONFIRM;
  const confirmFooter = (
    <DialogFooter>
      <Button
        variant="ghost"
        size="md"
        onClick={() => {
          setTyped('');
          setStage('edit');
        }}
        disabled={mutate.isPending}
      >
        ← Back
      </Button>
      <Button
        variant="destructive"
        size="md"
        icon={<ShieldAlert size={14} />}
        loading={mutate.isPending}
        onClick={() => {
          if (typed === TYPED_CONFIRM) {
            void submitToServer();
          }
        }}
        disabled={!typedOk || mutate.isPending}
      >
        Force-mutate this order
      </Button>
    </DialogFooter>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !mutate.isPending) onOpenChange(false);
      }}
      locked={mutate.isPending}
      tone="critical"
      size="lg"
      icon={<ShieldAlert size={18} />}
      title="God-mode override"
      description="ORD-2. Bypasses the state machine and the standard edit rules. Audited CRITICAL. Marks the order with hasAdminOverride permanently."
      footer={stage === 'edit' ? editFooter : confirmFooter}
    >
      {stage === 'edit' ? (
        <div className="oo-god">
          <CriticalNotice />

          {FIELD_GROUPS.map((group) => (
            <FieldGroupBlock
              key={group.title}
              title={group.title}
              fields={group.fields}
              fieldStates={fieldStates}
              order={order}
              onToggle={toggleField}
              onChange={setFieldValue}
              disabled={mutate.isPending}
            />
          ))}

          <div className="oc-critical-box">
            <Checkbox
              checked={changeStatus}
              onChange={(e) => setChangeStatus(e.target.checked)}
              disabled={mutate.isPending}
              label="Force order status"
              description={
                <>
                  Bypasses the state-machine matrix. Currently:{' '}
                  <span className="sk-ident">{order.status}</span>
                </>
              }
            />
            {changeStatus && (
              <Select
                label="Target status"
                value={targetStatus}
                onChange={(e) => setTargetStatus(e.target.value as OrderStatus)}
                disabled={mutate.isPending}
              >
                {ORDER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <TextArea
            id="god-reason"
            label="Justification"
            requiredMark
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Explain why the state machine + edit rules must be bypassed. Be specific — this is the only audit-time record of intent."
            disabled={mutate.isPending}
            hint="Recorded in the audit log + order event. Visible forever."
            after={
              <span className="oc-counter sk-figure" data-ok={reasonOk ? '1' : undefined}>
                {reasonLen} / {MIN_REASON_LEN} min
              </span>
            }
          />

          <div className="oc-critical-box">
            <Checkbox
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              disabled={mutate.isPending}
              label={
                <>
                  I acknowledge the data-integrity risk: this bypass opts OUT of the saga&apos;s
                  compensation guarantee. Stock side-effects on{' '}
                  <span className="sk-ident">→ CONFIRMED</span> are attempted but not enforced;
                  transitioning away from <span className="sk-ident">CONFIRMED</span> leaves
                  reservations intact (cleanup is the separate{' '}
                  <span className="sk-ident">release-reservations</span> action). The order will
                  carry <span className="sk-ident">hasAdminOverride: true</span> permanently.
                </>
              }
            />
          </div>

          {serverError && (
            <p className="oc-verdict" role="alert">
              {serverError}
            </p>
          )}
        </div>
      ) : (
        <TypedConfirmStep
          fieldChangeCount={fieldChangeCount}
          changedFields={Object.keys(fieldChanges)}
          statusChange={statusChange ? { from: order.status, to: targetStatus } : null}
          typed={typed}
          onTypedChange={setTyped}
          serverError={serverError}
          pending={mutate.isPending}
        />
      )}
    </Dialog>
  );
}

function CriticalNotice(): ReactElement {
  return (
    <div className="oo-god__banner" role="note">
      <AlertTriangle size={16} aria-hidden />
      <p className="oo-p oo-bad">
        <strong>This is a deliberate bypass.</strong> The order&apos;s state machine, edit rules,
        and saga compensation are all opted out of. Use it only when normal flows can&apos;t reach
        the required state — and document why. A forced status has the same consequences as any
        other change except stock: customer and seller emails, seller webhooks, invoices and
        delivery-time billing fire for the status it lands on; it joins or leaves the call queue; a
        forced CONFIRMED gets a shipment (so it can be picked and booked); and a cancel voids an
        unpicked shipment and returns the delivery fee if the parcel never left with a courier. A
        waybill already issued is NOT cancelled with the courier.
      </p>
    </div>
  );
}

function FieldGroupBlock({
  title,
  fields,
  fieldStates,
  order,
  onToggle,
  onChange,
  disabled,
}: {
  readonly title: string;
  readonly fields: ReadonlyArray<{
    readonly key: FieldKey;
    readonly label: string;
    readonly kind: 'text' | 'long-text' | 'number' | 'bool' | 'select';
    readonly options?: ReadonlyArray<string>;
  }>;
  readonly fieldStates: Record<FieldKey, FieldState>;
  readonly order: OrderView;
  readonly onToggle: (key: FieldKey, currentValueFromOrder: unknown) => void;
  readonly onChange: (key: FieldKey, value: string | number | boolean) => void;
  readonly disabled: boolean;
}): ReactElement {
  const enabledCount = fields.filter((f) => fieldStates[f.key]?.enabled).length;
  return (
    <div className="oc-wl">
      <div className="oc-wl__head">
        <p className="oc-wl__title">{title}</p>
        {enabledCount > 0 && <span className="oc-wl__count">{enabledCount} change(s)</span>}
      </div>
      {fields.map((f) => {
        const state = fieldStates[f.key];
        const enabled = state?.enabled ?? false;
        const currentValue = (order as unknown as Record<string, unknown>)[f.key];
        return (
          <div key={f.key} className="oc-wl__row" data-on={enabled ? '1' : undefined}>
            <Checkbox
              checked={enabled}
              onChange={() => onToggle(f.key, currentValue)}
              disabled={disabled}
              label={f.label}
              description={
                currentValue !== null && currentValue !== undefined ? (
                  <span className="oc-wl__was sk-ident">was: {String(currentValue)}</span>
                ) : undefined
              }
            />
            {enabled && (
              <FieldInput
                kind={f.kind}
                label={f.label}
                {...(f.options !== undefined ? { options: f.options } : {})}
                value={state?.value ?? ''}
                disabled={disabled}
                onChange={(v) => onChange(f.key, v)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function FieldInput({
  kind,
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  readonly kind: 'text' | 'long-text' | 'number' | 'bool' | 'select';
  /** The field's name, so the new-value control is announced as such. */
  readonly label: string;
  readonly options?: ReadonlyArray<string>;
  readonly value: string | number | boolean;
  readonly disabled: boolean;
  readonly onChange: (v: string | number | boolean) => void;
}): ReactElement {
  const name = `New ${label.toLowerCase()}`;
  if (kind === 'bool') {
    return (
      <Select
        aria-label={name}
        value={value ? 'true' : 'false'}
        onChange={(e) => onChange(e.target.value === 'true')}
        disabled={disabled}
      >
        <option value="false">false</option>
        <option value="true">true</option>
      </Select>
    );
  }
  if (kind === 'select') {
    return (
      <Select
        aria-label={name}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {(options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    );
  }
  if (kind === 'long-text') {
    return (
      <TextArea
        aria-label={name}
        rows={2}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    );
  }
  return (
    <TextField
      aria-label={name}
      type={kind === 'number' ? 'number' : 'text'}
      value={String(value)}
      onChange={(e) => onChange(kind === 'number' ? Number(e.target.value) : e.target.value)}
      disabled={disabled}
    />
  );
}

function TypedConfirmStep({
  fieldChangeCount,
  changedFields,
  statusChange,
  typed,
  onTypedChange,
  serverError,
  pending,
}: {
  readonly fieldChangeCount: number;
  readonly changedFields: ReadonlyArray<string>;
  readonly statusChange: { readonly from: OrderStatus; readonly to: OrderStatus } | null;
  readonly typed: string;
  readonly onTypedChange: (v: string) => void;
  readonly serverError: string | null;
  readonly pending: boolean;
}): ReactElement {
  return (
    <div className="oo-god">
      <CriticalNotice />

      <Summary
        title="You are about to:"
        rows={[
          fieldChangeCount > 0
            ? `Modify ${fieldChangeCount} field(s): ${changedFields.join(', ')}`
            : null,
          statusChange ? `Force status: ${statusChange.from} → ${statusChange.to}` : null,
        ].filter((r): r is string => r !== null)}
      />

      <div className="oc-critical-box">
        <p className="oo-p">
          Type <span className="oc-typed-word">{TYPED_CONFIRM}</span> to confirm
        </p>
        <TextField
          className="oo-god__typed"
          aria-label={`Type ${TYPED_CONFIRM} to confirm`}
          value={typed}
          onChange={(e) => onTypedChange(e.target.value)}
          placeholder={TYPED_CONFIRM}
          disabled={pending}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      {serverError && (
        <p className="oc-verdict" role="alert">
          {serverError}
        </p>
      )}
    </div>
  );
}

function Summary({
  title,
  rows,
}: {
  readonly title: ReactNode;
  readonly rows: ReadonlyArray<string>;
}): ReactElement {
  return (
    <div className="oc-result">
      <p className="oc-result__title">{title}</p>
      <ul className="oc-summary">
        {rows.map((r, i) => (
          <li key={i}>
            <ChevronRight size={14} aria-hidden />
            <span className="sk-ident">{r}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function initFieldStates(): Record<FieldKey, FieldState> {
  const out = {} as Record<FieldKey, FieldState>;
  for (const group of FIELD_GROUPS) {
    for (const f of group.fields) {
      out[f.key] = { enabled: false, value: '' };
    }
  }
  return out;
}
