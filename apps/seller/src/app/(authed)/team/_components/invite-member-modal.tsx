'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { Button, FormField, Input, Modal, ModalFooter, Select } from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import type { CreatedTeamInvitation } from '@skydrop/api-client';
import { useCreateTeamInvitation } from '@/lib/api-hooks';

const ROLES = [
  { value: 'OWNER', label: 'Owner (full access + billing)' },
  { value: 'ADMIN', label: 'Admin (manage team + everything else)' },
  { value: 'OPS', label: 'Ops (orders, catalog, tracking)' },
  { value: 'INVENTORY', label: 'Inventory (stock + warehouse)' },
  { value: 'FINANCE', label: 'Finance (wallet + remittance)' },
  { value: 'VIEWER', label: 'Viewer (read-only)' },
] as const;

export function InviteMemberModal({
  onClose,
  onSuccess,
}: {
  readonly onClose: () => void;
  readonly onSuccess: (revealed: CreatedTeamInvitation) => void;
}): ReactElement {
  const create = useCreateTeamInvitation();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]['value']>('OPS');
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
        fullName: fullName.trim(),
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
      title="Invite team member"
      description="The invitee gets a one-time link to set their password. Role can be changed later."
      size="md"
    >
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <FormField label="Full name" required>
          <Input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={120}
            required
            placeholder="Jane Doe"
          />
        </FormField>
        <FormField label="Email" required>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            required
            placeholder="jane@example.com"
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
