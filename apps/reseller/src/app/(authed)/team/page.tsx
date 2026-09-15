'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { useStoreIdentity } from '@skydrop/auth/client';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  PageHeader,
  Section,
  Select,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
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
      <div className="space-y-6">
        <PageHeader title="Team" subtitle="Everybody with a login for this store." />
        {team.isPending ? (
          <LoadingState label="Loading the team" rows={4} />
        ) : (
          <ErrorState message={serverVerdict(team.error)} retry={() => void team.refetch()} />
        )}
      </div>
    );
  }
  const { members, invitations, roles } = team.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        subtitle="Everybody with a login for this store."
        action={
          manage ? (
            <Button variant="primary" size="md" onClick={() => setInviting(true)}>
              Invite a colleague
            </Button>
          ) : undefined
        }
      />

      <Section title="Members">
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
                {manage ? <Th>Actions</Th> : null}
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
      </Section>

      <Section title="Pending invitations">
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
                {manage ? <Th>Actions</Th> : null}
              </Tr>
            </THead>
            <TBody>
              {invitations.map((i) => (
                <InvitationRow key={i.id} invitation={i} manage={manage} />
              ))}
            </TBody>
          </Table>
        )}
      </Section>

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
  const locked = member.isOwner && !mayTouchOwners;

  return (
    <Tr>
      <Td>
        {member.fullName}
        {isYou ? <span className="text-text-muted"> (you)</span> : null}
      </Td>
      <Td>{member.email}</Td>
      <Td>
        {manage && !locked ? (
          <Select
            aria-label={`Role for ${member.fullName}`}
            value={member.roleKey}
            disabled={change.isPending}
            onChange={(e) =>
              change.mutate(
                { memberId: member.id, roleKey: e.target.value as StoreRoleKey },
                {
                  onSuccess: () =>
                    toast.success(
                      `${member.fullName} is now ${e.target.selectedOptions[0]?.text ?? 'updated'}.`,
                    ),
                  onError: (err) => toast.error(serverVerdict(err)),
                },
              )
            }
          >
            {roles
              .filter((r) => r.key !== 'owner' || mayTouchOwners)
              .map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
          </Select>
        ) : (
          member.roleName
        )}
      </Td>
      <Td>{when(member.lastLoginAt)}</Td>
      {manage || isYou ? (
        <Td>
          {manage && !locked ? (
            <>
              <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
                Remove
              </Button>
              <ConfirmDialog
                open={confirming}
                onOpenChange={setConfirming}
                title={`Remove ${member.fullName}?`}
                description="Their access ends now, including any session they have open."
                confirmLabel="Remove access"
                confirmVariant="destructive"
                disabled={remove.isPending}
                onConfirm={async () => {
                  try {
                    await remove.mutateAsync({ memberId: member.id });
                    toast.success(`${member.fullName} no longer has access.`);
                    setConfirming(false);
                  } catch (err) {
                    toast.error(serverVerdict(err));
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
      <Td>{invitation.fullName}</Td>
      <Td>{invitation.email}</Td>
      <Td>{invitation.roleName}</Td>
      <Td>{when(invitation.expiresAt)}</Td>
      {manage ? (
        <Td>
          <Button
            variant="secondary"
            size="sm"
            disabled={revoke.isPending}
            onClick={() => setConfirming(true)}
          >
            Withdraw
          </Button>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={`Withdraw the invitation to ${invitation.fullName}?`}
            description={`The link sent to ${invitation.email} stops working. You can invite them again later.`}
            confirmLabel="Withdraw invitation"
            confirmVariant="destructive"
            disabled={revoke.isPending}
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
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Invite a colleague"
      description="They get an email with a link to set up their login. It works for 7 days."
    >
      <form onSubmit={submit} className="space-y-4">
        <FormField label="Name" htmlFor="invite-name" required>
          <Input
            id="invite-name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </FormField>
        <FormField label="Email" htmlFor="invite-email" required>
          <Input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>
        <FormField label="Role" htmlFor="invite-role">
          <Select
            id="invite-role"
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
        </FormField>
        {error !== null ? (
          <p role="alert" className="text-critical text-sm">
            {error}
          </p>
        ) : null}
        <ModalFooter>
          <Button type="button" variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={invite.isPending}>
            {invite.isPending ? 'Sending…' : 'Send invitation'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
