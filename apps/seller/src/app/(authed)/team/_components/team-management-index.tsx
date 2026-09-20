'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { MailPlus, UserPlus, Users } from 'lucide-react';
import {
  BandBody,
  Button,
  Crumbs,
  ErrorState,
  LoadingState,
  MetaChip,
  PageHeader,
  SectionBand,
  Select,
  Stat,
  StatusBadge,
  TBody,
  THead,
  Table,
  TableEmpty,
  Td,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import type { CreatedTeamInvitation } from '@skydrop/api-client';
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
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);
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

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={<Crumbs items={CRUMBS} Link={Link} />}
        title="Team"
        subtitle="Invite + manage your team. Owners and admins can change roles or remove members."
        meta={
          members.data === undefined ? undefined : (
            <>
              <MetaChip tone="accent">
                {activeMembers.length} active {activeMembers.length === 1 ? 'member' : 'members'}
              </MetaChip>
              {openInvites.length > 0 && (
                <MetaChip tone="warn" dot>
                  {openInvites.length} invitation{openInvites.length === 1 ? '' : 's'} outstanding
                </MetaChip>
              )}
            </>
          )
        }
        action={
          canWrite ? (
            <Button variant="primary" size="md" onClick={() => setInviting(true)}>
              <UserPlus size={14} aria-hidden /> Invite member
            </Button>
          ) : null
        }
      />

      {/* ── The team at a glance ─────────────────────────────────────
             Three standing facts, all read off the two registers below.
             The comps put a last-active column and a per-person action
             count here; neither is stored — `lastLoginAt` is the whole
             activity record, and it is in the register where the person
             it belongs to is. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Active members"
          icon={<Users size={13} aria-hidden />}
          value={members.data === undefined ? '—' : activeMembers.length}
          unit={activeMembers.length === 1 ? 'person' : 'people'}
          tone="neutral"
          hint={
            memberRows.length === activeMembers.length
              ? 'Nobody deactivated.'
              : `${memberRows.length - activeMembers.length} deactivated.`
          }
        />
        <Stat
          label="Invitations outstanding"
          icon={<MailPlus size={13} aria-hidden />}
          value={invitations.data === undefined ? '—' : openInvites.length}
          unit={openInvites.length === 1 ? 'invite' : 'invites'}
          tone={openInvites.length > 0 ? 'warn' : 'neutral'}
          hint="Sent, not yet accepted, not yet expired."
        />
        <Stat
          label="Roles defined"
          icon={<Users size={13} aria-hidden />}
          value={roles.data === undefined ? '—' : roles.data.length}
          unit={roles.data?.length === 1 ? 'role' : 'roles'}
          tone="neutral"
          hint="Edit what each one covers under Roles."
        />
      </div>

      {revealed && (
        <InviteLinkRevealCard invitation={revealed} onDismiss={() => setRevealed(null)} />
      )}

      {error && (
        <div className="text-critical border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] rounded-[var(--radius-2)] border px-3 py-2 text-xs">
          {error}
        </div>
      )}

      <div>
        <SectionBand
          index="01"
          title="Member register"
          note={
            members.data === undefined
              ? undefined
              : `${memberRows.length} ${memberRows.length === 1 ? 'person' : 'people'}`
          }
        />
        <BandBody flush>
          {members.isLoading ? (
            <div className="p-3">
              <LoadingState label="Loading members…" />
            </div>
          ) : members.isError ? (
            <div className="p-3">
              <ErrorState
                message={members.error?.message ?? 'Failed.'}
                retry={() => void members.refetch()}
              />
            </div>
          ) : (
            <Table wrapperClassName="rounded-none border-0 bg-transparent">
              <THead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Last login</Th>
                  <Th>Joined</Th>
                  <Th align="right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {memberRows.length === 0 ? (
                  <TableEmpty colSpan={6}>No members yet.</TableEmpty>
                ) : (
                  memberRows.map((m) => (
                    <Tr key={m.id} className={m.deletedAt !== null ? 'opacity-60' : undefined}>
                      <Td>
                        <span className="text-text-bright">{m.fullName}</span>
                        {m.isYou && (
                          <span className="text-accent ml-2 font-mono text-[11px] tracking-[0.08em] uppercase">
                            You
                          </span>
                        )}
                        {m.deletedAt !== null && (
                          <span className="text-critical ml-2 font-mono text-[11px] tracking-[0.08em] uppercase">
                            Deactivated
                          </span>
                        )}
                      </Td>
                      <Td className="text-text-muted font-mono text-xs">{m.emailDisplay}</Td>
                      <Td>
                        <Select
                          value={m.roleId}
                          aria-label={`Role for ${m.fullName}`}
                          disabled={m.deletedAt !== null || m.isYou || roles.data === undefined}
                          onChange={(e) => void onRoleChange(m.id, e.target.value)}
                          className="text-xs"
                          title={m.isYou ? 'You cannot change your own role.' : undefined}
                        >
                          {(roles.data ?? []).map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </Select>
                      </Td>
                      <Td className="text-text-muted font-mono text-xs">
                        {m.lastLoginAt !== null ? new Date(m.lastLoginAt).toLocaleString() : '—'}
                      </Td>
                      <Td className="text-text-muted font-mono text-xs">
                        {new Date(m.createdAt).toLocaleDateString()}
                      </Td>
                      <Td align="right">
                        {m.deletedAt !== null || m.isYou ? (
                          <span className="text-text-faint text-xs">—</span>
                        ) : pendingDelete === m.id ? (
                          <div className="flex justify-end gap-1.5">
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => void onDeactivate(m.id)}
                            >
                              Confirm
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setPendingDelete(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => setPendingDelete(m.id)}>
                            Deactivate
                          </Button>
                        )}
                      </Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          )}
        </BandBody>
      </div>

      <div>
        <SectionBand
          index="02"
          title="Invitations"
          note={
            invitations.data === undefined
              ? undefined
              : `${openInvites.length} outstanding of ${inviteRows.length}`
          }
        />
        <BandBody flush>
          {invitations.isLoading ? (
            <div className="p-3">
              <LoadingState label="Loading…" />
            </div>
          ) : invitations.isError ? (
            <div className="p-3">
              <ErrorState
                message={invitations.error?.message ?? 'Failed.'}
                retry={() => void invitations.refetch()}
              />
            </div>
          ) : (
            <Table wrapperClassName="rounded-none border-0 bg-transparent">
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
                        <Td className="text-text-body font-mono text-xs">{inv.email}</Td>
                        <Td className="text-text-body font-mono text-xs">{inv.role}</Td>
                        <Td>
                          <StatusBadge
                            kind={inviteKind(state)}
                            label={state.charAt(0) + state.slice(1).toLowerCase()}
                          />
                        </Td>
                        <Td className="text-text-muted font-mono text-xs">
                          {new Date(inv.expiresAt).toLocaleDateString()}
                        </Td>
                        <Td align="right">
                          {state !== 'USED' && (
                            <div className="flex justify-end gap-1.5">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void onResend(inv.id)}
                              >
                                Resend
                              </Button>
                              {pendingRevoke === inv.id ? (
                                <>
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => void onRevoke(inv.id)}
                                  >
                                    Confirm
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setPendingRevoke(null)}
                                  >
                                    Cancel
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setPendingRevoke(inv.id)}
                                >
                                  Revoke
                                </Button>
                              )}
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
        </BandBody>
      </div>

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
    </div>
  );
}
