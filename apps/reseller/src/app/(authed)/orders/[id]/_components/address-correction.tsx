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
import { serverVerdict } from '@/lib/server-verdict';
import {
  useEditStoreRecipient,
  useStoreAddressChanges,
  type AddressChangeFields,
  type AddressField,
  type StoreOrderView,
} from '@/lib/order-hooks';
import { Notice, RoSection } from '../../_components/orders-parts';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * What a person calls each delivery detail.
 *
 * All ten, not just the ones the form below offers: a correction made
 * through the API or a CSV may carry one the form does not, and the
 * history has to be able to name it.
 */
const FIELD_LABEL: Readonly<Record<AddressField, string>> = {
  recipientName: 'Name',
  recipientPhoneE164: 'Phone',
  recipientAltPhoneE164: 'Second phone',
  recipientEmail: 'Email',
  recipientAddressLine1: 'Address',
  recipientAddressLine2: 'Landmark line',
  recipientLandmark: 'Landmark (old field)',
  recipientCity: 'City',
  recipientStateProvince: 'State',
  recipientPostalCode: 'PIN code',
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
  readonly hint?: string;
  readonly current: (r: StoreOrderView['recipient']) => string;
}> = [
  { key: 'recipientName', current: (r) => r.name },
  {
    key: 'recipientPhoneE164',
    hint: 'With the country code, e.g. +919876543210',
    current: (r) => r.phoneE164,
  },
  { key: 'recipientAltPhoneE164', current: (r) => r.altPhoneE164 ?? '' },
  { key: 'recipientEmail', current: (r) => r.email ?? '' },
  { key: 'recipientAddressLine1', current: (r) => r.addressLine1 },
  {
    key: 'recipientAddressLine2',
    hint: 'The landmark goes here — it is what a driver finds a rural address by.',
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
      toast.success(
        out.applied
          ? 'Corrected. The parcel now goes to the new address.'
          : 'Sent to seller staff. The parcel keeps the old address until they answer.',
      );
      setOpen(false);
    } catch (err) {
      // Verbatim (FE-2): ADDRESS_CHANGE_REASON_REQUIRED,
      // ADDRESS_CHANGE_ALREADY_OPEN, STORE_ACTION_NOT_ALLOWED,
      // NOT_EDITABLE, COURIER_MUST_ACCEPT_ADDRESS_CHANGE, RETAIL_OUT_OF_RANGE…
      setError(serverVerdict(err));
    }
  }

  if (changes.isPending) {
    return <SkeletonRows rows={2} cols={3} label="Loading the delivery details" />;
  }
  if (changes.isError) {
    return (
      <ErrorState message={serverVerdict(changes.error)} retry={() => void changes.refetch()} />
    );
  }

  const history = changes.data.items;
  // Open means PENDING or APPROVED (still being applied) — the server
  // refuses a second correction while either exists.
  const pending = history.find((r) => r.status === 'PENDING' || r.status === 'APPROVED') ?? null;
  if (mode === 'OFF' && history.length === 0) return <></>;

  const sendLabel = waits ? 'Send it to seller staff' : 'Correct it';
  const consequence = waits
    ? 'Seller staff decide this one. The parcel keeps the OLD address until they answer.'
    : 'This is written onto the order as soon as you send it.';

  return (
    <RoSection
      title="Something wrong with this order?"
      note={
        mode === 'OFF'
          ? 'Your seller does not allow this store to change its orders.'
          : !stageOpen
            ? 'What is in the parcel can only change until the customer confirms it on our call. The customer’s details can still be corrected — while the parcel is with the courier, only if they accept it.'
            : waits
              ? 'Seller staff read the change and decide. Nothing on the order changes until they answer.'
              : 'A change here is written onto the order straight away.'
      }
    >
      <div className="ro-stack">
        {mode === 'OFF' ? (
          <p className="ro-p">Ask the seller if anything on this order needs to change.</p>
        ) : !stageOpen ? (
          <p className="ro-p">
            This order is past that stage, so what is in the parcel stands. The customer’s details
            can still be corrected — ask your seller, and once it is with the courier the change
            only sticks if the courier accepts it. Once it is out for delivery you can also ask for
            another attempt or for it to be sent back.
          </p>
        ) : (
          <div className="ro-offer">
            <Button
              variant="secondary"
              icon={<PencilLine size={15} />}
              disabled={pending !== null}
              onClick={start}
            >
              Change this order
            </Button>
            <span className="ro-offer__note">
              {pending !== null || waits ? (
                <Clock size={13} aria-hidden />
              ) : (
                <Zap size={13} aria-hidden />
              )}
              {pending !== null
                ? 'A change on this order is still open with seller staff — it has to be finished before you can send another.'
                : waits
                  ? 'Seller staff approve this one before anything changes'
                  : 'Happens as soon as you send it'}
            </span>
          </div>
        )}

        {history.length > 0 ? (
          <Table caption="What you asked to change">
            <THead>
              <Tr>
                <Th>What you asked to change</Th>
                <Th>Why</Th>
                <Th>When</Th>
                <Th>Where it got to</Th>
              </Tr>
            </THead>
            <TBody>
              {history.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <ul className="ro-changes">
                      {ALL_FIELDS.filter((k) => r.fields[k] !== undefined).map((k) => (
                        <li key={k}>
                          <span className="ro-faint">{FIELD_LABEL[k]}: </span>
                          <span>{r.fields[k] ?? ''}</span>
                        </li>
                      ))}
                    </ul>
                  </Td>
                  <Td>
                    <span className="ro-faint">{r.reason}</span>
                  </Td>
                  <Td>
                    <span className="ro-muted sk-figure">{when(r.createdAt)}</span>
                  </Td>
                  <Td>
                    <StatusChip
                      kind={storeAddressChangeStatusKind(r.status)}
                      label={storeAddressChangeStatusLabel(r.status)}
                      size="sm"
                    />
                    {r.decisionNote !== null ? (
                      <p className="ro-quote">They said: “{r.decisionNote}”</p>
                    ) : null}
                    {/* Seller staff said yes and the order had already
                        moved on. Loud, because somebody here has to
                        tell a customer the address did NOT change. */}
                    {r.failureReason !== null ? (
                      <span className="ro-sub ro-tone-bad">
                        <TriangleAlert size={12} aria-hidden /> Not applied — {r.failureReason}
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
        title="Correct the delivery address"
        description={consequence}
        footer={
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={submit.isPending}
            >
              Never mind
            </Button>
            <AsyncButton
              type="button"
              variant="primary"
              state={submit.isPending ? 'busy' : undefined}
              labels={{ idle: sendLabel, busy: 'Sending…' }}
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
                label={FIELD_LABEL[f.key]}
                {...(f.hint === undefined ? {} : { hint: f.hint })}
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              />
            ))}
          </div>
          {waits ? (
            <TextArea
              id="fix-reason"
              label="Why the details are wrong"
              hint="At least a sentence — seller staff read this before deciding."
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
              ? 'Nothing has changed yet — edit a detail above.'
              : `Sending ${changedCount} change${changedCount === 1 ? '' : 's'}. A box left as it is stays as it is.`}
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
        title={waits ? 'Send this change to seller staff?' : 'Correct this order now?'}
        entity={orderNumber}
        entityIsIdentifier
        consequence={consequence}
        confirmLabel={sendLabel}
        cancelLabel="Back"
        // Resolves whatever the answer: a refusal is shown in the form
        // behind, which stays open, exactly where it was shown before.
        onConfirm={() => send()}
      >
        <ul className="ro-changes">
          {ALL_FIELDS.filter((k) => proposed[k] !== undefined).map((k) => (
            <li key={k}>
              <span className="ro-faint">{FIELD_LABEL[k]}: </span>
              <span>{proposed[k] ?? ''}</span>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </RoSection>
  );
}
