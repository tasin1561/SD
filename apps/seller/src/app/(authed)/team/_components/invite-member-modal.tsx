'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { CircleAlert, Mail, ShieldCheck, User, UserPlus } from 'lucide-react';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { TextField } from '@skydrop/ui/app/text-field';
import { MultiSelect } from '@skydrop/ui/app/multi-select';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import type { CreatedTeamInvitation } from '@skydrop/api-client';
import { useCreateTeamInvitation } from '@/lib/api-hooks';
import { useRoles } from '@/lib/rbac-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { SetCallout, phaseOf } from '../../settings/_components/settings-parts';

/**
 * ── THE SIX HARDCODED ROLES ARE GONE ────────────────────────────────
 * This form offered a fixed list of the legacy `SellerUserRole` enum
 * values and posted `role: 'OPS'`. Roles have been rows for a while:
 * a company could build exactly the role a new colleague needed under
 * Team → Roles and then had no way to invite anybody onto it — the only
 * route was to invite them as one of the six and change it afterwards,
 * which grants the wrong access in the meantime.
 *
 * The options are now the company's OWN roles, served by the API, and
 * SEVERAL can be chosen: permissions are the union of every role held,
 * so an invitation has to be able to say the same thing an assignment
 * does.
 *
 * ── NOTHING SELECTED IS THE SERVER'S CALL ───────────────────────────
 * Submit is NOT disabled on an empty selection and the count is not
 * checked here: whatever the server answers is displayed verbatim
 * (FE-2). It is deliberately not written down anywhere on this screen
 * WHICH refusal that is — the DTO's minimum, the service's own check
 * and the guard can each produce it, and the code changed once during
 * this very change. A client-side mirror of the rule is the thing that
 * goes stale and then silently disagrees. The field is marked required
 * so a screen reader announces it, which is accessibility, not
 * enforcement.
 */
export function InviteMemberModal({
  onClose,
  onSuccess,
}: {
  readonly onClose: () => void;
  readonly onSuccess: (revealed: CreatedTeamInvitation) => void;
}): ReactElement {
  const create = useCreateTeamInvitation();
  const roles = useRoles();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [roleIds, setRoleIds] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = (roles.data ?? []).map((r) => ({
    value: r.id,
    label: r.name,
    // What the role covers, so the choice is made on the permissions and
    // not on a name somebody at this company picked months ago.
    description: r.isOwner
      ? 'Everything, including permissions added later'
      : (r.description ??
        `${r.permissions.length} permission${r.permissions.length === 1 ? '' : 's'}`),
  }));

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
        roleIds,
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
      description="The invitee gets a one-time link to set their password. Which roles they hold can be changed later."
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

        {roles.isLoading ? (
          <SkeletonRows rows={1} cols={1} label="Loading roles…" />
        ) : roles.isError ? (
          <ErrorState
            message={roles.error?.message ?? 'Could not load this company’s roles.'}
            retry={() => void roles.refetch()}
          />
        ) : (
          <MultiSelect
            label="Roles"
            icon={<ShieldCheck size={15} />}
            required
            options={options}
            value={roleIds}
            onChange={(next) => {
              setError(null);
              setRoleIds(next);
            }}
            placeholder={roleIds.length === 0 ? 'Choose one or more roles' : 'Add another role'}
            hint="They can do everything their roles cover between them. Roles are set up under Team → Roles."
            emptyText="No matching role"
          />
        )}

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
