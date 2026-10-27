'use client';

import { useState, type ReactElement } from 'react';
import { Lock, PencilLine, Plus, Trash2, Users } from 'lucide-react';
import { useToast } from '@skydrop/ui/app/toast';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { TBody, THead, Table, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { AcFact, AcHeader, AcPage, AcSection } from '../../settings/_components/ac-parts';
import { useDeleteRole, usePermissionCatalogue, useRoles, type RoleView } from '@/lib/rbac-hooks';
import { ROLE_AXIS_GROUPS, rolesInGroup } from '@/lib/role-axes';
import { serverVerdict } from '@/lib/server-verdict';
import { RoleEditor } from './role-editor';
import { useT } from '@/i18n/client';

/**
 * Roles, and what each may do.
 *
 * Roles are DATA — invent a "Warehouse manager", tick what it covers,
 * assign people to it, all without a deploy. What is NOT data is the
 * list of permissions: each one is checked by a line of code, so it is
 * defined in the API and served here.
 *
 * The super admin row is deliberately inert. It holds everything
 * implicitly and cannot be edited or deleted, because it is the way back
 * in from any mistake made on this screen.
 *
 * ── GROUPED BY AXIS ──────────────────────────────────────────────────
 * There are ten of these now and they are not ten of the same thing: the
 * seeded seven are job functions, and the three added alongside them are
 * access tiers (see `role-axes.ts`). A person may hold several and the
 * guard resolves the UNION, so the grouping is also the instruction —
 * pick a tier, add the function. Grouping decides headings and nothing
 * else; every role appears somewhere, whatever its key.
 */
export function RolesIndex(): ReactElement {
  const t = useT();
  const toast = useToast();
  const roles = useRoles();
  const catalogue = usePermissionCatalogue();
  const remove = useDeleteRole();
  const [editing, setEditing] = useState<RoleView | null>(null);
  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RoleView | null>(null);

  function onDelete(role: RoleView): void {
    setPendingDelete(role);
  }

  async function confirmDelete(): Promise<void> {
    const role = pendingDelete;
    if (role === null) return;
    try {
      await remove.mutateAsync({ id: role.id });
      toast.success(`${role.name} deleted`);
      setPendingDelete(null);
    } catch (e) {
      // The server's refusals here are the useful part — "3 staff still
      // hold this role" tells you exactly what to do next.
      toast.error(serverVerdict(e));
      setPendingDelete(null);
    }
  }

  const all = roles.data ?? [];

  function rolesTable(group: readonly RoleView[], caption: string): ReactElement {
    return (
      <Table caption={caption}>
        <THead>
          <Tr>
            <Th>{t('rolesRolesIndex.role')}</Th>
            <Th>{t('rolesRolesIndex.covers')}</Th>
            <Th align="right">{t('rolesRolesIndex.people')}</Th>
            <Th align="right">{t('rolesRolesIndex.actions')}</Th>
          </Tr>
        </THead>
        <TBody>
          {group.map((role) => (
            <Tr key={role.id}>
              <Td>
                <span className="ac-inline ac-cell-main">
                  {role.name}
                  {role.isSuperAdmin && (
                    <Lock
                      size={13}
                      aria-label={t('rolesRolesIndex.cannotBeChanged')}
                      className="ac-faint"
                    />
                  )}
                </span>
                <span className="ac-cell-sub">{role.description ?? role.key}</span>
              </Td>
              <Td>
                <span className="ac-muted">
                  {role.isSuperAdmin
                    ? t('rolesRolesIndex.everythingIncludingPermissionsAddedLater')
                    : `${role.permissions.length} permission${role.permissions.length === 1 ? '' : 's'}`}
                </span>
              </Td>
              <Td align="right">
                <span className="ac-inline sk-figure">
                  <Users size={13} aria-hidden />
                  {role.staffCount}
                </span>
              </Td>
              <Td align="right">
                <div className="ac-buttons">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<PencilLine size={14} />}
                    disabled={role.isSuperAdmin}
                    onClick={() => {
                      setEditing(role);
                      setOpen(true);
                    }}
                  >
                    {t('rolesRolesIndex.edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Trash2 size={14} />}
                    disabled={role.isSuperAdmin || role.isSystem || role.staffCount > 0}
                    onClick={() => onDelete(role)}
                  >
                    {t('rolesRolesIndex.delete')}
                  </Button>
                </div>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    );
  }

  return (
    <AcPage>
      <AcHeader
        title={t('rolesRolesIndex.roles')}
        subtitle={t('rolesRolesIndex.aRoleIsASet')}
        meta={
          <div className="ac-meta">
            <AcFact>
              <span className="sk-figure">{all.length}</span> role
              {all.length === 1 ? '' : 's'}
            </AcFact>
            <AcFact>{t('rolesRolesIndex.somebodyMayHoldSeveralWhat')}</AcFact>
          </div>
        }
        action={
          <Button
            variant="primary"
            size="md"
            icon={<Plus size={15} />}
            disabled={catalogue.data === undefined}
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            {t('rolesRolesIndex.newRole')}
          </Button>
        }
      />

      {roles.isLoading || catalogue.isLoading ? (
        <SkeletonRows rows={5} cols={4} label={t('rolesRolesIndex.loadingRoles')} />
      ) : roles.isError || catalogue.isError ? (
        <ErrorState
          message={serverVerdict(
            roles.error ?? catalogue.error,
            t('rolesRolesIndex.couldNotLoadRoles'),
          )}
          retry={() => {
            void roles.refetch();
            void catalogue.refetch();
          }}
        />
      ) : (
        ROLE_AXIS_GROUPS.map((g) => {
          const group = rolesInGroup(all, g.axes);
          // A seeded group is never empty in practice; saying nothing
          // beats an empty card nobody can act on. "Roles you created"
          // IS legitimately empty and gets a next step instead.
          if (group.length === 0 && g.id !== 'custom') return null;
          return (
            <AcSection key={g.id} title={g.title} note={g.note} flush={group.length > 0}>
              {group.length === 0 ? (
                <EmptyState
                  bare
                  title={t('rolesRolesIndex.noneYet')}
                  description={t('rolesRolesIndex.createOneWhenAJob')}
                />
              ) : (
                rolesTable(group, t('rolesRolesIndex.roles2', { title: g.title }))
              )}
            </AcSection>
          );
        })
      )}

      {all.length > 0 && (
        <p className="ac-faint ac-text">{t('rolesRolesIndex.aPersonCountedUnderPeople')}</p>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
        title={`Delete ${pendingDelete?.name ?? 'this role'}?`}
        entity={pendingDelete?.name ?? t('rolesRolesIndex.thisRole')}
        consequence={t('rolesRolesIndex.thisCannotBeUndoneNobody')}
        confirmLabel={t('rolesRolesIndex.deleteRole')}
        destructive
        onConfirm={confirmDelete}
      />

      {catalogue.data !== undefined && (
        <RoleEditor
          role={editing}
          catalogue={catalogue.data}
          open={open}
          onClose={() => setOpen(false)}
        />
      )}
    </AcPage>
  );
}
