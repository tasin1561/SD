'use client';

import { useState, type ReactElement } from 'react';
import { Lock, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { Table, TBody, THead, Td, Th, Tr, TableEmpty } from '@skydrop/ui/app/data-table';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { useDeleteRole, usePermissionCatalogue, useRoles, type RoleView } from '@/lib/rbac-hooks';
import { verdict } from '@/i18n/verdict';
import { SetFact, SetPageHeader } from '../../../settings/_components/settings-parts';
import { RoleEditor } from './role-editor';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

const crumbsOf = (t: Translate<MessageKey>) => [
  { label: t('teamRoles.clientConsole') },
  { label: t('teamRoles.account') },
  { label: t('teamRoles.team'), href: '/team' },
  { label: t('teamRoles.roles') },
];

/**
 * Roles, and what each may do.
 *
 * Roles are DATA — invent a "Warehouse manager", tick what it covers,
 * assign people to it, all without a deploy. What is NOT data is the
 * list of permissions: each one is checked by a line of code, so it is
 * defined in the API and served here.
 *
 * The owner row is deliberately inert. It holds everything
 * implicitly and cannot be edited or deleted, because it is the way back
 * in from any mistake made on this screen.
 */
export function RolesIndex(): ReactElement {
  const t = useT();
  const toast = useToast();
  const roles = useRoles();
  const catalogue = usePermissionCatalogue();
  const remove = useDeleteRole();
  const [editing, setEditing] = useState<RoleView | null>(null);
  const [open, setOpen] = useState(false);
  // Deleting a role asks first, in a dialog that restates the role — it
  // replaced a browser `confirm()` with the same question.
  const [pendingDelete, setPendingDelete] = useState<RoleView | null>(null);

  async function onDelete(role: RoleView): Promise<void> {
    try {
      await remove.mutateAsync({ id: role.id });
      toast.success(t('teamRoles.deleted', { role: role.name }));
    } catch (e) {
      // The server's refusals here are the useful part — "3 staff still
      // hold this role" tells you exactly what to do next.
      toast.error(verdict(e, t));
    }
  }

  const rows = roles.data ?? [];
  // ── ASSIGNMENTS, NOT PEOPLE ───────────────────────────────────
  // `memberCount` is how many people hold THAT role, counted through the
  // join table. Summing it across roles counts a person once per role
  // they hold, so this said "12 people covered" for a team of eight the
  // moment anybody held two roles. The number is still worth showing —
  // it is the size of the grant surface — but it is assignments, and it
  // says so. A distinct head count cannot be derived from these rows at
  // all, and the members list that could answer it needs `team.view`,
  // which somebody on this page is not guaranteed to hold.
  const assignments = rows.reduce((sum, r) => sum + r.memberCount, 0);
  const unused = rows.filter((r) => !r.isOwner && r.memberCount === 0);

  return (
    <div className="set-page">
      <SetPageHeader
        crumbs={crumbsOf(t)}
        title={t('teamRoles.roles')}
        subtitle={t('teamRoles.aRoleIsA')}
        meta={
          roles.data === undefined ? undefined : (
            <span className="set-meta">
              <SetFact tone="accent">
                {rows.length} {rows.length === 1 ? 'role' : 'roles'}
              </SetFact>
              <SetFact dot>
                {assignments} role {assignments === 1 ? 'assignment' : 'assignments'}
              </SetFact>
              {unused.length > 0 && (
                <SetFact>
                  {richMessage(t('teamRoles.heldByNobody'), { unused: unused.length })}
                </SetFact>
              )}
            </span>
          )
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
            {t('teamRoles.newRole')}
          </Button>
        }
      />

      <section className="set-section">
        <SectionHeading
          title={t('teamRoles.yourRoles')}
          note={
            roles.data === undefined
              ? undefined
              : `${rows.length} ${rows.length === 1 ? 'role' : 'roles'}`
          }
        />
        <div className="set-card" data-flush>
          {roles.isLoading || catalogue.isLoading ? (
            <SkeletonRows rows={4} cols={4} label={t('teamRoles.loadingRoles')} />
          ) : roles.isError || catalogue.isError ? (
            <ErrorState
              message={
                roles.error?.message ?? catalogue.error?.message ?? t('teamRoles.couldNotLoadRoles')
              }
              retry={() => {
                void roles.refetch();
                void catalogue.refetch();
              }}
            />
          ) : (
            <Table caption={t('teamRoles.roles')}>
              <THead>
                <Tr>
                  <Th>{t('teamRoles.role')}</Th>
                  <Th>{t('teamRoles.covers')}</Th>
                  <Th align="right">{t('teamRoles.heldBy')}</Th>
                  <Th align="right">{t('teamRoles.actions')}</Th>
                </Tr>
              </THead>
              <TBody>
                {rows.length === 0 ? (
                  <TableEmpty colSpan={4}>{t('teamRoles.noRolesYet')}</TableEmpty>
                ) : (
                  rows.map((role) => (
                    <Tr key={role.id}>
                      <Td>
                        <span className="set-cell-strong set-chips">
                          {role.name}
                          {role.isOwner && (
                            <Lock
                              size={12}
                              className="set-faint"
                              aria-label={t('teamRoles.cannotBeEdited')}
                            />
                          )}
                        </span>
                        <span className="set-cell-sub">
                          {role.description ?? <span className="sk-ident">{role.key}</span>}
                        </span>
                      </Td>
                      <Td className="set-cell-muted">
                        {role.isOwner
                          ? t('teamRoles.everythingIncludingPermissionsAdded')
                          : t('teamRoles.permission', {
                              permissions: role.permissions.length,
                              plural: role.permissions.length === 1 ? '' : 's',
                            })}
                      </Td>
                      <Td align="right">
                        <span className="set-chips sk-figure" data-end="1">
                          <Users size={12} aria-hidden />
                          {role.memberCount}
                        </span>
                      </Td>
                      <Td align="right">
                        <div className="set-row-actions">
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<Pencil size={13} />}
                            disabled={role.isOwner}
                            onClick={() => {
                              setEditing(role);
                              setOpen(true);
                            }}
                          >
                            {t('teamRoles.edit2')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<Trash2 size={13} />}
                            disabled={role.isOwner || role.isSystem || role.memberCount > 0}
                            onClick={() => setPendingDelete(role)}
                          >
                            {t('teamRoles.delete')}
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          )}
        </div>
      </section>

      {catalogue.data !== undefined && (
        <RoleEditor
          role={editing}
          catalogue={catalogue.data}
          open={open}
          onClose={() => setOpen(false)}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        title={t('teamRoles.deleteThisRole')}
        entity={pendingDelete?.name ?? ''}
        consequence={t('teamRoles.theRoleIsRemoved')}
        confirmLabel={t('teamRoles.deleteRole')}
        destructive
        onConfirm={() => (pendingDelete === null ? undefined : onDelete(pendingDelete))}
      />
    </div>
  );
}
