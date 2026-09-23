'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { CircleAlert, Mail, ShieldCheck, User, UserPlus } from 'lucide-react';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import type { CreatedTeamInvitation } from '@skydrop/api-client';
import { useCreateTeamInvitation } from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { SetCallout, phaseOf } from '../../settings/_components/settings-parts';

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
    return serverVerdict(e, 'Action failed');
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
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      icon={<UserPlus size={18} />}
      title="Invite team member"
      description="The invitee gets a one-time link to set their password. Role can be changed later."
      size="md"
    >
      <form onSubmit={(e) => void onSubmit(e)} className="set-form-grid">
        <TextField
          label="Full name"
          icon={<User size={15} />}
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          maxLength={120}
          showCount
          required
          placeholder="Jane Doe"
        />
        <TextField
          label="Email"
          icon={<Mail size={15} />}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={254}
          required
          placeholder="jane@example.com"
        />
        <Select
          label="Role"
          icon={<ShieldCheck size={15} />}
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

        {error && (
          <SetCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
            <p>{error}</p>
          </SetCallout>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" size="md" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <AsyncButton
            type="submit"
            variant="primary"
            size="md"
            icon={<UserPlus size={15} />}
            labels={{ idle: 'Create invitation', busy: 'Creating…', error: 'Not created' }}
            state={phaseOf(busy, error)}
            disabled={busy}
          />
        </DialogFooter>
      </form>
    </Dialog>
  );
}
