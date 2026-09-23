'use client';

import { useState, type ReactElement } from 'react';
import { RotateCw, UserMinus, UserPlus, XCircle } from 'lucide-react';
import { useToast } from '@skydrop/ui/app/toast';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TBody, THead, Table, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import type { CreatedStaffInvitation, StaffUserRow } from '@skydrop/api-client';
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
import { useRoles } from '@/lib/rbac-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { AcAlert, AcHeader, AcPage, AcSection } from '../../settings/_components/ac-parts';

// The hardcoded seven are gone: roles are rows now, so the options come
// from the server and include anything created under Roles.

export function StaffManagementIndex(): ReactElement {
  const canWrite = usePermission('staff.manage');
  const users = useStaffUsersList();
  const roles = useRoles();
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
  // A role change waits here until it is confirmed: the select no longer
  // fires the PATCH on its own, so a slip of the wheel changes nothing.
  const [pendingRole, setPendingRole] = useState<{
    readonly user: StaffUserRow;
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

  async function onDeactivate(id: string): Promise<boolean> {
    setError(null);
    try {
      await deactivate.mutateAsync({ id });
      toast.success('Staff member deactivated.');
      setPendingDelete(null);
      return true;
    } catch (e) {
      setError(fmtError(e));
      return false;
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

  async function onRevoke(id: string): Promise<boolean> {
    setError(null);
    try {
      await revoke.mutateAsync({ id });
      toast.success('Invitation revoked.');
      setPendingRevoke(null);
      return true;
    } catch (e) {
      setError(fmtError(e));
      return false;
    }
  }

  const deleteUser = users.data?.find((u) => u.id === pendingDelete) ?? null;
  const revokeInvite = invitations.data?.items.find((i) => i.id === pendingRevoke) ?? null;
  const roleName = (id: string): string => roles.data?.find((r) => r.id === id)?.name ?? id;

  return (
    <AcPage>
      <AcHeader
        title="Staff"
        subtitle="Invite + manage admin / operational users. SUPER_ADMIN only."
        action={
          canWrite ? (
            <Button
              variant="primary"
              size="md"
              icon={<UserPlus size={15} />}
              onClick={() => setInviting(true)}
            >
              Invite staff
            </Button>
          ) : null
        }
      />

      {revealed && (
        <InviteLinkRevealCard invitation={revealed} onDismiss={() => setRevealed(null)} />
      )}

      {error && <AcAlert message={error} />}

      <AcSection title="Active staff" flush>
        {users.isLoading ? (
          <SkeletonRows rows={4} cols={5} label="Loading staff…" />
        ) : users.isError ? (
          <ErrorState
            message={users.error?.message ?? 'Failed.'}
            retry={() => void users.refetch()}
          />
        ) : !users.data || users.data.length === 0 ? (
          <EmptyState bare title="No staff yet." />
        ) : (
          <Table caption="Active staff">
            <THead>
              <Tr>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Last login</Th>
                <Th>Created</Th>
                <Th align="right">Actions</Th>
              </Tr>
            </THead>
            <TBody>
              {users.data.map((u) => (
                <Tr key={u.id} className={u.deletedAt ? 'ac-row-off' : undefined}>
                  <Td>
                    <span className="ac-inline">
                      <span className="ac-cell-main">{u.emailDisplay}</span>
                      {u.deletedAt && <StatusChip kind="cancelled" label="Deactivated" size="sm" />}
                    </span>
                  </Td>
                  <Td>
                    <Select
                      aria-label={`Role for ${u.emailDisplay}`}
                      value={u.roleId}
                      disabled={Boolean(u.deletedAt) || roles.data === undefined || !canWrite}
                      onChange={(e) => {
                        if (e.target.value === u.roleId) return;
                        setError(null);
                        setPendingRole({ user: u, roleId: e.target.value });
                      }}
                    >
                      {(roles.data ?? []).map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    <span className="sk-figure ac-faint">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}
                    </span>
                  </Td>
                  <Td>
                    <span className="sk-figure ac-faint">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </span>
                  </Td>
                  <Td align="right">
                    {u.deletedAt ? (
                      <span className="ac-faint">—</span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<UserMinus size={14} />}
                        onClick={() => {
                          setError(null);
                          setPendingDelete(u.id);
                        }}
                      >
                        Deactivate
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </AcSection>

      <AcSection title="Pending invitations" flush>
        {invitations.isLoading ? (
          <SkeletonRows rows={3} cols={5} label="Loading…" />
        ) : invitations.isError ? (
          <ErrorState
            message={invitations.error?.message ?? 'Failed.'}
            retry={() => void invitations.refetch()}
          />
        ) : !invitations.data || invitations.data.items.length === 0 ? (
          <EmptyState bare title="No invitations yet." />
        ) : (
          <Table caption="Invitations">
            <THead>
              <Tr>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Expires</Th>
                <Th align="right">Actions</Th>
              </Tr>
            </THead>
            <TBody>
              {invitations.data.items.map((inv) => {
                const now = Date.now();
                const isUsed = inv.usedAt !== null;
                const isExpired = !isUsed && new Date(inv.expiresAt).getTime() < now;
                const status = isUsed ? 'USED' : isExpired ? 'EXPIRED' : 'PENDING';
                return (
                  <Tr key={inv.id}>
                    <Td>
                      <span className="ac-cell-main">{inv.email}</span>
                    </Td>
                    <Td>
                      <span className="ac-code">{inv.role}</span>
                    </Td>
                    <Td>
                      <StatusChip
                        kind={isUsed ? 'delivered' : isExpired ? 'cancelled' : 'pending'}
                        label={status}
                        size="sm"
                      />
                    </Td>
                    <Td>
                      <span className="sk-figure ac-faint">
                        {new Date(inv.expiresAt).toLocaleDateString()}
                      </span>
                    </Td>
                    <Td align="right">
                      {!isUsed && (
                        <div className="ac-buttons">
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<RotateCw size={14} />}
                            onClick={() => void onResend(inv.id)}
                          >
                            Resend
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<XCircle size={14} />}
                            onClick={() => {
                              setError(null);
                              setPendingRevoke(inv.id);
                            }}
                          >
                            Revoke
                          </Button>
                        </div>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </AcSection>

      <ConfirmDialog
        open={pendingRole !== null}
        onOpenChange={(o) => {
          if (!o) setPendingRole(null);
        }}
        title="Change this person's role?"
        entity={pendingRole?.user.emailDisplay ?? ''}
        consequence={
          pendingRole === null
            ? ''
            : `Their role changes from ${pendingRole.user.roleName} to ${roleName(pendingRole.roleId)}, and what they can see and do changes with it.`
        }
        confirmLabel="Change role"
        onConfirm={async () => {
          if (pendingRole === null) return;
          await onRoleChange(pendingRole.user.id, pendingRole.roleId);
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
        title="Deactivate this staff member?"
        entity={deleteUser?.emailDisplay ?? ''}
        consequence="Their account is deactivated and they can no longer sign in to the console."
        confirmLabel="Deactivate"
        destructive
        error={error}
        onConfirm={async () => {
          if (pendingDelete === null) return;
          const ok = await onDeactivate(pendingDelete);
          if (!ok) throw new Error('not deactivated');
        }}
      />

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(o) => {
          if (!o) setPendingRevoke(null);
        }}
        title="Revoke this invitation?"
        entity={revokeInvite?.email ?? ''}
        consequence="The invitation link stops working. You can invite them again any time."
        confirmLabel="Revoke"
        destructive
        error={error}
        onConfirm={async () => {
          if (pendingRevoke === null) return;
          const ok = await onRevoke(pendingRevoke);
          if (!ok) throw new Error('not revoked');
        }}
      />

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
    </AcPage>
  );
}
