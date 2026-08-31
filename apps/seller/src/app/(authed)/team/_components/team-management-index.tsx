'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  LoadingState,
  PageHeader,
  Section,
  Select,
  Table,
  useToast,
} from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
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

// The hardcoded six are gone: roles are rows now, so the options come
// from the server and include anything created under Team → Roles.

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
    if (e instanceof ApiError) {
      const b = e.body as { code?: unknown; message?: unknown } | null;
      const code = typeof b?.code === 'string' ? b.code : null;
      const msg = typeof b?.message === 'string' ? b.message : e.message;
      return code ? `[${code}] ${msg}` : msg;
    }
    return e instanceof Error ? e.message : 'Action failed';
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Team"
        subtitle="Invite + manage your team. Owners and admins can change roles or remove members."
        action={
          canWrite ? (
            <Button variant="primary" size="md" onClick={() => setInviting(true)}>
              Invite member
            </Button>
          ) : null
        }
      />

      {revealed && (
        <InviteLinkRevealCard invitation={revealed} onDismiss={() => setRevealed(null)} />
      )}

      {error && (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px]">
          {error}
        </div>
      )}

      <Section title="Active members">
        <Card>
          {members.isLoading ? (
            <LoadingState label="Loading members…" />
          ) : members.isError ? (
            <ErrorState
              message={members.error?.message ?? 'Failed.'}
              retry={() => void members.refetch()}
            />
          ) : !members.data || members.data.length === 0 ? (
            <CardBody>
              <p className="text-text-muted text-sm">No members yet.</p>
            </CardBody>
          ) : (
            <Table wrapperClassName="rounded-none border-0 bg-transparent">
              <thead className="text-text-muted text-xs uppercase tracking-wide bg-surface-raised border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Name</th>
                  <th className="text-left px-3 py-2 font-medium">Email</th>
                  <th className="text-left px-3 py-2 font-medium">Role</th>
                  <th className="text-left px-3 py-2 font-medium">Last login</th>
                  <th className="text-left px-3 py-2 font-medium">Joined</th>
                  <th className="text-right px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.data.map((m) => (
                  <tr key={m.id} className={m.deletedAt ? 'opacity-50' : undefined}>
                    <td className="px-3 py-2 text-text-body text-xs">
                      {m.fullName}
                      {m.isYou && <span className="text-accent text-xs ml-2 uppercase">You</span>}
                      {m.deletedAt && (
                        <span className="text-critical text-xs ml-2 uppercase">Deactivated</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-text-muted font-mono text-xs">
                      {m.emailDisplay}
                    </td>
                    <td className="px-3 py-2">
                      <Select
                        value={m.roleId}
                        disabled={Boolean(m.deletedAt) || m.isYou || roles.data === undefined}
                        onChange={(e) => void onRoleChange(m.id, e.target.value)}
                        className="font-mono text-xs"
                        title={m.isYou ? 'You cannot change your own role.' : undefined}
                      >
                        {(roles.data ?? []).map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-3 py-2 text-text-muted font-mono text-xs">
                      {m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2 text-text-muted font-mono text-xs">
                      {new Date(m.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {m.deletedAt || m.isYou ? (
                        <span className="text-text-faint text-xs">—</span>
                      ) : pendingDelete === m.id ? (
                        <>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => void onDeactivate(m.id)}
                          >
                            Confirm
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => setPendingDelete(m.id)}>
                          Deactivate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </Section>

      <Section title="Pending invitations">
        <Card>
          <CardHeader title="Invitations" />
          {invitations.isLoading ? (
            <LoadingState label="Loading…" />
          ) : invitations.isError ? (
            <ErrorState
              message={invitations.error?.message ?? 'Failed.'}
              retry={() => void invitations.refetch()}
            />
          ) : !invitations.data || invitations.data.items.length === 0 ? (
            <CardBody>
              <p className="text-text-muted text-sm">No invitations yet.</p>
            </CardBody>
          ) : (
            <Table wrapperClassName="rounded-none border-0 bg-transparent">
              <thead className="text-text-muted text-xs uppercase tracking-wide bg-surface-raised border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Email</th>
                  <th className="text-left px-3 py-2 font-medium">Role</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-left px-3 py-2 font-medium">Expires</th>
                  <th className="text-right px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {invitations.data.items.map((inv) => {
                  const now = Date.now();
                  const isUsed = inv.usedAt !== null;
                  const isExpired = !isUsed && new Date(inv.expiresAt).getTime() < now;
                  const status = isUsed ? 'USED' : isExpired ? 'EXPIRED' : 'PENDING';
                  return (
                    <tr key={inv.id}>
                      <td className="px-3 py-2 text-text-body font-mono text-xs">{inv.email}</td>
                      <td className="px-3 py-2 text-text-body font-mono text-xs">{inv.role}</td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            isUsed
                              ? 'text-accent text-xs uppercase'
                              : isExpired
                                ? 'text-text-muted text-xs uppercase'
                                : 'text-pending text-xs uppercase'
                          }
                        >
                          {status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-text-muted font-mono text-xs">
                        {new Date(inv.expiresAt).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!isUsed && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => void onResend(inv.id)}>
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
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </Section>

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
