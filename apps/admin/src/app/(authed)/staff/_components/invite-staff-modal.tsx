'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { Button, FormField, Input, Modal, ModalFooter, Select } from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import type { CreatedStaffInvitation } from '@skydrop/api-client';
import { useCreateStaffInvitation } from '@/lib/api-hooks';

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
    if (e instanceof ApiError) {
      const b = e.body as { code?: unknown; message?: unknown } | null;
      const code = typeof b?.code === 'string' ? b.code : null;
      const msg = typeof b?.message === 'string' ? b.message : e.message;
      return code ? `[${code}] ${msg}` : msg;
    }
    return e instanceof Error ? e.message : 'Action failed';
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
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Invite staff member"
      description="The invitee gets a one-time link to set their password. Role is fixed at invite time."
      size="md"
    >
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <FormField label="Email" required>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            required
            placeholder="newstaff@example.com"
          />
        </FormField>
        <FormField label="Role" required>
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value as (typeof ROLES)[number]['value'])}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </FormField>

        {error && (
          <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px]">
            {error}
          </div>
        )}

        <ModalFooter>
          <Button type="button" variant="ghost" size="md" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={busy}>
            {busy ? 'Creating…' : 'Create invitation'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
