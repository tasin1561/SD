'use client';

import { useState, type ReactElement } from 'react';
import { RotateCw, ShieldCheck, TriangleAlert, UserMinus, UserPlus, XCircle } from 'lucide-react';
import { useToast } from '@skydrop/ui/app/toast';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
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
} from '@/lib/api-hooks';
import { InviteStaffModal } from './invite-staff-modal';
import { InviteLinkRevealCard } from './invite-link-reveal-card';
import { StaffRolesDialog } from './staff-roles-dialog';
import { usePermissionCatalogue, useRoles } from '@/lib/rbac-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { AcAlert, AcHeader, AcPage, AcSection } from '../../settings/_components/ac-parts';

/**
 * Staff, and which roles each of them holds.
 *
 * ── SEVERAL ROLES, SHOWN IN THE LIST ─────────────────────────────────
 * A person holds a SET of roles and what they may do is the union of
 * all of them, so the list names every one of them. It used to be a
 * `<Select>` in the row showing exactly one, which for somebody holding
 * three is a wrong answer that looks like a right one; and an inline
 * multi-select cannot replace it, because `.sk-table-wrap` is
 * `overflow-x: auto` and would clip the listbox. Chips in the cell,
 * `StaffRolesDialog` to change them.
 *
 * ── WHO MAY READ THE ROLE LIST ───────────────────────────────────────
 * This page is behind `staff.view`; `admin/staff-roles` is behind
 * `rbac.manage`. Those are different people, and the names in the list
 * now come from the staff payload itself rather than from the role list,
 * so somebody who may see the team but not administer roles reads the
 * column correctly instead of watching a dropdown render empty — which
 * is what happened before, with nothing on screen saying why.
 */
export function StaffManagementIndex(): ReactElement {
  const canWrite = usePermission('staff.manage');
  const canReadRoles = usePermission('rbac.manage');
  const users = useStaffUsersList();
  const roles = useRoles({ enabled: canReadRoles });
  const catalogue = usePermissionCatalogue({ enabled: canReadRoles });
  const invitations = useStaffInvitationsList();
  const deactivate = useDeactivateStaffUser();
  const resend = useResendStaffInvitation();
  const revoke = useRevokeStaffInvitation();
  const toast = useToast();

  const [inviting, setInviting] = useState(false);
  const [revealed, setRevealed] = useState<CreatedStaffInvitation | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);
  const [editingRoles, setEditingRoles] = useState<StaffUserRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  function fmtError(e: unknown): string {
    return serverVerdict(e, 'Action failed');
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
  const rolesReady = roles.data !== undefined;

  return (
    <AcPage>
      <AcHeader
        title="Staff"
        subtitle="Invite + manage admin / operational users. A person may hold several roles; what they can do is every permission from every role they hold."
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

      {canWrite && canReadRoles && roles.isError && (
        <AcAlert
          tone="warn"
          message={`Roles could not be loaded, so they cannot be changed here. ${serverVerdict(
            roles.error,
            'The role list did not load.',
          )}`}
        />
      )}
      {canWrite && !canReadRoles && (
        <AcAlert
          tone="warn"
          message="You can see the team and invite people, but changing which roles somebody holds needs the “Manage roles and permissions” permission."
        />
      )}

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
                <Th>Roles</Th>
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
                    {u.roleNames.length === 0 ? (
                      // A real state now: a person can hold no live role
                      // at all (every role they had was soft-deleted) and
                      // the guard then answers UNAUTHORIZED, so they
                      // cannot sign in. Blank would read as "loading".
                      <span className="ac-inline ac-danger-text">
                        <TriangleAlert size={13} aria-hidden />
                        No roles — cannot sign in
                      </span>
                    ) : (
                      <span className="ac-chips">
                        {u.roleNames.map((name) => (
                          <span key={name} className="ac-chip">
                            {name}
                          </span>
                        ))}
                      </span>
                    )}
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
                      <div className="ac-buttons">
                        {canWrite && rolesReady && (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<ShieldCheck size={14} />}
                            onClick={() => {
                              setError(null);
                              setEditingRoles(u);
                            }}
                          >
                            Change roles
                          </Button>
                        )}
                        {canWrite && (
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
                        {!canWrite && <span className="ac-faint">—</span>}
                      </div>
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
                <Th>Roles</Th>
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
                      {/* An invitation offers a SET of roles, so the
                          names of all of them are what is shown. There
                          is no single one to fall back to. */}
                      {inv.roleNames.length === 0 ? (
                        // The server drops a role deleted since the
                        // invitation was sent, because accepting will
                        // not grant it. An invitation left with none
                        // grants nothing at all, and the useful act is
                        // to revoke it and invite again.
                        <span className="ac-inline ac-danger-text">
                          <TriangleAlert size={13} aria-hidden />
                          No live roles — grants nothing
                        </span>
                      ) : (
                        <span className="ac-chips">
                          {inv.roleNames.map((name) => (
                            <span key={name} className="ac-chip">
                              {name}
                            </span>
                          ))}
                        </span>
                      )}
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

      {editingRoles !== null && roles.data !== undefined && (
        <StaffRolesDialog
          // A different person is a different component — the dialog
          // seeds its selection once, on mount.
          key={editingRoles.id}
          user={editingRoles}
          roles={roles.data}
          catalogueSize={catalogue.data?.permissions.length ?? 0}
          onClose={() => setEditingRoles(null)}
          onSaved={(names) => {
            setEditingRoles(null);
            toast.success(
              names.length === 0 ? 'Roles updated.' : `Roles updated — now ${names.join(', ')}.`,
            );
          }}
        />
      )}

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
