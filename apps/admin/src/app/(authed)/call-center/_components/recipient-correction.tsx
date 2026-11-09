'use client';

import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { Pencil, Phone, TriangleAlert } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { TextField } from '@skydrop/ui/app/text-field';
import type { CallOrderSnapshot } from '@skydrop/api-client';
import { useCorrectCallRecipient } from '@/lib/api-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { useT } from '@/i18n/client';
import { Notice } from '../../orders/_components/order-ops-parts';
import './recipient-correction.css';

/**
 * The agent corrects the customer's details WHILE the customer is on the
 * line (2026-11-09).
 *
 * Editable: name, address, landmark line, city, state, PIN. The phone is
 * shown and is not editable (ORD-7 — it is what tells one customer from
 * another, and it is the number being called).
 *
 * FE-2: the checks below are SHAPE only — blank, 6 digits — so the agent
 * sees the problem before submitting. Whether the order may change at all
 * (the courier already holds the parcel, the order is finished), and
 * whether the state is one we serve, is the SERVER's call, and its
 * `[CODE] message` is shown verbatim.
 *
 * The parent is told whether there are UNSAVED edits so it can hold the
 * outcome controls (owner: "after saving them they can select an
 * outcome"). Nothing is optimistic: after a save the parent re-reads the
 * call and the panel shows what the server now holds.
 */
export interface RecipientDraft {
  readonly name: string;
  readonly addressLine1: string;
  readonly addressLine2: string;
  readonly city: string;
  readonly stateProvince: string;
  readonly postalCode: string;
}

export function draftFrom(r: CallOrderSnapshot['recipient']): RecipientDraft {
  return {
    name: r.name,
    addressLine1: r.addressLine1,
    addressLine2: r.addressLine2 ?? '',
    city: r.city,
    stateProvince: r.stateProvince,
    postalCode: r.postalCode,
  };
}

const PIN = /^\d{6}$/;

/**
 * The fields Solustation is asked about. A name-only correction is not
 * an address change, and asking them again about the same words would
 * spend a round trip to be told what we already know.
 */
const ADDRESS_FIELDS = [
  'addressLine1',
  'addressLine2',
  'city',
  'stateProvince',
  'postalCode',
] as const satisfies ReadonlyArray<keyof RecipientDraft>;

export function RecipientCorrection({
  assignmentId,
  recipient,
  onDirtyChange,
  onSaved,
  onAddressSaved,
}: {
  readonly assignmentId: string;
  readonly recipient: CallOrderSnapshot['recipient'];
  readonly onDirtyChange: (dirty: boolean) => void;
  /** Re-reads the held call; resolves once the panel shows the server's version. */
  readonly onSaved: () => Promise<void>;
  /**
   * An ADDRESS field was saved — the address check is now about words
   * the customer has corrected, so it is asked again.
   *
   * Called strictly AFTER the save has succeeded, outside the try, and
   * it must never throw: nothing about the verdict may put the
   * operator's committed edit in doubt.
   */
  readonly onAddressSaved?: (() => void) | undefined;
}): ReactElement | null {
  const tr = useT();
  const allowed = usePermission('callcenter.work');
  const correct = useCorrectCallRecipient();
  const base = draftFrom(recipient);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RecipientDraft>(base);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [announce, setAnnounce] = useState('');
  const triggerRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  const dirty =
    open && (Object.keys(base) as Array<keyof RecipientDraft>).some((k) => draft[k] !== base[k]);

  // Tell the parent, and always clear it when this unmounts (call ended,
  // released) so an abandoned edit can never leave the next call blocked.
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  if (!allowed) return null;

  const set =
    (k: keyof RecipientDraft) =>
    (e: { target: { value: string } }): void => {
      setServerError(null);
      setDraft((d) => ({ ...d, [k]: e.target.value }));
    };

  const problems = {
    name: draft.name.trim() === '' ? tr('callCenterRecipientCorrection.nameRequired') : null,
    addressLine1:
      draft.addressLine1.trim() === '' ? tr('callCenterRecipientCorrection.addressRequired') : null,
    addressLine2:
      draft.addressLine2.trim() === ''
        ? tr('callCenterRecipientCorrection.landmarkRequired')
        : null,
    postalCode: PIN.test(draft.postalCode.trim())
      ? null
      : tr('callCenterRecipientCorrection.pinShape'),
  };
  const shapeOk = Object.values(problems).every((p) => p === null);

  function openForm(): void {
    setDraft(base);
    setServerError(null);
    setSaved(false);
    setOpen(true);
  }

  function discard(): void {
    setOpen(false);
    setServerError(null);
    setDraft(base);
    triggerRef.current?.querySelector('button')?.focus();
  }

  async function save(): Promise<void> {
    setServerError(null);
    const body: Partial<Record<string, string>> = {};
    if (draft.name !== base.name) body.recipientName = draft.name;
    if (draft.addressLine1 !== base.addressLine1) body.recipientAddressLine1 = draft.addressLine1;
    if (draft.addressLine2 !== base.addressLine2) body.recipientAddressLine2 = draft.addressLine2;
    if (draft.city !== base.city) body.recipientCity = draft.city;
    if (draft.stateProvince !== base.stateProvince)
      body.recipientStateProvince = draft.stateProvince;
    if (draft.postalCode !== base.postalCode) body.recipientPostalCode = draft.postalCode;
    const addressChanged = ADDRESS_FIELDS.some((k) => draft[k] !== base[k]);
    let savedOk = false;
    try {
      await correct.mutateAsync({ assignmentId, body });
      await onSaved();
      savedOk = true;
      setSaved(true);
      setAnnounce(tr('callCenterRecipientCorrection.savedAnnounce'));
      setOpen(false);
    } catch (err) {
      // Verbatim `[CODE] message` — the server is the law (FE-2).
      setServerError(serverVerdict(err, tr('callCenterCallCenterStation.operationFailed')));
    }
    // OUTSIDE the try on purpose. The edit is already committed by here,
    // so a re-check must not be able to paint it as a failure — and a
    // failed save must not trigger one about an address nobody stored.
    if (savedOk && addressChanged) onAddressSaved?.();
  }

  return (
    <div className="cc-edit" ref={triggerRef}>
      <span className="cc-edit__live" role="status" aria-live="polite">
        {announce}
      </span>
      {!open ? (
        <div className="cc-edit__bar">
          <Button variant="secondary" size="sm" icon={<Pencil size={14} />} onClick={openForm}>
            {tr('callCenterRecipientCorrection.edit')}
          </Button>
          {saved ? (
            <span className="cc-edit__saved">{tr('callCenterRecipientCorrection.saved')}</span>
          ) : null}
        </div>
      ) : (
        <form
          className="cc-edit__form"
          aria-labelledby={headingId}
          onSubmit={(e) => {
            e.preventDefault();
            if (shapeOk && dirty && !correct.isPending) void save();
          }}
        >
          <p id={headingId} className="cc-edit__title">
            {tr('callCenterRecipientCorrection.title')}
          </p>
          <TextField
            label={tr('callCenterCallCenterStation.name')}
            requiredMark
            value={draft.name}
            onChange={set('name')}
            error={problems.name ?? undefined}
            autoComplete="off"
          />
          <TextField
            label={tr('callCenterCallCenterStation.address')}
            requiredMark
            value={draft.addressLine1}
            onChange={set('addressLine1')}
            error={problems.addressLine1 ?? undefined}
            autoComplete="off"
          />
          <TextField
            label={tr('callCenterRecipientCorrection.landmark')}
            requiredMark
            hint={tr('callCenterRecipientCorrection.landmarkWhy')}
            value={draft.addressLine2}
            onChange={set('addressLine2')}
            error={problems.addressLine2 ?? undefined}
            autoComplete="off"
          />
          <div className="cc-edit__row">
            <TextField
              label={tr('callCenterRecipientCorrection.city')}
              value={draft.city}
              onChange={set('city')}
              autoComplete="off"
            />
            <TextField
              label={tr('callCenterRecipientCorrection.state')}
              value={draft.stateProvince}
              onChange={set('stateProvince')}
              autoComplete="off"
            />
            <TextField
              label={tr('callCenterRecipientCorrection.pin')}
              requiredMark
              inputMode="numeric"
              maxLength={6}
              value={draft.postalCode}
              onChange={set('postalCode')}
              error={
                draft.postalCode !== base.postalCode || draft.postalCode === ''
                  ? (problems.postalCode ?? undefined)
                  : undefined
              }
              autoComplete="off"
            />
          </div>
          <p className="cc-edit__phone">
            <Phone size={14} aria-hidden />
            <span className="sk-ident">{recipient.phoneE164}</span>
            <span>{tr('callCenterRecipientCorrection.phoneWhy')}</span>
          </p>
          {serverError !== null ? (
            <Notice tone="bad" role="alert" icon={<TriangleAlert size={16} />}>
              <p className="oo-error">{serverError}</p>
            </Notice>
          ) : null}
          <div className="cc-edit__actions">
            <Button
              variant="ghost"
              size="md"
              type="button"
              onClick={discard}
              disabled={correct.isPending}
            >
              {tr('callCenterRecipientCorrection.discard')}
            </Button>
            <AsyncButton
              variant="primary"
              size="md"
              type="submit"
              state={correct.isPending ? 'busy' : 'idle'}
              labels={{
                idle: tr('callCenterRecipientCorrection.save'),
                busy: tr('callCenterRecipientCorrection.saving'),
              }}
              disabled={!dirty || !shapeOk || correct.isPending}
            />
          </div>
        </form>
      )}
    </div>
  );
}
