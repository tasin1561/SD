'use client';

import { useState, type ReactElement } from 'react';
import { Lock, Users } from 'lucide-react';
import {
  Button,
  ErrorState,
  LoadingState,
  PageHeader,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Toolbar,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { useDeleteRole, usePermissionCatalogue, useRoles, type RoleView } from '@/lib/rbac-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { RoleEditor } from './role-editor';

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
 */
export function RolesIndex(): ReactElement {
  const toast = useToast();
  const roles = useRoles();
  const catalogue = usePermissionCatalogue();
  const remove = useDeleteRole();
  const [editing, setEditing] = useState<RoleView | null>(null);
  const [open, setOpen] = useState(false);

  async function onDelete(role: RoleView): Promise<void> {
    if (!window.confirm(`Delete ${role.name}? This cannot be undone.`)) return;
    try {
      await remove.mutateAsync({ id: role.id });
      toast.success(`${role.name} deleted`);
    } catch (e) {
      // The server's refusals here are the useful part — "3 staff still
      // hold this role" tells you exactly what to do next.
      toast.error(serverVerdict(e));
    }
  }

  return (
    <div>
      <PageHeader
        title="Roles"
        subtitle="A role is a set of permissions. Create as many as the work needs — the permissions themselves are fixed by the system."
      />

      <Toolbar>
        <span className="text-text-muted text-sm">
          {roles.data?.length ?? 0} role{roles.data?.length === 1 ? '' : 's'}
        </span>
        <Button
          variant="primary"
          size="sm"
          disabled={catalogue.data === undefined}
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          New role
        </Button>
      </Toolbar>

      {roles.isLoading || catalogue.isLoading ? (
        <LoadingState label="Loading roles…" />
      ) : roles.isError || catalogue.isError ? (
        <ErrorState
          message={roles.error?.message ?? catalogue.error?.message ?? 'Could not load roles.'}
          retry={() => {
            void roles.refetch();
            void catalogue.refetch();
          }}
        />
      ) : (
        <Table wrapperClassName="rounded-t-none border-t-0">
          <THead>
            <Tr>
              <Th>Role</Th>
              <Th>Covers</Th>
              <Th align="right">People</Th>
              <Th align="right">Actions</Th>
            </Tr>
          </THead>
          <TBody>
            {(roles.data ?? []).map((role) => (
              <Tr key={role.id}>
                <Td>
                  <span className="text-text-bright flex items-center gap-1.5">
                    {role.name}
                    {role.isSuperAdmin && <Lock size={12} className="text-text-faint" />}
                  </span>
                  <span className="text-text-faint block text-xs">
                    {role.description ?? role.key}
                  </span>
                </Td>
                <Td className="text-text-muted">
                  {role.isSuperAdmin
                    ? 'Everything, including permissions added later'
                    : `${role.permissions.length} permission${role.permissions.length === 1 ? '' : 's'}`}
                </Td>
                <Td align="right" className="text-text-muted tabular-nums">
                  <span className="inline-flex items-center gap-1.5">
                    <Users size={12} />
                    {role.staffCount}
                  </span>
                </Td>
                <Td align="right">
                  <div className="flex justify-end gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={role.isSuperAdmin}
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
                      disabled={role.isSuperAdmin || role.isSystem || role.staffCount > 0}
                      onClick={() => void onDelete(role)}
                    >
                      Delete
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      {catalogue.data !== undefined && (
        <RoleEditor
          role={editing}
          catalogue={catalogue.data}
          open={open}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
