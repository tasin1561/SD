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
import { serverVerdict } from '@/lib/server-verdict';
import { SetFact, SetPageHeader } from '../../../settings/_components/settings-parts';
import { RoleEditor } from './role-editor';

const CRUMBS = [
  { label: 'Seller console' },
  { label: 'Account' },
  { label: 'Team', href: '/team' },
  { label: 'Roles' },
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
      toast.success(`${role.name} deleted`);
    } catch (e) {
      // The server's refusals here are the useful part — "3 staff still
      // hold this role" tells you exactly what to do next.
      toast.error(serverVerdict(e));
    }
  }

  const rows = roles.data ?? [];
  const assigned = rows.reduce((sum, r) => sum + r.memberCount, 0);
  const unused = rows.filter((r) => !r.isOwner && r.memberCount === 0);

  return (
    <div className="set-page">
      <SetPageHeader
        crumbs={CRUMBS}
        title="Roles"
        subtitle="A role is a set of permissions. Create as many as your team needs — the permissions themselves are fixed by the system."
        meta={
          roles.data === undefined ? undefined : (
            <span className="set-meta">
              <SetFact tone="accent">
                {rows.length} {rows.length === 1 ? 'role' : 'roles'}
              </SetFact>
              <SetFact dot>
                {assigned} {assigned === 1 ? 'person' : 'people'} covered
              </SetFact>
              {unused.length > 0 && <SetFact>{unused.length} held by nobody</SetFact>}
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
            New role
          </Button>
        }
      />

      <section className="set-section">
        <SectionHeading
          title="Your roles"
          note={
            roles.data === undefined
              ? undefined
              : `${rows.length} ${rows.length === 1 ? 'role' : 'roles'}`
          }
        />
        <div className="set-card" data-flush>
          {roles.isLoading || catalogue.isLoading ? (
            <SkeletonRows rows={4} cols={4} label="Loading roles…" />
          ) : roles.isError || catalogue.isError ? (
            <ErrorState
              message={roles.error?.message ?? catalogue.error?.message ?? 'Could not load roles.'}
              retry={() => {
                void roles.refetch();
                void catalogue.refetch();
              }}
            />
          ) : (
            <Table caption="Roles">
              <THead>
                <Tr>
                  <Th>Role</Th>
                  <Th>Covers</Th>
                  <Th align="right">People</Th>
                  <Th align="right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {rows.length === 0 ? (
                  <TableEmpty colSpan={4}>No roles yet.</TableEmpty>
                ) : (
                  rows.map((role) => (
                    <Tr key={role.id}>
                      <Td>
                        <span className="set-cell-strong set-chips">
                          {role.name}
                          {role.isOwner && (
                            <Lock size={12} className="set-faint" aria-label="Cannot be edited" />
                          )}
                        </span>
                        <span className="set-cell-sub">
                          {role.description ?? <span className="sk-ident">{role.key}</span>}
                        </span>
                      </Td>
                      <Td className="set-cell-muted">
                        {role.isOwner
                          ? 'Everything, including permissions added later'
                          : `${role.permissions.length} permission${role.permissions.length === 1 ? '' : 's'}`}
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
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<Trash2 size={13} />}
                            disabled={role.isOwner || role.isSystem || role.memberCount > 0}
                            onClick={() => setPendingDelete(role)}
                          >
                            Delete
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
        title="Delete this role?"
        entity={pendingDelete?.name ?? ''}
        consequence="The role is removed for good. This cannot be undone."
        confirmLabel="Delete role"
        destructive
        onConfirm={() => (pendingDelete === null ? undefined : onDelete(pendingDelete))}
      />
    </div>
  );
}
