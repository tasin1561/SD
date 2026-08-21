'use client';

import { useEffect, useState, type ReactElement } from 'react';
import {
  Button,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { useUpdateCourierAccount, type CourierAccountView } from '@/lib/ops-hooks';

/**
 * Editing what an account IS, not what it authenticates with.
 *
 * The credential is deliberately absent. It is encrypted at rest with a
 * key the database never holds and is never returned by any endpoint
 * (CUR-1), so there is nothing to pre-fill and no way to show what is
 * currently set. Changing a token means adding an account and
 * deactivating the old one — which keeps a record of which credential
 * carried which shipments, where an in-place edit would silently
 * re-attribute history.
 */
export function EditCourierAccountModal({
  account,
  open,
  onOpenChange,
}: {
  readonly account: CourierAccountView;
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
}): ReactElement {
  const toast = useToast();
  const update = useUpdateCourierAccount();
  const [label, setLabel] = useState(account.label);
  const [pickup, setPickup] = useState(account.pickupLocationName ?? '');
  const [notes, setNotes] = useState(account.notes ?? '');

  // Re-seed when the dialog opens: the row may have changed underneath
  // (someone else edited it, or "Make default" refetched the list).
  useEffect(() => {
    if (open) {
      setLabel(account.label);
      setPickup(account.pickupLocationName ?? '');
      setNotes(account.notes ?? '');
      update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account.id]);

  async function save(): Promise<void> {
    try {
      await update.mutateAsync({
        accountId: account.id,
        label: label.trim(),
        // Empty means "fall back to the global setting", which is a
        // real choice and not the same as leaving it unchanged — sent
        // as an empty string so the server can clear it.
        pickupLocationName: pickup,
        notes: notes.trim(),
      });
      toast.success('Account updated.');
      onOpenChange(false);
    } catch (err) {
      // FE-2 — the server owns the rules; show its refusal verbatim.
      toast.error(serverVerdict(err));
    }
  }

  const pickupChanged = (account.pickupLocationName ?? '') !== pickup;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Edit courier account"
      description="The API credential cannot be edited — it is never readable once saved. To change a token, add an account and deactivate this one."
    >
      <FormField label="Label" htmlFor="ea-label" hint="How an operator tells this account apart.">
        <Input id="ea-label" value={label} onChange={(e) => setLabel(e.target.value)} />
      </FormField>

      <FormField
        label="Pickup location name"
        htmlFor="ea-pickup"
        hint="The warehouse name registered with THIS account at Delhivery, matched byte-for-byte. Leave blank to use the global setting — right for a single account, wrong as soon as there are two."
      >
        <Input
          id="ea-pickup"
          value={pickup}
          onChange={(e) => setPickup(e.target.value)}
          placeholder="Blank = global setting"
        />
      </FormField>

      {pickupChanged && pickup.trim() !== pickup && (
        // Not trimmed on save, deliberately: Delhivery matches this
        // string exactly, so silently "fixing" whitespace would produce
        // a name that does not match the registration. Say it instead.
        <ErrorNote message="This name has leading or trailing spaces. Delhivery matches it exactly — that will not match your registration unless the spaces are really there." />
      )}

      <FormField label="Notes" htmlFor="ea-notes">
        <Textarea id="ea-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FormField>

      {update.error !== null && <ErrorNote message={serverVerdict(update.error)} />}

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          size="md"
          disabled={label.trim() === '' || update.isPending}
          onClick={() => void save()}
        >
          {update.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
