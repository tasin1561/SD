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
  useToast,
} from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import type { CreatedStaffInvitation } from '@skydrop/api-client';
import {
  useDeactivateStaffUser,
  useResendStaffInvitation,
  useRevokeStaffInvitation,
  useStaffInvitationsList,
  useStaffUsersList,
  useUpdateStaffRole,
} from '@/lib/api-hooks';
import { InviteStaffModal } from './invite-staff-modal';
import { InviteLinkRevealCard } from './invite-link-reveal-card';

const ROLES = [
  'SUPER_ADMIN',
  'SELLER_APPROVAL_ADMIN',
  'CALL_AGENT',
  'WAREHOUSE_STAFF',
  'WAREHOUSE_SUPERVISOR',
  'MANUAL_PLACEMENT_ADMIN',
  'FINANCE',
] as const;

export function StaffManagementIndex(): ReactElement {
  const users = useStaffUsersList();
  const invitations = useStaffInvitationsList();
  const updateRole = useUpdateStaffRole();
  const deactivate = useDeactivateStaffUser();
  const resend = useResendStaffInvitation();
  const revoke = useRevokeStaffInvitation();
  const toast = useToast();

  const [inviting, setInviting] = useState(false);
  const [revealed, setRevealed] = useState<CreatedStaffInvitation | null>(null);
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

  async function onRoleChange(id: string, role: string): Promise<void> {
    setError(null);
    try {
      await updateRole.mutateAsync({ id, role });
      toast.success(`Role updated to ${role}.`);
    } catch (e) {
      setError(fmtError(e));
    }
  }

  async function onDeactivate(id: string): Promise<void> {
    setError(null);
    try {
      await deactivate.mutateAsync({ id });
      toast.success('Staff member deactivated.');
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
    <div className="max-w-6xl space-y-4">
      <PageHeader
        title="Staff"
        subtitle="Invite + manage admin / operational users. SUPER_ADMIN only."
        action={
          <Button variant="primary" size="md" onClick={() => setInviting(true)}>
            Invite staff
          </Button>
        }
      />

      {revealed && (
        <InviteLinkRevealCard
          invitation={revealed}
          onDismiss={() => setRevealed(null)}
        />
      )}

      {error && (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px]">
          {error}
        </div>
      )}

      <Section title="Active staff">
        <Card>
          {users.isLoading ? (
            <LoadingState label="Loading staff…" />
          ) : users.isError ? (
            <ErrorState
              message={users.error?.message ?? 'Failed.'}
              retry={() => void users.refetch()}
            />
          ) : !users.data || users.data.length === 0 ? (
            <CardBody>
              <p className="text-text-muted text-sm">No staff yet.</p>
            </CardBody>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-text-muted text-[11px] uppercase tracking-wide bg-surface-raised border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Email</th>
                  <th className="text-left px-3 py-2 font-medium">Role</th>
                  <th className="text-left px-3 py-2 font-medium">Last login</th>
                  <th className="text-left px-3 py-2 font-medium">Created</th>
                  <th className="text-right px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.data.map((u) => (
                  <tr
                    key={u.id}
                    className={u.deletedAt ? 'opacity-50' : undefined}
                  >
                    <td className="px-3 py-2 text-text-body font-mono text-xs">
                      {u.emailDisplay}
                      {u.deletedAt && (
                        <span className="text-critical text-[10px] ml-2 uppercase">
                          Deactivated
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={u.role}
                        disabled={Boolean(u.deletedAt)}
                        onChange={(e) => void onRoleChange(u.id, e.target.value)}
                        className="px-2 py-1 rounded-[4px] bg-bg border border-border text-text-body text-xs font-mono"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-text-muted font-mono text-xs">
                      {u.lastLoginAt
                        ? new Date(u.lastLoginAt).toLocaleString()
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-text-muted font-mono text-xs">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {u.deletedAt ? (
                        <span className="text-text-faint text-xs">—</span>
                      ) : pendingDelete === u.id ? (
                        <>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => void onDeactivate(u.id)}
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
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPendingDelete(u.id)}
                        >
                          Deactivate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
            <table className="w-full text-sm">
              <thead className="text-text-muted text-[11px] uppercase tracking-wide bg-surface-raised border-b border-border">
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
                  const isExpired =
                    !isUsed && new Date(inv.expiresAt).getTime() < now;
                  const status = isUsed
                    ? 'USED'
                    : isExpired
                      ? 'EXPIRED'
                      : 'PENDING';
                  return (
                    <tr key={inv.id}>
                      <td className="px-3 py-2 text-text-body font-mono text-xs">
                        {inv.email}
                      </td>
                      <td className="px-3 py-2 text-text-body font-mono text-xs">
                        {inv.role}
                      </td>
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
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </Section>

      {inviting && (
        <InviteStaffModal
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
