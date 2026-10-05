'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { Send, TriangleAlert, UserPlus } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { MultiSelect } from '@skydrop/ui/app/multi-select';
import type { ComboOption } from '@skydrop/ui/app/combo-select';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { TextField } from '@skydrop/ui/app/text-field';
import type { CreatedStaffInvitation } from '@skydrop/api-client';
import { useCreateStaffInvitation } from '@/lib/api-hooks';
import { useRoles } from '@/lib/rbac-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { AcAlert, AcCallout, phaseOf } from '../../settings/_components/ac-parts';

/**
 * Inviting somebody onto the roles they will actually hold.
 *
 * ── THE HOLE THIS CLOSES ─────────────────────────────────────────────
 * This form offered a hardcoded list of the seven seeded roles, because
 * the field was the `StaffRole` enum. So **nobody could be invited onto
 * a role the team invented** — the only route onto one was to invite
 * somebody as one of the seven and re-role them afterwards, which made
 * the roles screen half a feature: build exactly the role a new
 * colleague needs, then hand them a different one to get them in the
 * door. The options are the live role list now, every one of them, and
 * one of the three access tiers added in `20261005000100` is as
 * invitable as a job function.
 *
 * ── SEVERAL, BECAUSE AN ASSIGNMENT CAN SAY SEVERAL ───────────────────
 * An invitation that can only name one role makes a correction the first
 * task after somebody joins. Permissions resolve as the union, so "call
 * agent who also works the support desk" is two roles on the invitation.
 *
 * ── THE EMPTY SET IS SENT (FE-2) ─────────────────────────────────────
 * The server refuses an invitation with no roles, and that refusal is
 * the enforcement. This form marks the field required and says what
 * will happen; it does not disable the button to stand in for a rule it
 * does not own, and it does not name the code — which guard catches an
 * empty list is the server's business and has already moved once.
 */
export function InviteStaffModal({
  onClose,
  onSuccess,
}: {
  readonly onClose: () => void;
  readonly onSuccess: (revealed: CreatedStaffInvitation) => void;
}): ReactElement {
  const create = useCreateStaffInvitation();
  const roles = useRoles();
  const [email, setEmail] = useState('');
  const [roleIds, setRoleIds] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fmtError(e: unknown): string {
    return serverVerdict(e, 'Action failed');
  }

  const options: readonly ComboOption[] = (roles.data ?? []).map((r) => ({
    value: r.id,
    label: r.name,
    description:
      r.description ??
      (r.isSuperAdmin
        ? 'Everything, including permissions added later'
        : `${r.permissions.length} permission${r.permissions.length === 1 ? '' : 's'}`),
  }));

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const revealed = await create.mutateAsync({ email: email.trim(), roleIds });
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
      description="The invitee gets a one-time link to set their password. The roles are fixed at invite time and can be changed afterwards."
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

        {roles.isLoading ? (
          <SkeletonRows rows={1} cols={1} label="Loading roles…" />
        ) : roles.isError ? (
          <AcAlert
            tone="warn"
            message={`The role list did not load, so there is nothing to choose from. ${serverVerdict(
              roles.error,
              'Could not load roles.',
            )}`}
          />
        ) : (
          <MultiSelect
            label="Roles"
            required
            options={options}
            value={roleIds}
            onChange={(values) => {
              setError(null);
              setRoleIds(values);
            }}
            placeholder="Type to find a role"
            hint="Pick an access tier for how much of the console they reach, plus the job functions they do. Any role from the Roles screen is valid here."
            disabled={busy}
          />
        )}

        {roleIds.length === 0 && !roles.isLoading && !roles.isError && (
          <AcCallout tone="warn" icon={<TriangleAlert size={15} />} role="status">
            Choose at least one role. Somebody holding none cannot sign in at all, so the server
            refuses an invitation without any.
          </AcCallout>
        )}

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
