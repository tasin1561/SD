'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { Send, UserPlus } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { TextField } from '@skydrop/ui/app/text-field';
import type { CreatedStaffInvitation } from '@skydrop/api-client';
import { useCreateStaffInvitation } from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { AcAlert, phaseOf } from '../../settings/_components/ac-parts';

const ROLES = [
  { value: 'SUPER_ADMIN', label: 'Super admin (full access)' },
  { value: 'SELLER_APPROVAL_ADMIN', label: 'Seller approvals' },
  { value: 'CALL_AGENT', label: 'Call agent' },
  { value: 'WAREHOUSE_STAFF', label: 'Warehouse staff (pick/pack)' },
  { value: 'WAREHOUSE_SUPERVISOR', label: 'Warehouse supervisor' },
  { value: 'MANUAL_PLACEMENT_ADMIN', label: 'Manual placement admin' },
  { value: 'FINANCE', label: 'Finance (remittances + reports)' },
] as const;

export function InviteStaffModal({
  onClose,
  onSuccess,
}: {
  readonly onClose: () => void;
  readonly onSuccess: (revealed: CreatedStaffInvitation) => void;
}): ReactElement {
  const create = useCreateStaffInvitation();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]['value']>('CALL_AGENT');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fmtError(e: unknown): string {
    return serverVerdict(e, 'Action failed');
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const revealed = await create.mutateAsync({
        email: email.trim(),
        role,
      });
      onSuccess(revealed);
    } catch (err) {
      setError(fmtError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Invite staff member"
      description="The invitee gets a one-time link to set their password. Role is fixed at invite time."
      icon={<UserPlus size={18} />}
      size="md"
      locked={busy}
    >
      <form onSubmit={(e) => void onSubmit(e)} className="ac-form">
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={254}
          required
          placeholder="newstaff@example.com"
        />
        <Select
          label="Role"
          requiredMark
          value={role}
          onChange={(e) => setRole(e.target.value as (typeof ROLES)[number]['value'])}
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>

        {error && <AcAlert message={error} />}

        <DialogFooter>
          <Button type="button" variant="ghost" size="md" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <AsyncButton
            type="submit"
            variant="primary"
            size="md"
            icon={<Send size={15} />}
            state={phaseOf(busy, error)}
            labels={{ idle: 'Create invitation', busy: 'Creating…', error: 'Not created' }}
          />
        </DialogFooter>
      </form>
    </Dialog>
  );
}
