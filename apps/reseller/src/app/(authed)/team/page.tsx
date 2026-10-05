'use client';

import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { CircleAlert, Mail, ShieldCheck, Trash2, User, UserPlus, Undo2 } from 'lucide-react';
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
import { serverVerdict } from '@/lib/server-verdict';
import {
  useInviteStoreMember,
  useRemoveStoreMember,
  useRevokeStoreInvitation,
  useSetStoreMemberRoles,
  useStoreTeam,
  type StoreMemberView,
} from '@/lib/store-hooks';
import { RdCallout, RdSection, phaseOf } from '../settings/_components/rd-parts';
import { RoleList, RolePicker, type StoreRoleOption } from './_components/role-picker';

function when(iso: string | null): string {
  return iso === null
    ? 'never'
    : new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

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
  const me = useStoreIdentity();
  const team = useStoreTeam();
  const manage = can(me, 'team.manage');
  const owner = isStoreOwner(me);
  const [inviting, setInviting] = useState(false);

  if (team.isPending || team.isError) {
    return (
      <div className="rd-page">
        <PageHeader title="Team" subtitle="Everybody with a login for this store." />
        {team.isPending ? (
          <SkeletonRows label="Loading the team" rows={4} cols={5} />
        ) : (
          <ErrorState message={serverVerdict(team.error)} retry={() => void team.refetch()} />
        )}
      </div>
    );
  }
  const { members, invitations, roles } = team.data;

  return (
    <div className="rd-page">
      <PageHeader
        title="Team"
        subtitle="Everybody with a login for this store."
        action={
          manage ? (
            <Button
              variant="primary"
              size="md"
              icon={<UserPlus size={15} />}
              onClick={() => setInviting(true)}
            >
              Invite a colleague
            </Button>
          ) : undefined
        }
      />

      <RdSection
        title="Members"
        note="Somebody can hold more than one role; what they may do is everything their roles allow put together."
      >
        {members.length === 0 ? (
          <EmptyState title="No members yet" description="Invite a colleague to get started." />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Roles</Th>
                <Th>Last signed in</Th>
                {manage ? <Th align="right">Actions</Th> : null}
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

      <RdSection title="Pending invitations">
        {invitations.length === 0 ? (
          <EmptyState
            title="No pending invitations"
            description={
              manage ? 'Invitations you send appear here until they are accepted.' : undefined
            }
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Roles</Th>
                <Th>Expires</Th>
                {manage ? <Th align="right">Actions</Th> : null}
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
  const toast = useToast();
  const remove = useRemoveStoreMember();
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const locked = member.isOwner && !mayTouchOwners;

  return (
    <Tr>
      <Td>
        <span className="rd-cell-strong">{member.fullName}</span>
        {isYou ? <span className="rd-you"> (you)</span> : null}
      </Td>
      <Td>{member.email}</Td>
      <Td>
        <RoleList names={member.roleNames} />
      </Td>
      <Td className="rd-cell-muted">{when(member.lastLoginAt)}</Td>
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
                Change roles
              </Button>
              <Button
                variant="destructive"
                size="sm"
                icon={<Trash2 size={14} />}
                onClick={() => setConfirming(true)}
              >
                Remove
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
                title={`Remove ${member.fullName}?`}
                entity={`${member.fullName} · ${member.email}`}
                consequence="Their access ends now, including any session they have open."
                confirmLabel="Remove access"
                destructive
                onConfirm={async () => {
                  try {
                    await remove.mutateAsync({ memberId: member.id });
                    toast.success(`${member.fullName} no longer has access.`);
                    setConfirming(false);
                  } catch (err) {
                    toast.error(serverVerdict(err));
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
          ? `${member.fullName} holds no role.`
          : `${member.fullName} is now ${saved.roleNames.join(' and ')}.`,
      );
      onOpenChange(false);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<ShieldCheck size={18} />}
      title={`What ${member.fullName} may do`}
      description="Tick every role they hold. What they may do is all of them put together, and it changes as soon as you save."
    >
      <form onSubmit={submit} className="rd-form">
        <RolePicker
          legend="Roles"
          options={roles}
          value={chosen}
          onChange={setChosen}
          disabled={save.isPending}
          lockedKeys={mayTouchOwners ? [] : OWNER_ONLY}
          lockedNote="Only an owner of this store can make somebody an owner."
        />
        {error !== null ? (
          <RdCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
            <p>{error}</p>
          </RdCallout>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <AsyncButton
            type="submit"
            variant="primary"
            size="md"
            icon={<ShieldCheck size={15} />}
            labels={{ idle: 'Save roles', busy: 'Saving…', error: 'Not saved' }}
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
  };
  manage: boolean;
}): ReactElement {
  const toast = useToast();
  const revoke = useRevokeStoreInvitation();
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
      <Td className="rd-cell-muted">{when(invitation.expiresAt)}</Td>
      {manage ? (
        <Td align="right">
          <Button
            variant="secondary"
            size="sm"
            icon={<Undo2 size={14} />}
            disabled={revoke.isPending}
            onClick={() => setConfirming(true)}
          >
            Withdraw
          </Button>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={`Withdraw the invitation to ${invitation.fullName}?`}
            entity={`${invitation.fullName} · ${invitation.email}`}
            consequence={`The link sent to ${invitation.email} stops working. You can invite them again later.`}
            confirmLabel="Withdraw invitation"
            destructive
            onConfirm={async () => {
              try {
                await revoke.mutateAsync({ invitationId: invitation.id });
                toast.success('Invitation withdrawn.');
              } catch (err) {
                toast.error(serverVerdict(err));
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
      toast.success(`Invitation sent to ${email.trim()}.`);
      setEmail('');
      setFullName('');
      setRoleKeys(['ops']);
      onOpenChange(false);
    } catch (err) {
      // Verbatim (FE-2): NO_ROLES, EMAIL_ALREADY_REGISTERED,
      // INVITATION_ALREADY_PENDING, OWNER_GRANT_REQUIRES_OWNER…
      setError(serverVerdict(err));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<UserPlus size={18} />}
      title="Invite a colleague"
      description="They get an email with a link to set up their login. It works for 7 days."
    >
      <form onSubmit={submit} className="rd-form">
        <TextField
          id="invite-name"
          label="Name"
          icon={<User size={15} />}
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <TextField
          id="invite-email"
          type="email"
          label="Email"
          icon={<Mail size={15} />}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <RolePicker
          legend="Roles"
          options={roles}
          value={roleKeys}
          onChange={setRoleKeys}
          disabled={invite.isPending}
          lockedKeys={mayGrantOwner ? [] : OWNER_ONLY}
          lockedNote="Only an owner of this store can invite another owner."
        />
        {error !== null ? (
          <RdCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
            <p>{error}</p>
          </RdCallout>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <AsyncButton
            type="submit"
            variant="primary"
            size="md"
            icon={<UserPlus size={15} />}
            labels={{ idle: 'Send invitation', busy: 'Sending…', error: 'Not sent' }}
            state={phaseOf(invite.isPending, error)}
            disabled={invite.isPending}
          />
        </DialogFooter>
      </form>
    </Dialog>
  );
}
