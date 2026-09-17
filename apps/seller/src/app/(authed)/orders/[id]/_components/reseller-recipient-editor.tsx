'use client';

import { useState, type ReactElement } from 'react';
import type { OrderView } from '@skydrop/api-client';
import { Button, FormField, Input, Modal, ModalFooter, useToast } from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { useUpdateOrder, type UpdateOrderInput } from '@/lib/api-hooks';

type Field =
  | 'recipientName'
  | 'recipientPhoneE164'
  | 'recipientAltPhoneE164'
  | 'recipientEmail'
  | 'recipientAddressLine1'
  | 'recipientAddressLine2'
  | 'recipientCity'
  | 'recipientStateProvince'
  | 'recipientPostalCode';

const FIELDS: ReadonlyArray<{ key: Field; label: string; hint?: string }> = [
  { key: 'recipientName', label: 'Name' },
  { key: 'recipientPhoneE164', label: 'Phone', hint: 'With the country code, e.g. +919876543210' },
  { key: 'recipientAltPhoneE164', label: 'Second phone' },
  { key: 'recipientEmail', label: 'Email' },
  { key: 'recipientAddressLine1', label: 'Address' },
  {
    key: 'recipientAddressLine2',
    label: 'Landmark line',
    hint: 'The landmark goes here — it is what a driver finds a rural address by.',
  },
  { key: 'recipientCity', label: 'City' },
  { key: 'recipientStateProvince', label: 'State' },
  { key: 'recipientPostalCode', label: 'PIN code' },
];

function current(order: OrderView, key: Field): string {
  return order[key] ?? '';
}

/**
 * Seller staff correcting the CUSTOMER on a Reseller store's order
 * (2026-09-17, owner decision).
 *
 * Only the recipient: the products, prices and terms are the store's deal
 * and the server refuses anything else (`RESELLER_ORDER_NOT_EDITABLE`).
 * The same status and call rules as any edit apply, the change is
 * recorded as Seller staff's, and the Reseller store is emailed what
 * changed. A correction the store had waiting on Seller staff is closed.
 * The server decides all of it; refusals are shown verbatim (FE-2).
 */
export function ResellerRecipientEditor({ order }: { order: OrderView }): ReactElement {
  const update = useUpdateOrder(order.id);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);

  const changes: Partial<Record<Field, string>> = {};
  for (const f of FIELDS) {
    const next = (draft[f.key] ?? '').trim();
    // A box left blank is left alone rather than cleared.
    if (next !== '' && next !== current(order, f.key).trim()) changes[f.key] = next;
  }
  const count = Object.keys(changes).length;

  function start(): void {
    const seeded: Partial<Record<Field, string>> = {};
    for (const f of FIELDS) seeded[f.key] = current(order, f.key);
    setDraft(seeded);
    setError(null);
    setOpen(true);
  }

  async function save(): Promise<void> {
    setError(null);
    try {
      await update.mutateAsync(changes as UpdateOrderInput);
      toast.success('Corrected. The Reseller store has been emailed what changed.');
      setOpen(false);
    } catch (err) {
      // Verbatim (FE-2): NOT_EDITABLE, EDIT_DURING_CALL, RESELLER_ORDER_NOT_EDITABLE…
      setError(serverVerdict(err));
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={start}>
        Correct customer details
      </Button>
      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
        title="Correct the customer’s details"
        description="This order was sold by a Reseller store. You may correct who it goes to; its products and prices stay the store's. The store is emailed what you changed."
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <FormField
                key={f.key}
                label={f.label}
                htmlFor={`reseller-fix-${f.key}`}
                {...(f.hint === undefined ? {} : { hint: f.hint })}
              >
                <Input
                  id={`reseller-fix-${f.key}`}
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
              </FormField>
            ))}
          </div>
          <p className="text-text-faint text-xs">
            {count === 0
              ? 'Nothing has changed yet — edit a detail above.'
              : `Saving ${count} change${count === 1 ? '' : 's'}. A box left as it is stays as it is.`}
          </p>
          {error !== null ? (
            <p role="alert" className="text-critical text-sm">
              {error}
            </p>
          ) : null}
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setOpen(false)}
              disabled={update.isPending}
            >
              Never mind
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => void save()}
              disabled={update.isPending || count === 0}
            >
              {update.isPending ? 'Saving…' : 'Save the correction'}
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    </>
  );
}
