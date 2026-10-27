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
import { verdict } from '@/i18n/verdict';
import { SetCallout, phaseOf } from '../../settings/_components/settings-parts';
import { useT } from '@/i18n/client';

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
  const t = useT();
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
      ? t('team.everythingIncludingPermissionsAdded')
      : (r.description ??
        t('team.permission', {
          permissions: r.permissions.length,
          plural: r.permissions.length === 1 ? '' : 's',
        })),
  }));

  function fmtError(e: unknown): string {
    return verdict(e, t, t('team.actionFailed'));
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
      title={t('team.inviteTeamMember')}
      description={t('team.theInviteeGetsA')}
      size="md"
    >
      <form onSubmit={(e) => void onSubmit(e)} className="set-form-grid">
        <TextField
          label={t('team.fullName')}
          icon={<User size={15} />}
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          maxLength={120}
          showCount
          required
          placeholder={t('team.janeDoe')}
        />
        <TextField
          label={t('team.email')}
          icon={<Mail size={15} />}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={254}
          required
          placeholder="jane@example.com"
        />

        {roles.isLoading ? (
          <SkeletonRows rows={1} cols={1} label={t('team.loadingRoles')} />
        ) : roles.isError ? (
          <ErrorState
            message={roles.error?.message ?? t('team.couldNotLoadThis')}
            retry={() => void roles.refetch()}
          />
        ) : (
          <MultiSelect
            label={t('team.roles')}
            icon={<ShieldCheck size={15} />}
            required
            options={options}
            value={roleIds}
            onChange={(next) => {
              setError(null);
              setRoleIds(next);
            }}
            placeholder={
              roleIds.length === 0 ? t('team.chooseOneOrMore') : t('team.addAnotherRole')
            }
            hint={t('team.theyCanDoEverything')}
            emptyText={t('team.noMatchingRole')}
          />
        )}

        {error && (
          <SetCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
            <p>{error}</p>
          </SetCallout>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" size="md" disabled={busy} onClick={onClose}>
            {t('team.cancel')}
          </Button>
          <AsyncButton
            type="submit"
            variant="primary"
            size="md"
            icon={<UserPlus size={15} />}
            labels={{
              idle: t('team.createInvitation'),
              busy: t('team.creating'),
              error: t('team.notCreated'),
            }}
            state={phaseOf(busy, error)}
            disabled={busy}
          />
        </DialogFooter>
      </form>
    </Dialog>
  );
}
