'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  ErrorState,
  LoadingState,
  PageHeader,
  useToast,
} from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import type { CategoryView } from '@skydrop/api-client';
import { useCategoriesList, useDeleteCategory } from '@/lib/api-hooks';
import { CategoryFormModal } from './category-form-modal';

/**
 * Flat list view + inline edit modal + create modal.
 *
 * Decisions:
 *   - Indent each row by `depth * 16px` so hierarchy is visible
 *     without a tree widget.
 *   - Delete is soft-delete; server rejects if the category has
 *     children or products → FE-2 surfaces `[code] message` verbatim.
 *   - Move (re-parent) is a separate modal pre-wired from the row
 *     menu; same FormModal shell.
 */
export function CategoriesIndex(): ReactElement {
  const list = useCategoriesList();
  const del = useDeleteCategory();
  const toast = useToast();

  const [editing, setEditing] = useState<CategoryView | null>(null);
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onDelete(id: string): Promise<void> {
    setError(null);
    try {
      await del.mutateAsync(id);
      toast.success('Category deleted.');
      setPendingDelete(null);
    } catch (e) {
      if (e instanceof ApiError) {
        const b = e.body as { code?: unknown; message?: unknown } | null;
        const code = typeof b?.code === 'string' ? b.code : null;
        const msg = typeof b?.message === 'string' ? b.message : e.message;
        setError(code ? `[${code}] ${msg}` : msg);
      } else {
        setError(e instanceof Error ? e.message : 'Delete failed.');
      }
    }
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Categories"
        subtitle="Global product taxonomy. Edit defaults to inherit into products and variants (HS, GST, package type, fragile/cold-chain flags)."
        action={
          <Button variant="primary" size="md" onClick={() => setCreating({ parentId: null })}>
            New category
          </Button>
        }
      />

      {error && (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px] mb-3">
          {error}
        </div>
      )}

      {list.isLoading ? (
        <LoadingState label="Loading categories…" />
      ) : list.isError ? (
        <ErrorState
          message={list.error?.message ?? 'Failed to load categories.'}
          retry={() => void list.refetch()}
        />
      ) : !list.data || list.data.length === 0 ? (
        <Card>
          <CardBody>
            <div className="text-text-bright text-sm mb-1">No categories yet.</div>
            <p className="text-text-muted text-xs mb-3">
              Create your first root category to get started.
            </p>
            <Button variant="primary" size="sm" onClick={() => setCreating({ parentId: null })}>
              New category
            </Button>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="text-text-muted text-[11px] uppercase tracking-wide bg-surface-raised border-b border-border">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Name / Path</th>
                <th className="text-left px-3 py-2 font-medium">Slug</th>
                <th className="text-left px-3 py-2 font-medium">Package</th>
                <th className="text-left px-3 py-2 font-medium">HS</th>
                <th className="text-right px-3 py-2 font-medium">GST %</th>
                <th className="text-right px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.data.map((c) => (
                <tr key={c.id}>
                  <td
                    className="px-3 py-2 text-text-body"
                    style={{ paddingLeft: 12 + c.depth * 16 }}
                  >
                    {c.depth > 0 && <span className="text-text-faint mr-1">↳</span>}
                    {c.name}
                    {c.requiresFragile && (
                      <span className="text-pending text-[10px] ml-2 uppercase">Fragile</span>
                    )}
                    {c.requiresColdChain && (
                      <span className="text-accent text-[10px] ml-2 uppercase">Cold-chain</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-text-muted">{c.slug}</td>
                  <td className="px-3 py-2 text-text-body text-xs uppercase">
                    {c.defaultPackageType ?? '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-text-muted">
                    {c.defaultHsCode ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-text-body font-mono text-xs">
                    {c.defaultGstRate ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCreating({ parentId: c.id })}
                      >
                        + Child
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
                        Edit
                      </Button>
                      {pendingDelete === c.id ? (
                        <>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => void onDelete(c.id)}
                          >
                            Confirm
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => setPendingDelete(c.id)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {creating && (
        <CategoryFormModal
          mode="create"
          parentId={creating.parentId}
          categories={list.data ?? []}
          onClose={() => setCreating(null)}
          onSuccess={() => {
            setCreating(null);
            toast.success('Category created.');
          }}
        />
      )}

      {editing && (
        <CategoryFormModal
          mode="edit"
          category={editing}
          categories={list.data ?? []}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            toast.success('Category updated.');
          }}
        />
      )}
    </div>
  );
}
