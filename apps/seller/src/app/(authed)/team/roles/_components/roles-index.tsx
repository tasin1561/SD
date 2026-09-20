'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Lock, Plus, Users } from 'lucide-react';
import {
  BandBody,
  Button,
  Crumbs,
  ErrorState,
  LoadingState,
  MetaChip,
  PageHeader,
  SectionBand,
  TBody,
  THead,
  Table,
  TableEmpty,
  Td,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { useDeleteRole, usePermissionCatalogue, useRoles, type RoleView } from '@/lib/rbac-hooks';
import { serverVerdict } from '@/lib/server-verdict';
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

  const rows = roles.data ?? [];
  const assigned = rows.reduce((sum, r) => sum + r.memberCount, 0);
  const unused = rows.filter((r) => !r.isOwner && r.memberCount === 0);

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={<Crumbs items={CRUMBS} Link={Link} />}
        title="Roles"
        subtitle="A role is a set of permissions. Create as many as your team needs — the permissions themselves are fixed by the system."
        meta={
          roles.data === undefined ? undefined : (
            <>
              <MetaChip tone="accent">
                {rows.length} {rows.length === 1 ? 'role' : 'roles'}
              </MetaChip>
              <MetaChip dot>
                {assigned} {assigned === 1 ? 'person' : 'people'} covered
              </MetaChip>
              {unused.length > 0 && <MetaChip>{unused.length} held by nobody</MetaChip>}
            </>
          )
        }
        action={
          <Button
            variant="primary"
            size="md"
            disabled={catalogue.data === undefined}
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus size={14} aria-hidden /> New role
          </Button>
        }
      />

      <div>
        <SectionBand
          index="01"
          title="Role register"
          note={
            roles.data === undefined
              ? undefined
              : `${rows.length} ${rows.length === 1 ? 'role' : 'roles'}`
          }
        />
        <BandBody flush>
          {roles.isLoading || catalogue.isLoading ? (
            <div className="p-3">
              <LoadingState label="Loading roles…" />
            </div>
          ) : roles.isError || catalogue.isError ? (
            <div className="p-3">
              <ErrorState
                message={
                  roles.error?.message ?? catalogue.error?.message ?? 'Could not load roles.'
                }
                retry={() => {
                  void roles.refetch();
                  void catalogue.refetch();
                }}
              />
            </div>
          ) : (
            <Table wrapperClassName="rounded-none border-0 bg-transparent">
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
                        <span className="text-text-bright flex items-center gap-1.5">
                          {role.name}
                          {role.isOwner && (
                            <Lock
                              size={12}
                              className="text-text-faint"
                              aria-label="Cannot be edited"
                            />
                          )}
                        </span>
                        <span className="text-text-faint block font-mono text-xs">
                          {role.description ?? role.key}
                        </span>
                      </Td>
                      <Td className="text-text-muted">
                        {role.isOwner
                          ? 'Everything, including permissions added later'
                          : `${role.permissions.length} permission${role.permissions.length === 1 ? '' : 's'}`}
                      </Td>
                      <Td align="right" className="text-text-muted tabular-nums">
                        <span className="inline-flex items-center gap-1.5">
                          <Users size={12} aria-hidden />
                          {role.memberCount}
                        </span>
                      </Td>
                      <Td align="right">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
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
                            disabled={role.isOwner || role.isSystem || role.memberCount > 0}
                            onClick={() => void onDelete(role)}
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
        </BandBody>
      </div>

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
