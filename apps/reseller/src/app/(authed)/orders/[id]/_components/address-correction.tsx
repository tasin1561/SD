'use client';

import { useState, type ReactElement } from 'react';
import { Clock, MapPinned, OctagonX, PencilLine, TriangleAlert, Zap } from 'lucide-react';
// The layout mounts the legacy <Toaster>; the app `useToast` would throw
// outside its own provider, so this keeps the legacy hook (same API).
import { useToast } from '@skydrop/ui/components';
import { storeAddressChangeStatusKind, storeAddressChangeStatusLabel } from '@skydrop/ui/status';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import type { MessageKey } from '@/i18n/catalog';
import { useLocale, useT } from '@/i18n/client';
import { formatDateTime } from '@/i18n/format';
import { verdict } from '@/i18n/verdict';
import {
  useEditStoreRecipient,
  useStoreAddressChanges,
  type AddressChangeFields,
  type AddressField,
  type StoreOrderView,
} from '@/lib/order-hooks';
import { Notice, RoSection } from '../../_components/orders-parts';

/**
 * What a person calls each delivery detail.
 *
 * All ten, not just the ones the form below offers: a correction made
 * through the API or a CSV may carry one the form does not, and the
 * history has to be able to name it.
 */
const FIELD_LABEL: Readonly<Record<AddressField, MessageKey>> = {
  recipientName: 'addrfix.field.recipientName',
  recipientPhoneE164: 'addrfix.field.recipientPhoneE164',
  recipientAltPhoneE164: 'addrfix.field.recipientAltPhoneE164',
  recipientEmail: 'addrfix.field.recipientEmail',
  recipientAddressLine1: 'addrfix.field.recipientAddressLine1',
  recipientAddressLine2: 'addrfix.field.recipientAddressLine2',
  recipientLandmark: 'addrfix.field.recipientLandmark',
  recipientCity: 'addrfix.field.recipientCity',
  recipientStateProvince: 'addrfix.field.recipientStateProvince',
  recipientPostalCode: 'addrfix.field.recipientPostalCode',
};

/** The same ten in reading order, for listing what a correction proposed. */
const ALL_FIELDS: readonly AddressField[] = [
  'recipientName',
  'recipientPhoneE164',
  'recipientAltPhoneE164',
  'recipientEmail',
  'recipientAddressLine1',
  'recipientAddressLine2',
  'recipientLandmark',
  'recipientCity',
  'recipientStateProvince',
  'recipientPostalCode',
];

/**
 * The nine the form offers, in the order somebody reads an address.
 *
 * `recipientLandmark` is deliberately NOT one of them: nothing sends it
 * to the courier — a landmark reaches a driver on the second address
 * line — so asking for it here would collect something that changes
 * nothing on the parcel.
 */
const FORM_FIELDS: ReadonlyArray<{
  readonly key: AddressField;
  readonly hint?: MessageKey;
  readonly current: (r: StoreOrderView['recipient']) => string;
}> = [
  { key: 'recipientName', current: (r) => r.name },
  {
    key: 'recipientPhoneE164',
    hint: 'addrfix.hint.phone',
    current: (r) => r.phoneE164,
  },
  { key: 'recipientAltPhoneE164', current: (r) => r.altPhoneE164 ?? '' },
  { key: 'recipientEmail', current: (r) => r.email ?? '' },
  { key: 'recipientAddressLine1', current: (r) => r.addressLine1 },
  {
    key: 'recipientAddressLine2',
    hint: 'addrfix.hint.line2',
    current: (r) => r.addressLine2 ?? '',
  },
  { key: 'recipientCity', current: (r) => r.city },
  { key: 'recipientStateProvince', current: (r) => r.stateProvince },
  { key: 'recipientPostalCode', current: (r) => r.postalCode },
];

/**
 * Only what actually changed.
 *
 * A box left BLANK is left alone rather than cleared — somebody emptying
 * a field they did not mean to touch should not wipe a phone number off
 * a live parcel, and there is nothing the courier needs that is better
 * absent than wrong.
 */
function proposedChanges(
  draft: Partial<Record<AddressField, string>>,
  recipient: StoreOrderView['recipient'],
): AddressChangeFields {
  const out: AddressChangeFields = {};
  for (const f of FORM_FIELDS) {
    const next = (draft[f.key] ?? '').trim();
    if (next !== '' && next !== f.current(recipient).trim()) out[f.key] = next;
  }
  return out;
}

/**
 * Correcting where this parcel is going.
 *
 * WHICH of the three things happens is the seller's `orderChange` policy
 * for this store, read from the server with the history (`mode`): OFF is
 * not offered at all — an offered button that always refuses teaches
 * people to ignore refusals, the same reasoning as `OrderActions`;
 * DIRECT is written onto the order as you send it; ASK_SELLER is held
 * until seller staff answer, and the parcel keeps the OLD address in the
 * meantime.
 *
 * The one case where OFF still renders is a store that HAS corrected
 * this order before. Switching the capability off afterwards should not
 * erase what was already asked and answered — nothing is being offered
 * there, only remembered.
 *
 * Sending is two steps: the form, then a confirm that restates the order,
 * each change and what happens next — both before the SAME request. A
 * refusal lands back in the form, as before.
 */
export function AddressCorrection({
  orderId,
  orderNumber,
  recipient,
  stageOpen,
}: {
  orderId: string;
  /** Shown in the confirm; display only. */
  orderNumber: string;
  recipient: StoreOrderView['recipient'];
  /** Before the call confirms the order — the only time the details can change. */
  stageOpen: boolean;
}): ReactElement {
  const t = useT();
  const locale = useLocale();
  const changes = useStoreAddressChanges(orderId);
  const submit = useEditStoreRecipient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Record<AddressField, string>>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const mode = changes.data?.mode ?? 'OFF';
  const waits = mode === 'ASK_SELLER';
  const proposed = proposedChanges(draft, recipient);
  const changedCount = Object.keys(proposed).length;

  function start(): void {
    // Pre-filled with what the parcel says NOW, so the person edits the
    // address in front of them instead of retyping one from memory.
    const seeded: Partial<Record<AddressField, string>> = {};
    for (const f of FORM_FIELDS) seeded[f.key] = f.current(recipient);
    setDraft(seeded);
    setReason('');
    setError(null);
    setOpen(true);
  }

  async function send(): Promise<void> {
    setError(null);
    try {
      const out = await submit.mutateAsync({
        orderId,
        fields: proposed,
        ...(waits ? { reason: reason.trim() } : {}),
      });
      // The REPLY says which of the two happened — never the mode read
      // when the page loaded, because seller staff may have changed the
      // policy since.
      toast.success(out.applied ? t('addrfix.toast.applied') : t('addrfix.toast.sent'));
      setOpen(false);
    } catch (err) {
      // Verbatim (FE-2): ADDRESS_CHANGE_REASON_REQUIRED,
      // ADDRESS_CHANGE_ALREADY_OPEN, STORE_ACTION_NOT_ALLOWED,
      // NOT_EDITABLE, COURIER_MUST_ACCEPT_ADDRESS_CHANGE, RETAIL_OUT_OF_RANGE…
      setError(verdict(err, t));
    }
  }

  if (changes.isPending) {
    return <SkeletonRows rows={2} cols={3} label={t('addrfix.loading')} />;
  }
  if (changes.isError) {
    return <ErrorState message={verdict(changes.error, t)} retry={() => void changes.refetch()} />;
  }

  const history = changes.data.items;
  // Open means PENDING or APPROVED (still being applied) — the server
  // refuses a second correction while either exists.
  const pending = history.find((r) => r.status === 'PENDING' || r.status === 'APPROVED') ?? null;
  if (mode === 'OFF' && history.length === 0) return <></>;

  const sendLabel = waits ? t('addrfix.send.waits') : t('addrfix.send.direct');
  const consequence = waits ? t('addrfix.consequence.waits') : t('addrfix.consequence.direct');

  return (
    <RoSection
      title={t('addrfix.title')}
      note={
        mode === 'OFF'
          ? t('addrfix.note.off')
          : !stageOpen
            ? t('addrfix.note.closed')
            : waits
              ? t('addrfix.note.waits')
              : t('addrfix.note.direct')
      }
    >
      <div className="ro-stack">
        {mode === 'OFF' ? (
          <p className="ro-p">{t('addrfix.body.off')}</p>
        ) : !stageOpen ? (
          <p className="ro-p">{t('addrfix.body.closed')}</p>
        ) : (
          <div className="ro-offer">
            <Button
              variant="secondary"
              icon={<PencilLine size={15} />}
              disabled={pending !== null}
              onClick={start}
            >
              {t('addrfix.change')}
            </Button>
            <span className="ro-offer__note">
              {pending !== null || waits ? (
                <Clock size={13} aria-hidden />
              ) : (
                <Zap size={13} aria-hidden />
              )}
              {pending !== null
                ? t('addrfix.hint.open')
                : waits
                  ? t('addrfix.hint.approves')
                  : t('addrfix.hint.now')}
            </span>
          </div>
        )}

        {history.length > 0 ? (
          <Table caption={t('addrfix.history.caption')}>
            <THead>
              <Tr>
                <Th>{t('addrfix.col.asked')}</Th>
                <Th>{t('addrfix.col.why')}</Th>
                <Th>{t('addrfix.col.when')}</Th>
                <Th>{t('addrfix.col.state')}</Th>
              </Tr>
            </THead>
            <TBody>
              {history.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <ul className="ro-changes">
                      {ALL_FIELDS.filter((k) => r.fields[k] !== undefined).map((k) => (
                        <li key={k}>
                          <span className="ro-faint">{t(FIELD_LABEL[k])}: </span>
                          <span>{r.fields[k] ?? ''}</span>
                        </li>
                      ))}
                    </ul>
                  </Td>
                  <Td>
                    <span className="ro-faint">{r.reason}</span>
                  </Td>
                  <Td>
                    <span className="ro-muted sk-figure">
                      {formatDateTime(r.createdAt, locale)}
                    </span>
                  </Td>
                  <Td>
                    <StatusChip
                      kind={storeAddressChangeStatusKind(r.status)}
                      label={storeAddressChangeStatusLabel(r.status)}
                      size="sm"
                    />
                    {r.decisionNote !== null ? (
                      <p className="ro-quote">{t('addrfix.theySaid', { note: r.decisionNote })}</p>
                    ) : null}
                    {/* Seller staff said yes and the order had already
                        moved on. Loud, because somebody here has to
                        tell a customer the address did NOT change. */}
                    {r.failureReason !== null ? (
                      <span className="ro-sub ro-tone-bad">
                        <TriangleAlert size={12} aria-hidden />{' '}
                        {t('addrfix.notApplied', { reason: r.failureReason })}
                      </span>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : null}
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
        size="lg"
        icon={<MapPinned size={18} />}
        locked={submit.isPending}
        title={t('addrfix.dlg.title')}
        description={consequence}
        footer={
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={submit.isPending}
            >
              {t('addrfix.dlg.neverMind')}
            </Button>
            <AsyncButton
              type="button"
              variant="primary"
              state={submit.isPending ? 'busy' : undefined}
              labels={{ idle: sendLabel, busy: t('addrfix.dlg.sending') }}
              onClick={() => setConfirming(true)}
              disabled={submit.isPending || changedCount === 0}
            />
          </DialogFooter>
        }
      >
        <div className="ro-stack ro-stack--tight">
          <div className="ro-grid-2">
            {FORM_FIELDS.map((f) => (
              <TextField
                key={f.key}
                id={`fix-${f.key}`}
                label={t(FIELD_LABEL[f.key])}
                {...(f.hint === undefined ? {} : { hint: t(f.hint) })}
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              />
            ))}
          </div>
          {waits ? (
            <TextArea
              id="fix-reason"
              label={t('addrfix.dlg.why')}
              hint={t('addrfix.dlg.whyHint')}
              requiredMark
              rows={3}
              maxLength={2000}
              showCount
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          ) : null}
          <p className="ro-faint">
            {changedCount === 0
              ? t('addrfix.dlg.nothing')
              : t(changedCount === 1 ? 'addrfix.dlg.sending.one' : 'addrfix.dlg.sending.other', {
                  n: changedCount,
                })}
          </p>
          {error !== null ? (
            <Notice tone="bad" role="alert" icon={<OctagonX size={16} />}>
              <span>{error}</span>
            </Notice>
          ) : null}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirming && open}
        onOpenChange={setConfirming}
        title={waits ? t('addrfix.confirm.titleWaits') : t('addrfix.confirm.titleDirect')}
        entity={orderNumber}
        entityIsIdentifier
        consequence={consequence}
        confirmLabel={sendLabel}
        cancelLabel={t('addrfix.confirm.back')}
        // Resolves whatever the answer: a refusal is shown in the form
        // behind, which stays open, exactly where it was shown before.
        onConfirm={() => send()}
      >
        <ul className="ro-changes">
          {ALL_FIELDS.filter((k) => proposed[k] !== undefined).map((k) => (
            <li key={k}>
              <span className="ro-faint">{t(FIELD_LABEL[k])}: </span>
              <span>{proposed[k] ?? ''}</span>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </RoSection>
  );
}
