'use client';

import { useState, type ReactElement } from 'react';
import {
  CircleAlert,
  MailPlus,
  RefreshCw,
  ShieldCheck,
  User,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Table, TBody, THead, Td, Th, Tr, TableEmpty } from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import type { CreatedTeamInvitation, TeamMemberRow } from '@skydrop/api-client';
import {
  useDeactivateTeamMember,
  useResendTeamInvitation,
  useRevokeTeamInvitation,
  useTeamInvitationsList,
  useTeamMembersList,
  useUpdateTeamMemberRole,
} from '@/lib/api-hooks';
import { InviteMemberModal } from './invite-member-modal';
import { InviteLinkRevealCard } from './invite-link-reveal-card';
import { useRoles } from '@/lib/rbac-hooks';
import { can } from '@/lib/page-access';
import { useSellerIdentity } from '@skydrop/auth/client';
import { serverVerdict } from '@/lib/server-verdict';
import { SetCallout, SetFact, SetPageHeader } from '../../settings/_components/settings-parts';
import './team.css';

// The hardcoded six are gone: roles are rows now, so the options come
// from the server and include anything created under Team → Roles.

const CRUMBS = [{ label: 'Seller console' }, { label: 'Account' }, { label: 'Team' }];

/** PENDING / USED / EXPIRED, decided once and read in two places. */
type InviteState = 'PENDING' | 'USED' | 'EXPIRED';

function inviteState(inv: {
  readonly usedAt: string | null;
  readonly expiresAt: string;
}): InviteState {
  if (inv.usedAt !== null) return 'USED';
  return new Date(inv.expiresAt).getTime() < Date.now() ? 'EXPIRED' : 'PENDING';
}

function inviteKind(state: InviteState): 'delivered' | 'pending' | 'cancelled' {
  switch (state) {
    case 'USED':
      return 'delivered';
    case 'PENDING':
      return 'pending';
    case 'EXPIRED':
      return 'cancelled';
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

export function TeamManagementIndex(): ReactElement {
  const canWrite = can(useSellerIdentity(), 'team.manage');
  const roles = useRoles();
  const members = useTeamMembersList();
  const invitations = useTeamInvitationsList();
  const updateRole = useUpdateTeamMemberRole();
  const deactivate = useDeactivateTeamMember();
  const resend = useResendTeamInvitation();
  const revoke = useRevokeTeamInvitation();
  const toast = useToast();

  const [inviting, setInviting] = useState(false);
  const [revealed, setRevealed] = useState<CreatedTeamInvitation | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TeamMemberRow | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<{
    readonly id: string;
    readonly email: string;
    readonly role: string;
  } | null>(null);
  // A role change waits here until it is confirmed; the select keeps
  // showing the member's current role until then.
  const [pendingRole, setPendingRole] = useState<{
    readonly member: TeamMemberRow;
    readonly roleId: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function fmtError(e: unknown): string {
    return serverVerdict(e, 'Action failed');
  }

  async function onRoleChange(id: string, roleId: string): Promise<void> {
    setError(null);
    try {
      const result = await updateRole.mutateAsync({ id, roleId });
      toast.success(`Role updated to ${result.roleName}.`);
    } catch (e) {
      setError(fmtError(e));
    }
  }

  async function onDeactivate(id: string): Promise<void> {
    setError(null);
    try {
      await deactivate.mutateAsync({ id });
      toast.success('Team member deactivated.');
      setPendingDelete(null);
    } catch (e) {
      setError(fmtError(e));
    }
  }

  async function onResend(id: string): Promise<void> {
    setError(null);
    try {
      const reveal = await resend.mutateAsync({ id });
      setRevealed(reveal);
      toast.success('Invitation re-issued — copy the new link below.');
    } catch (e) {
      setError(fmtError(e));
      // Rethrown so the Resend button shows the failure on itself.
      throw e;
    }
  }

  async function onRevoke(id: string): Promise<void> {
    setError(null);
    try {
      await revoke.mutateAsync({ id });
      toast.success('Invitation revoked.');
      setPendingRevoke(null);
    } catch (e) {
      setError(fmtError(e));
    }
  }

  const memberRows = members.data ?? [];
  const activeMembers = memberRows.filter((m) => m.deletedAt === null);
  const inviteRows = invitations.data?.items ?? [];
  const openInvites = inviteRows.filter((inv) => inviteState(inv) === 'PENDING');

  const pendingRoleName =
    pendingRole === null
      ? ''
      : ((roles.data ?? []).find((r) => r.id === pendingRole.roleId)?.name ?? '');

  return (
    <div className="set-page">
      <SetPageHeader
        crumbs={CRUMBS}
        title="Team"
        subtitle="Invite + manage your team. Owners and admins can change roles or remove members."
        meta={
          members.data === undefined ? undefined : (
            <span className="set-meta">
              <SetFact tone="accent">
                {activeMembers.length} active {activeMembers.length === 1 ? 'member' : 'members'}
              </SetFact>
              {openInvites.length > 0 && (
                <SetFact tone="warn" dot>
                  {openInvites.length} invitation{openInvites.length === 1 ? '' : 's'} outstanding
                </SetFact>
              )}
            </span>
          )
        }
        action={
          canWrite ? (
            <Button
              variant="primary"
              size="md"
              icon={<UserPlus size={15} />}
              onClick={() => setInviting(true)}
            >
              Invite member
            </Button>
          ) : null
        }
      />

      {/* ── The team at a glance ─────────────────────────────────────
             Three standing facts, all read off the two lists below.
             The comps put a last-active column and a per-person action
             count here; neither is stored — `lastLoginAt` is the whole
             activity record, and it is in the list where the person it
             belongs to is. */}
      <div className="set-kpis">
        {members.data === undefined ? (
          <KpiCard
            label="Active members"
            icon={<Users size={14} />}
            figure="—"
            tone="neutral"
            hint="Nobody deactivated."
          />
        ) : (
          <KpiCard
            label="Active members"
            icon={<Users size={14} />}
            value={activeMembers.length}
            format={String}
            unit={activeMembers.length === 1 ? 'person' : 'people'}
            tone="neutral"
            hint={
              memberRows.length === activeMembers.length
                ? 'Nobody deactivated.'
                : `${memberRows.length - activeMembers.length} deactivated.`
            }
          />
        )}
        {invitations.data === undefined ? (
          <KpiCard
            label="Invitations outstanding"
            icon={<MailPlus size={14} />}
            figure="—"
            tone="neutral"
            hint="Sent, not yet accepted, not yet expired."
          />
        ) : (
          <KpiCard
            label="Invitations outstanding"
            icon={<MailPlus size={14} />}
            value={openInvites.length}
            format={String}
            unit={openInvites.length === 1 ? 'invite' : 'invites'}
            tone={openInvites.length > 0 ? 'pending' : 'neutral'}
            hint="Sent, not yet accepted, not yet expired."
          />
        )}
        {roles.data === undefined ? (
          <KpiCard
            label="Roles defined"
            icon={<ShieldCheck size={14} />}
            figure="—"
            tone="neutral"
            hint="Edit what each one covers under Roles."
          />
        ) : (
          <KpiCard
            label="Roles defined"
            icon={<ShieldCheck size={14} />}
            value={roles.data.length}
            format={String}
            unit={roles.data.length === 1 ? 'role' : 'roles'}
            tone="neutral"
            hint="Edit what each one covers under Roles."
          />
        )}
      </div>

      {revealed && (
        <InviteLinkRevealCard invitation={revealed} onDismiss={() => setRevealed(null)} />
      )}

      {error && (
        <SetCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
          <p>{error}</p>
        </SetCallout>
      )}

      <section className="set-section">
        <SectionHeading
          title="Members"
          note={
            members.data === undefined
              ? undefined
              : `${memberRows.length} ${memberRows.length === 1 ? 'person' : 'people'}`
          }
        />
        <div className="set-card" data-flush>
          {members.isLoading ? (
            <SkeletonRows rows={3} cols={3} label="Loading members…" />
          ) : members.isError ? (
            <ErrorState
              message={members.error?.message ?? 'Failed.'}
              retry={() => void members.refetch()}
            />
          ) : memberRows.length === 0 ? (
            <EmptyState bare title="No members yet." />
          ) : (
            <ul className="team-members" aria-label="Team members">
              {memberRows.map((m) => {
                const locked = m.deletedAt !== null || m.isYou;
                return (
                  <li
                    key={m.id}
                    className="team-member"
                    data-dead={m.deletedAt !== null ? '1' : undefined}
                  >
                    <span className="team-member__avatar" aria-hidden>
                      <User size={16} />
                    </span>
                    <div className="team-member__text">
                      <div className="team-member__name">
                        <span>{m.fullName}</span>
                        {m.isYou && <StatusChip kind="confirmed" label="You" size="sm" />}
                        {m.deletedAt !== null && (
                          <StatusChip kind="cancelled" label="Deactivated" size="sm" />
                        )}
                      </div>
                      <span className="team-member__email sk-ident">{m.emailDisplay}</span>
                      <span className="team-member__times">
                        <span>
                          Last login{' '}
                          <span className="sk-figure">
                            {m.lastLoginAt !== null
                              ? new Date(m.lastLoginAt).toLocaleString()
                              : '—'}
                          </span>
                        </span>
                        <span>
                          Joined{' '}
                          <span className="sk-figure">
                            {new Date(m.createdAt).toLocaleDateString()}
                          </span>
                        </span>
                      </span>
                    </div>
                    <div className="team-member__side">
                      {locked ? (
                        // Nobody may change their own role, and a
                        // deactivated member has none to change: a chip
                        // says what it is without a control that refuses.
                        <span title={m.isYou ? 'You cannot change your own role.' : undefined}>
                          <StatusChip kind="neutral" label={m.roleName} />
                        </span>
                      ) : (
                        <Select
                          className="team-member__role"
                          icon={<ShieldCheck size={15} />}
                          value={m.roleId}
                          aria-label={`Role for ${m.fullName}`}
                          disabled={roles.data === undefined}
                          onChange={(e) => {
                            setError(null);
                            if (e.target.value !== m.roleId)
                              setPendingRole({ member: m, roleId: e.target.value });
                          }}
                        >
                          {(roles.data ?? []).map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </Select>
                      )}
                      {locked ? null : (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<UserMinus size={14} />}
                          onClick={() => setPendingDelete(m)}
                        >
                          Deactivate
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="set-section">
        <SectionHeading
          title="Invitations"
          note={
            invitations.data === undefined
              ? undefined
              : `${openInvites.length} outstanding of ${inviteRows.length}`
          }
        />
        <div className="set-card" data-flush>
          {invitations.isLoading ? (
            <SkeletonRows rows={3} cols={5} label="Loading…" />
          ) : invitations.isError ? (
            <ErrorState
              message={invitations.error?.message ?? 'Failed.'}
              retry={() => void invitations.refetch()}
            />
          ) : (
            <Table caption="Invitations">
              <THead>
                <Tr>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>State</Th>
                  <Th>Expires</Th>
                  <Th align="right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {inviteRows.length === 0 ? (
                  <TableEmpty colSpan={5}>No invitations yet.</TableEmpty>
                ) : (
                  inviteRows.map((inv) => {
                    const state = inviteState(inv);
                    return (
                      <Tr key={inv.id}>
                        <Td>
                          <span className="sk-ident">{inv.email}</span>
                        </Td>
                        <Td>
                          <StatusChip kind="neutral" label={inv.role} size="sm" />
                        </Td>
                        <Td>
                          <StatusChip
                            kind={inviteKind(state)}
                            label={state.charAt(0) + state.slice(1).toLowerCase()}
                            size="sm"
                          />
                        </Td>
                        <Td className="set-cell-muted">
                          {new Date(inv.expiresAt).toLocaleDateString()}
                        </Td>
                        <Td align="right">
                          {state !== 'USED' && (
                            <div className="set-row-actions">
                              <AsyncButton
                                variant="ghost"
                                size="sm"
                                icon={<RefreshCw size={13} />}
                                labels={{
                                  idle: 'Resend',
                                  busy: 'Resending…',
                                  done: 'Resent',
                                  error: 'Not resent',
                                }}
                                aria-label={`Resend invitation to ${inv.email}`}
                                onAction={() => onResend(inv.id)}
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setPendingRevoke({ id: inv.id, email: inv.email, role: inv.role })
                                }
                              >
                                Revoke
                              </Button>
                            </div>
                          )}
                        </Td>
                      </Tr>
                    );
                  })
                )}
              </TBody>
            </Table>
          )}
        </div>
      </section>

      {inviting && (
        <InviteMemberModal
          onClose={() => setInviting(false)}
          onSuccess={(reveal) => {
            setInviting(false);
            setRevealed(reveal);
            toast.success('Invitation created — share the link below.');
          }}
        />
      )}

      <ConfirmDialog
        open={pendingRole !== null}
        onOpenChange={(next) => {
          if (!next) setPendingRole(null);
        }}
        title="Change this person's role?"
        entity={
          pendingRole === null
            ? ''
            : `${pendingRole.member.fullName} · ${pendingRole.member.emailDisplay}`
        }
        consequence={
          pendingRole === null
            ? ''
            : `${pendingRole.member.fullName} moves from ${pendingRole.member.roleName} to ${pendingRoleName}. What they can see and change follows the new role.`
        }
        confirmLabel="Change role"
        onConfirm={async () => {
          if (pendingRole === null) return;
          await onRoleChange(pendingRole.member.id, pendingRole.roleId);
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        title="Deactivate this team member?"
        entity={
          pendingDelete === null ? '' : `${pendingDelete.fullName} · ${pendingDelete.emailDisplay}`
        }
        consequence="They lose access to this company's console."
        confirmLabel="Deactivate"
        destructive
        onConfirm={() => (pendingDelete === null ? undefined : onDeactivate(pendingDelete.id))}
      />

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(next) => {
          if (!next) setPendingRevoke(null);
        }}
        title="Revoke this invitation?"
        entity={pendingRevoke === null ? '' : `${pendingRevoke.email} · ${pendingRevoke.role}`}
        consequence="The invitation link stops working."
        confirmLabel="Revoke invitation"
        destructive
        onConfirm={() => (pendingRevoke === null ? undefined : onRevoke(pendingRevoke.id))}
      />
    </div>
  );
}
