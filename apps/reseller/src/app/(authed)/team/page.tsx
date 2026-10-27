'use client';

import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { CircleAlert, Mail, Send, ShieldCheck, Trash2, User, UserPlus, Undo2 } from 'lucide-react';
import { useStoreIdentity } from '@skydrop/auth/client';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { TBody, THead, Table, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Dialog, DialogFooter, ConfirmDialog } from '@skydrop/ui/app/dialog';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import { can, isStoreOwner } from '@/lib/page-access';
import { useLocale, useT } from '@/i18n/client';
import { formatDateTime } from '@/i18n/format';
import { verdict } from '@/i18n/verdict';
import {
  useInviteStoreMember,
  useRemoveStoreMember,
  useResendStoreInvitation,
  useRevokeStoreInvitation,
  useSetStoreMemberRoles,
  useStoreTeam,
  type StoreMemberView,
} from '@/lib/store-hooks';
import { RdCallout, RdSection, phaseOf } from '../settings/_components/rd-parts';
import { RoleList, RolePicker, type StoreRoleOption } from './_components/role-picker';

/** The roles only an owner may grant, take away, or touch somebody who holds. */
const OWNER_ONLY = ['owner'] as const;

/**
 * The store's team (RS-2): who has a login, what they may do, and who is
 * invited. Everyone with `team.view` sees it; the controls need
 * `team.manage` — hidden otherwise (cosmetic, FE-2: the API refuses).
 *
 * A person holds SEVERAL roles and their permissions are the union, so
 * every role they hold is shown and a change states the whole set.
 */
export default function TeamPage(): ReactElement {
  const t = useT();
  const me = useStoreIdentity();
  const team = useStoreTeam();
  const manage = can(me, 'team.manage');
  const owner = isStoreOwner(me);
  const [inviting, setInviting] = useState(false);

  if (team.isPending || team.isError) {
    return (
      <div className="rd-page">
        <PageHeader title={t('team.title')} subtitle={t('team.subtitle')} />
        {team.isPending ? (
          <SkeletonRows label={t('team.loading')} rows={4} cols={5} />
        ) : (
          <ErrorState message={verdict(team.error, t)} retry={() => void team.refetch()} />
        )}
      </div>
    );
  }
  const { members, invitations, roles } = team.data;

  return (
    <div className="rd-page">
      <PageHeader
        title={t('team.title')}
        subtitle={t('team.subtitle')}
        action={
          manage ? (
            <Button
              variant="primary"
              size="md"
              icon={<UserPlus size={15} />}
              onClick={() => setInviting(true)}
            >
              {t('team.invite')}
            </Button>
          ) : undefined
        }
      />

      <RdSection title={t('team.members')} note={t('team.membersNote')}>
        {members.length === 0 ? (
          <EmptyState title={t('team.noMembers')} description={t('team.noMembersBody')} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t('team.col.name')}</Th>
                <Th>{t('team.col.email')}</Th>
                <Th>{t('team.col.roles')}</Th>
                <Th>{t('team.col.lastSignedIn')}</Th>
                {manage ? <Th align="right">{t('team.col.actions')}</Th> : null}
              </Tr>
            </THead>
            <TBody>
              {members.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  roles={roles}
                  manage={manage && m.id !== me?.id}
                  mayTouchOwners={owner}
                  isYou={m.id === me?.id}
                />
              ))}
            </TBody>
          </Table>
        )}
      </RdSection>

      <RdSection title={t('team.pending')}>
        {invitations.length === 0 ? (
          <EmptyState
            title={t('team.noPending')}
            description={manage ? t('team.noPendingBody') : undefined}
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t('team.col.name')}</Th>
                <Th>{t('team.col.email')}</Th>
                <Th>{t('team.col.roles')}</Th>
                <Th>{t('team.col.expires')}</Th>
                {manage ? <Th align="right">{t('team.col.actions')}</Th> : null}
              </Tr>
            </THead>
            <TBody>
              {invitations.map((i) => (
                <InvitationRow key={i.id} invitation={i} manage={manage} />
              ))}
            </TBody>
          </Table>
        )}
      </RdSection>

      {manage ? (
        <InviteModal
          open={inviting}
          onOpenChange={setInviting}
          roles={roles}
          mayGrantOwner={owner}
        />
      ) : null}
    </div>
  );
}

function MemberRow({
  member,
  roles,
  manage,
  mayTouchOwners,
  isYou,
}: {
  member: StoreMemberView;
  roles: readonly StoreRoleOption[];
  manage: boolean;
  mayTouchOwners: boolean;
  isYou: boolean;
}): ReactElement {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const remove = useRemoveStoreMember();
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const locked = member.isOwner && !mayTouchOwners;

  return (
    <Tr>
      <Td>
        <span className="rd-cell-strong">{member.fullName}</span>
        {isYou ? <span className="rd-you">{t('team.you')}</span> : null}
      </Td>
      <Td>{member.email}</Td>
      <Td>
        <RoleList names={member.roleNames} />
      </Td>
      <Td className="rd-cell-muted">
        {member.lastLoginAt === null ? t('team.never') : formatDateTime(member.lastLoginAt, locale)}
      </Td>
      {manage ? (
        <Td align="right">
          {locked ? null : (
            <span className="rd-row-actions">
              <Button
                variant="secondary"
                size="sm"
                icon={<ShieldCheck size={14} />}
                onClick={() => setEditing(true)}
              >
                {t('team.changeRoles')}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                icon={<Trash2 size={14} />}
                onClick={() => setConfirming(true)}
              >
                {t('team.remove')}
              </Button>
              <RolesDialog
                open={editing}
                onOpenChange={setEditing}
                member={member}
                roles={roles}
                mayTouchOwners={mayTouchOwners}
              />
              <ConfirmDialog
                open={confirming}
                onOpenChange={setConfirming}
                title={t('team.removeTitle', { name: member.fullName })}
                entity={`${member.fullName} · ${member.email}`}
                consequence={t('team.removeConsequence')}
                confirmLabel={t('team.removeConfirm')}
                destructive
                onConfirm={async () => {
                  try {
                    await remove.mutateAsync({ memberId: member.id });
                    toast.success(t('team.removed', { name: member.fullName }));
                    setConfirming(false);
                  } catch (err) {
                    toast.error(verdict(err, t));
                    // Stays open, as before: nothing was removed.
                    throw err;
                  }
                }}
              />
            </span>
          )}
        </Td>
      ) : null}
    </Tr>
  );
}

/**
 * Change which roles somebody holds.
 *
 * It sends the WHOLE set, so a save states what the screen showed — and
 * it sends it whatever the ticks are, empty included.
 *
 * Five different refusals can come back: an empty set (caught by the
 * DTO's `ArrayMinSize`, or by the service as `NO_ROLES`), an owner
 * granted by a non-owner (`OWNER_GRANT_REQUIRES_OWNER`), an owner
 * edited by a non-owner (`OWNER_CHANGE_REQUIRES_OWNER`), the last owner
 * being moved off (`LAST_OWNER`), and a set built from a stale read
 * (`MEMBER_CHANGED`). Every one reaches the person in the server's own
 * words (FE-2); none is predicted here, because a second copy of five
 * rules is five chances to disagree with the one that counts.
 */
function RolesDialog({
  open,
  onOpenChange,
  member,
  roles,
  mayTouchOwners,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly member: StoreMemberView;
  readonly roles: readonly StoreRoleOption[];
  readonly mayTouchOwners: boolean;
}): ReactElement {
  const t = useT();
  const toast = useToast();
  const save = useSetStoreMemberRoles();
  const [chosen, setChosen] = useState<readonly string[]>(member.roleKeys);
  const [error, setError] = useState<string | null>(null);

  // Re-open on what is true NOW: a refetch (ours after a failed save, or
  // somebody else's change) must not leave the ticks drawn from the list
  // this dialog first mounted with.
  useEffect(() => {
    if (open) {
      setChosen(member.roleKeys);
      setError(null);
    }
  }, [open, member.roleKeys]);

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      const saved = await save.mutateAsync({ memberId: member.id, roleKeys: chosen });
      toast.success(
        saved.roleNames.length === 0
          ? t('team.roles.holdsNone', { name: member.fullName })
          : t('team.roles.nowIs', {
              name: member.fullName,
              roles: saved.roleNames.join(t('team.roles.join')),
            }),
      );
      onOpenChange(false);
    } catch (err) {
      setError(verdict(err, t));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<ShieldCheck size={18} />}
      title={t('team.roles.dlgTitle', { name: member.fullName })}
      description={t('team.roles.dlgDesc')}
    >
      <form onSubmit={submit} className="rd-form">
        <RolePicker
          legend={t('team.roles.legend')}
          options={roles}
          value={chosen}
          onChange={setChosen}
          disabled={save.isPending}
          lockedKeys={mayTouchOwners ? [] : OWNER_ONLY}
          lockedNote={t('team.roles.lockedChange')}
        />
        {error !== null ? (
          <RdCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
            <p>{error}</p>
          </RdCallout>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            {t('team.roles.cancel')}
          </Button>
          <AsyncButton
            type="submit"
            variant="primary"
            size="md"
            icon={<ShieldCheck size={15} />}
            labels={{
              idle: t('team.roles.save'),
              busy: t('team.roles.saving'),
              error: t('team.roles.notSaved'),
            }}
            state={phaseOf(save.isPending, error)}
            disabled={save.isPending}
          />
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function InvitationRow({
  invitation,
  manage,
}: {
  invitation: {
    id: string;
    fullName: string;
    email: string;
    roleNames: readonly string[];
    expiresAt: string;
    expired: boolean;
  };
  manage: boolean;
}): ReactElement {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const revoke = useRevokeStoreInvitation();
  const resend = useResendStoreInvitation();
  const [confirming, setConfirming] = useState(false);
  return (
    <Tr>
      <Td>
        <span className="rd-cell-strong">{invitation.fullName}</span>
      </Td>
      <Td>{invitation.email}</Td>
      <Td>
        <RoleList names={invitation.roleNames} />
      </Td>
      {/* The word, not only the tint — an expired invitation and a live
          one must not read the same to anybody who cannot tell them
          apart by colour. */}
      <Td className="rd-cell-muted">
        {invitation.expired
          ? t('team.expired', { when: formatDateTime(invitation.expiresAt, locale) })
          : formatDateTime(invitation.expiresAt, locale)}
      </Td>
      {manage ? (
        <Td align="right">
          <Button
            variant={invitation.expired ? 'primary' : 'secondary'}
            size="sm"
            icon={<Send size={14} />}
            disabled={resend.isPending || revoke.isPending}
            onClick={async () => {
              try {
                await resend.mutateAsync({ invitationId: invitation.id });
                // Names the dead link: somebody who forwards the first
                // email after resending is sending a key that no longer
                // turns, and would have no way to know.
                toast.success(t('team.resent', { email: invitation.email }));
              } catch (err) {
                toast.error(verdict(err, t));
              }
            }}
          >
            {invitation.expired ? t('team.sendAgain') : t('team.resend')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Undo2 size={14} />}
            disabled={revoke.isPending || resend.isPending}
            onClick={() => setConfirming(true)}
          >
            {t('team.withdraw')}
          </Button>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={t('team.withdrawTitle', { name: invitation.fullName })}
            entity={`${invitation.fullName} · ${invitation.email}`}
            consequence={t('team.withdrawConsequence', { email: invitation.email })}
            confirmLabel={t('team.withdrawConfirm')}
            destructive
            onConfirm={async () => {
              try {
                await revoke.mutateAsync({ invitationId: invitation.id });
                toast.success(t('team.withdrawn'));
              } catch (err) {
                toast.error(verdict(err, t));
              }
              setConfirming(false);
            }}
          />
        </Td>
      ) : null}
    </Tr>
  );
}

function InviteModal({
  open,
  onOpenChange,
  roles,
  mayGrantOwner,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: readonly StoreRoleOption[];
  mayGrantOwner: boolean;
}): ReactElement {
  const t = useT();
  const toast = useToast();
  const invite = useInviteStoreMember();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  // Operations is the daily-work role and the commonest invitation; it is
  // a starting point to change, not a decision made for anybody.
  const [roleKeys, setRoleKeys] = useState<readonly string[]>(['ops']);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      await invite.mutateAsync({ email: email.trim(), fullName: fullName.trim(), roleKeys });
      toast.success(t('team.inv.sent', { email: email.trim() }));
      setEmail('');
      setFullName('');
      setRoleKeys(['ops']);
      onOpenChange(false);
    } catch (err) {
      // Verbatim (FE-2): NO_ROLES, EMAIL_ALREADY_REGISTERED,
      // INVITATION_ALREADY_PENDING, OWNER_GRANT_REQUIRES_OWNER…
      setError(verdict(err, t));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<UserPlus size={18} />}
      title={t('team.inv.title')}
      description={t('team.inv.desc')}
    >
      <form onSubmit={submit} className="rd-form">
        <TextField
          id="invite-name"
          label={t('team.inv.name')}
          icon={<User size={15} />}
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <TextField
          id="invite-email"
          type="email"
          label={t('team.inv.email')}
          icon={<Mail size={15} />}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <RolePicker
          legend={t('team.roles.legend')}
          options={roles}
          value={roleKeys}
          onChange={setRoleKeys}
          disabled={invite.isPending}
          lockedKeys={mayGrantOwner ? [] : OWNER_ONLY}
          lockedNote={t('team.inv.lockedOwner')}
        />
        {error !== null ? (
          <RdCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
            <p>{error}</p>
          </RdCallout>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            {t('team.inv.cancel')}
          </Button>
          <AsyncButton
            type="submit"
            variant="primary"
            size="md"
            icon={<UserPlus size={15} />}
            labels={{
              idle: t('team.inv.send'),
              busy: t('team.inv.sending'),
              error: t('team.inv.notSent'),
            }}
            state={phaseOf(invite.isPending, error)}
            disabled={invite.isPending}
          />
        </DialogFooter>
      </form>
    </Dialog>
  );
}
