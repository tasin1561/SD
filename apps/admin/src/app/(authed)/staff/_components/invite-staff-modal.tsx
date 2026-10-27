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
import { useT } from '@/i18n/client';

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
  const t = useT();
  const create = useCreateStaffInvitation();
  const roles = useRoles();
  const [email, setEmail] = useState('');
  const [roleIds, setRoleIds] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fmtError(e: unknown): string {
    return serverVerdict(e, t('staffInviteStaffModal.actionFailed'));
  }

  const options: readonly ComboOption[] = (roles.data ?? []).map((r) => ({
    value: r.id,
    label: r.name,
    description:
      r.description ??
      (r.isSuperAdmin
        ? t('staffInviteStaffModal.everythingIncludingPermissionsAddedLater')
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
      title={t('staffInviteStaffModal.inviteStaffMember')}
      description={t('staffInviteStaffModal.theInviteeGetsAOne')}
      icon={<UserPlus size={18} />}
      size="md"
      locked={busy}
    >
      <form onSubmit={(e) => void onSubmit(e)} className="ac-form">
        <TextField
          label={t('staffInviteStaffModal.email')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={254}
          required
          placeholder="newstaff@example.com"
        />

        {roles.isLoading ? (
          <SkeletonRows rows={1} cols={1} label={t('staffInviteStaffModal.loadingRoles')} />
        ) : roles.isError ? (
          <AcAlert
            tone="warn"
            message={t('staffInviteStaffModal.theRoleListDidNot', {
              value: serverVerdict(roles.error, 'Could not load roles.'),
            })}
          />
        ) : (
          <MultiSelect
            label={t('staffInviteStaffModal.roles')}
            required
            options={options}
            value={roleIds}
            onChange={(values) => {
              setError(null);
              setRoleIds(values);
            }}
            placeholder={t('staffInviteStaffModal.typeToFindARole')}
            hint={t('staffInviteStaffModal.pickAnAccessTierFor')}
            disabled={busy}
          />
        )}

        {roleIds.length === 0 && !roles.isLoading && !roles.isError && (
          <AcCallout tone="warn" icon={<TriangleAlert size={15} />} role="status">
            {t('staffInviteStaffModal.chooseAtLeastOneRole')}
          </AcCallout>
        )}

        {error && <AcAlert message={error} />}

        <DialogFooter>
          <Button type="button" variant="ghost" size="md" disabled={busy} onClick={onClose}>
            {t('staffInviteStaffModal.cancel')}
          </Button>
          <AsyncButton
            type="submit"
            variant="primary"
            size="md"
            icon={<Send size={15} />}
            state={phaseOf(busy, error)}
            labels={{
              idle: t('staffInviteStaffModal.createInvitation'),
              busy: t('staffInviteStaffModal.creating'),
              error: t('staffInviteStaffModal.notCreated'),
            }}
          />
        </DialogFooter>
      </form>
    </Dialog>
  );
}
