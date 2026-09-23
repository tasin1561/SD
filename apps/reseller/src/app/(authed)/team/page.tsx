'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { CircleAlert, Mail, ShieldCheck, Trash2, User, UserPlus, Undo2 } from 'lucide-react';
import { useStoreIdentity } from '@skydrop/auth/client';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { TBody, THead, Table, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Select } from '@skydrop/ui/app/select';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useChangeStoreMemberRole,
  useInviteStoreMember,
  useRemoveStoreMember,
  useRevokeStoreInvitation,
  useStoreTeam,
  type StoreMemberView,
  type StoreRoleKey,
} from '@/lib/store-hooks';
import { RdCallout, RdSection, phaseOf } from '../settings/_components/rd-parts';

function when(iso: string | null): string {
  return iso === null
    ? 'never'
    : new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * The store's team (RS-2): who has a login, what they may do, and who is
 * invited. Everyone with `team.view` sees it; the controls need
 * `team.manage` — hidden otherwise (cosmetic, FE-2: the API refuses).
 */
export default function TeamPage(): ReactElement {
  const me = useStoreIdentity();
  const team = useStoreTeam();
  const manage = can(me, 'team.manage');
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

      <RdSection title="Members">
        {members.length === 0 ? (
          <EmptyState title="No members yet" description="Invite a colleague to get started." />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
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
                  mayTouchOwners={me?.roleKey === 'owner'}
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
                <Th>Role</Th>
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
          mayGrantOwner={me?.roleKey === 'owner'}
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
  roles: ReadonlyArray<{ key: string; name: string }>;
  manage: boolean;
  mayTouchOwners: boolean;
  isYou: boolean;
}): ReactElement {
  const toast = useToast();
  const change = useChangeStoreMemberRole();
  const remove = useRemoveStoreMember();
  const [confirming, setConfirming] = useState(false);
  // The role picked in the select, waiting for its confirmation. The
  // select keeps showing the member's CURRENT role until the change lands.
  // Kept after the dialog closes so its words do not blank mid-exit.
  const [pendingRole, setPendingRole] = useState<StoreRoleKey | null>(null);
  const [roleOpen, setRoleOpen] = useState(false);
  const locked = member.isOwner && !mayTouchOwners;
  const pendingRoleName =
    pendingRole === null ? '' : (roles.find((r) => r.key === pendingRole)?.name ?? 'updated');

  return (
    <Tr>
      <Td>
        <span className="rd-cell-strong">{member.fullName}</span>
        {isYou ? <span className="rd-you"> (you)</span> : null}
      </Td>
      <Td>{member.email}</Td>
      <Td>
        {manage && !locked ? (
          <>
            <Select
              aria-label={`Role for ${member.fullName}`}
              className="rd-role-select"
              value={member.roleKey}
              disabled={change.isPending}
              onChange={(e) => {
                const next = e.target.value as StoreRoleKey;
                if (next === member.roleKey) return;
                setPendingRole(next);
                setRoleOpen(true);
              }}
            >
              {roles
                .filter((r) => r.key !== 'owner' || mayTouchOwners)
                .map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.name}
                  </option>
                ))}
            </Select>
            <ConfirmDialog
              open={roleOpen}
              onOpenChange={setRoleOpen}
              title={`Make ${member.fullName} ${pendingRoleName}?`}
              entity={`${member.fullName} · ${member.email}`}
              consequence={`Their role changes from ${member.roleName} to ${pendingRoleName} at once — what they can see and do in this store changes with it.`}
              confirmLabel="Change role"
              onConfirm={async () => {
                if (pendingRole === null) return;
                const roleKey = pendingRole;
                const name = pendingRoleName;
                try {
                  await change.mutateAsync({ memberId: member.id, roleKey });
                  toast.success(`${member.fullName} is now ${name}.`);
                } catch (err) {
                  toast.error(serverVerdict(err));
                }
                setRoleOpen(false);
              }}
            />
          </>
        ) : (
          member.roleName
        )}
      </Td>
      <Td className="rd-cell-muted">{when(member.lastLoginAt)}</Td>
      {manage || isYou ? (
        <Td align="right">
          {manage && !locked ? (
            <>
              <Button
                variant="destructive"
                size="sm"
                icon={<Trash2 size={14} />}
                onClick={() => setConfirming(true)}
              >
                Remove
              </Button>
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
            </>
          ) : null}
        </Td>
      ) : null}
    </Tr>
  );
}

function InvitationRow({
  invitation,
  manage,
}: {
  invitation: { id: string; fullName: string; email: string; roleName: string; expiresAt: string };
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
      <Td>{invitation.roleName}</Td>
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
  roles: ReadonlyArray<{ key: string; name: string; description: string | null }>;
  mayGrantOwner: boolean;
}): ReactElement {
  const toast = useToast();
  const invite = useInviteStoreMember();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [roleKey, setRoleKey] = useState<StoreRoleKey>('ops');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      await invite.mutateAsync({ email: email.trim(), fullName: fullName.trim(), roleKey });
      toast.success(`Invitation sent to ${email.trim()}.`);
      setEmail('');
      setFullName('');
      onOpenChange(false);
    } catch (err) {
      // Verbatim (FE-2): EMAIL_ALREADY_REGISTERED, INVITATION_ALREADY_PENDING…
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
        <Select
          id="invite-role"
          label="Role"
          icon={<ShieldCheck size={15} />}
          value={roleKey}
          onChange={(e) => setRoleKey(e.target.value as StoreRoleKey)}
        >
          {roles
            .filter((r) => r.key !== 'owner' || mayGrantOwner)
            .map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
                {r.description !== null ? ` — ${r.description}` : ''}
              </option>
            ))}
        </Select>
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
