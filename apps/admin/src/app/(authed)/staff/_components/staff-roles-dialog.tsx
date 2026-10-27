'use client';

import { useState, type ReactElement } from 'react';
import { ShieldCheck, TriangleAlert } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { MultiSelect } from '@skydrop/ui/app/multi-select';
import type { ComboOption } from '@skydrop/ui/app/combo-select';
import type { StaffUserRow } from '@skydrop/api-client';
import { useSetStaffRoles } from '@/lib/api-hooks';
import { unionPermissions } from '@/lib/role-axes';
import type { RoleView } from '@/lib/rbac-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { AcAlert, AcCallout, phaseOf } from '../../settings/_components/ac-parts';
import { useT } from '@/i18n/client';

/**
 * Which roles one staff member holds.
 *
 * ── SEVERAL, AND A DIALOG RATHER THAN THE ROW ────────────────────────
 * A person holds a set now, so the control is a multi-select. It does
 * NOT go in the table cell it replaced: `.sk-table-wrap` is
 * `overflow-x: auto`, which clips an absolutely-positioned listbox, and
 * below `md` the row is a stacked card. The list shows the role names as
 * chips — legible at a glance, which is the point — and this dialog is
 * where they are changed.
 *
 * ── THE UNION IS THE ANSWER, NOT THE SUM ─────────────────────────────
 * "What will this person be able to do" is the union of every role's
 * permissions, because that is what the guard resolves. Adding the
 * per-role counts double-counts everything two roles share, and a tier
 * plus a job function share a great deal, so the summary computes the
 * union — and says "everything" when a super-admin role is in the set,
 * since that one grants permissions that do not exist yet.
 *
 * ── THE EMPTY SET IS SENT, NOT BLOCKED (FE-2) ────────────────────────
 * Clearing every chip leaves a person the guard answers UNAUTHORIZED
 * for — there is nothing to reason about permission-wise, so they are
 * signed out and cannot sign in again. The server refuses the change.
 * This screen WARNS and still submits, because a disabled button is a
 * client-side mirror of the server's policy: the moment the rule
 * changes, or a role is soft-deleted out from under us, the greyed
 * control is enforcing something nobody checked.
 *
 * Deliberately NO code string in the copy, here or in the tests'
 * expectations about wording. Which refusal arrives depends on which
 * guard catches it — the DTO's own minimum, a service check, the
 * last-super-admin rule, "you cannot change your own roles" — and
 * `serverVerdict` renders whichever one it is, verbatim. Predicting it
 * is how the screen comes to describe a rule that moved.
 */
export function StaffRolesDialog({
  user,
  roles,
  catalogueSize,
  onClose,
  onSaved,
}: {
  readonly user: StaffUserRow;
  readonly roles: readonly RoleView[];
  /** How many permissions exist in all, for "41 of 68". */
  readonly catalogueSize: number;
  readonly onClose: () => void;
  readonly onSaved: (roleNames: readonly string[]) => void;
}): ReactElement {
  const t = useT();
  const setRoles = useSetStaffRoles();
  const [chosen, setChosen] = useState<readonly string[]>(user.roleIds);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Seeded ONCE, on mount, and there is deliberately no effect
  // re-seeding it from `user`. Two things make that safe rather than
  // lucky: the caller hands over the row it had in STATE when the button
  // was clicked, so a background refetch of the staff list does not
  // reach in here; and it mounts this with `key={user.id}`, so a
  // different person is a different component. An effect would be the
  // one way a half-made choice could be thrown away silently.

  const options: readonly ComboOption[] = roles.map((r) => ({
    value: r.id,
    label: r.name,
    description:
      r.description ??
      (r.isSuperAdmin
        ? t('staffStaffRolesDialog.everythingIncludingPermissionsAddedLater')
        : `${r.permissions.length} permission${r.permissions.length === 1 ? '' : 's'}`),
  }));

  const selectedRoles = chosen
    .map((id) => roles.find((r) => r.id === id))
    .filter((r): r is RoleView => r !== undefined);
  const union = unionPermissions(selectedRoles);
  const held = new Set(user.roleIds);
  const picked = new Set(chosen);
  const added = selectedRoles.filter((r) => !held.has(r.id)).map((r) => r.name);
  const removed = user.roleIds
    .filter((id) => !picked.has(id))
    .map((id) => roles.find((r) => r.id === id)?.name ?? id);
  const unchanged = added.length === 0 && removed.length === 0;

  async function save(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const result = await setRoles.mutateAsync({ id: user.id, roleIds: chosen });
      onSaved(result.roleNames);
    } catch (e) {
      setError(serverVerdict(e, t('staffStaffRolesDialog.rolesNotChanged')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={t('staffStaffRolesDialog.rolesFor', { emailDisplay: user.emailDisplay })}
      description={t('staffStaffRolesDialog.aPersonMayHoldSeveral')}
      icon={<ShieldCheck size={18} />}
      size="md"
      locked={busy}
      footer={
        <DialogFooter>
          <Button type="button" variant="ghost" size="md" disabled={busy} onClick={onClose}>
            {t('staffStaffRolesDialog.cancel')}
          </Button>
          <AsyncButton
            variant="primary"
            size="md"
            state={phaseOf(busy, error)}
            labels={{
              idle: t('staffStaffRolesDialog.saveRoles'),
              busy: t('staffStaffRolesDialog.saving'),
              error: t('staffStaffRolesDialog.notSaved'),
            }}
            // Only "nothing to do" and "already in flight" disable this.
            // Whether the SET is allowed is the server's call (FE-2).
            disabled={busy || unchanged}
            onClick={() => void save()}
          />
        </DialogFooter>
      }
    >
      <div className="ac-form">
        <MultiSelect
          label={t('staffStaffRolesDialog.roles')}
          required
          options={options}
          value={chosen}
          onChange={(values) => {
            setError(null);
            setChosen(values);
          }}
          placeholder={t('staffStaffRolesDialog.typeToFindARole')}
          hint={t('staffStaffRolesDialog.pickAnAccessTierFor')}
          disabled={busy}
        />

        {chosen.length === 0 ? (
          <AcCallout tone="critical" icon={<TriangleAlert size={15} />} role="alert">
            {t('staffStaffRolesDialog.somebodyHoldingNoRolesAt')}
          </AcCallout>
        ) : (
          <AcCallout tone="info" icon={<ShieldCheck size={15} />} role="status">
            {union.everything ? (
              <>
                <strong>{t('staffStaffRolesDialog.everything')}</strong> One of these grants the
                whole catalogue, including permissions added later.
              </>
            ) : catalogueSize > 0 ? (
              <>
                Together these grant <span className="sk-figure">{union.count}</span> of{' '}
                <span className="sk-figure">{catalogueSize}</span> permissions.
              </>
            ) : (
              // The catalogue is behind its own permission and may not
              // have loaded. "N of 0" is worse than no denominator.
              <>
                Together these grant <span className="sk-figure">{union.count}</span> permission
                {union.count === 1 ? '' : 's'}.
              </>
            )}
          </AcCallout>
        )}

        {!unchanged && (
          <ul className="ac-list">
            {added.length > 0 && (
              <li>
                <span className="ac-strong">{t('staffStaffRolesDialog.gains')}</span>{' '}
                {added.join(', ')}
              </li>
            )}
            {removed.length > 0 && (
              <li>
                <span className="ac-strong">{t('staffStaffRolesDialog.loses')}</span>{' '}
                {removed.join(', ')}
              </li>
            )}
          </ul>
        )}

        {error !== null && <AcAlert message={error} />}
      </div>
    </Dialog>
  );
}
