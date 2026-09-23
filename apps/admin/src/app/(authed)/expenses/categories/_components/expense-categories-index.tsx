'use client';

import { useState, type ReactElement } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { Table, TBody, THead, Td, Th, TableEmpty, Tr } from '@skydrop/ui/app/data-table';
import { useToast } from '@skydrop/ui/app/toast';
import {
  useExpenseCategories,
  useUpdateExpenseCategory,
  type ExpenseCategoryView,
} from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { CategoryModal } from '../../_components/category-modal';
import { BackLink, MoCard } from '../../../treasury/_components/money-parts';
import '../../_components/expenses.css';

/**
 * What a spend can be filed as.
 *
 * ── ITS OWN PAGE, AWAY FROM THE LEDGER ───────────────────────────────
 * This list changes a few times a year; the spending it labels changes
 * every week. Sitting them together meant the page opened on a
 * reference table while the thing somebody came to see — what we
 * actually spent — was below the fold, or absent entirely.
 *
 * Categories are RETIRED, never deleted. A category is the only thing
 * that says what its past entries were for, so deleting one would
 * silently rewrite a previous quarter's breakdown into "uncategorised".
 */
export function ExpenseCategoriesIndex(): ReactElement {
  const canWrite = usePermission('money.treasury.manage');
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ExpenseCategoryView | null>(null);
  const [toggling, setToggling] = useState<ExpenseCategoryView | null>(null);
  const categories = useExpenseCategories(showInactive);

  return (
    <div className="mo-page">
      <div className="mo-stack mo-stack--tight">
        <BackLink href="/expenses" icon={<ArrowLeft size={14} aria-hidden />}>
          Back to spending
        </BackLink>
        <PageHeader
          title="Spending categories"
          subtitle="What a cost can be filed as, so a quarter's spending can be broken down rather than read as one number."
          action={
            canWrite ? (
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => setAdding(true)}>
                New category
              </Button>
            ) : undefined
          }
        />
      </div>

      {categories.isLoading ? (
        <SkeletonRows rows={5} cols={canWrite ? 5 : 4} label="Loading categories" />
      ) : categories.isError || categories.data === undefined ? (
        <ErrorState
          message={serverVerdict(categories.error, 'Could not read the categories.')}
          retry={() => void categories.refetch()}
        />
      ) : (
        <>
          <MoCard>
            <Checkbox
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              label="Show retired categories"
              description="Categories are retired, never deleted — a category is the only thing that says what its past entries were for."
            />
          </MoCard>

          <Table>
            <THead>
              <Tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>What goes here</Th>
                <Th>State</Th>
                {canWrite && <Th align="right">Actions</Th>}
              </Tr>
            </THead>
            <TBody>
              {categories.data.length === 0 ? (
                <TableEmpty colSpan={canWrite ? 5 : 4}>
                  <EmptyState
                    bare
                    title="No categories yet."
                    description="Add one before recording an expense, so the spend can be told apart later."
                  />
                </TableEmpty>
              ) : (
                categories.data.map((c) => (
                  <Tr key={c.id}>
                    <Td className="sk-ident">{c.code}</Td>
                    <Td>{c.name}</Td>
                    <Td className="mo-muted">{c.hint ?? '—'}</Td>
                    <Td>
                      <StatusChip
                        size="sm"
                        kind={c.isActive ? 'confirmed' : 'cancelled'}
                        label={c.isActive ? 'Active' : 'Retired'}
                      />
                    </Td>
                    {canWrite && (
                      <Td align="right">
                        <div className="mo-row mo-row--end">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setToggling(c)}>
                            {c.isActive ? 'Retire' : 'Restore'}
                          </Button>
                        </div>
                      </Td>
                    )}
                  </Tr>
                ))
              )}
            </TBody>
          </Table>
        </>
      )}

      <CategoryModal open={adding} onOpenChange={setAdding} />
      <CategoryModal
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
        category={editing}
      />
      <RetireCategoryModal category={toggling} onClose={() => setToggling(null)} />
    </div>
  );
}

/**
 * Retire or restore, confirmed. Retiring hides the category from the
 * expense form's picker; every entry already filed under it keeps it.
 */
function RetireCategoryModal({
  category,
  onClose,
}: {
  readonly category: ExpenseCategoryView | null;
  readonly onClose: () => void;
}): ReactElement {
  const update = useUpdateExpenseCategory();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const retiring = category?.isActive ?? true;

  async function confirm(): Promise<void> {
    if (!category) return;
    setError(null);
    try {
      await update.mutateAsync({ categoryId: category.id, isActive: !category.isActive });
      onClose();
      toast.success(retiring ? 'Category retired' : 'Category restored');
    } catch (err) {
      setError(serverVerdict(err));
      // Keeps the confirm open with the verdict on it, to read and retry.
      throw err;
    }
  }

  return (
    <ConfirmDialog
      open={category !== null}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          onClose();
        }
      }}
      title={retiring ? `Retire ${category?.name ?? ''}?` : `Restore ${category?.name ?? ''}?`}
      entity={category?.code ?? ''}
      entityIsIdentifier
      consequence={
        retiring
          ? 'New spending can no longer be filed under it. Everything already filed keeps it, so past breakdowns do not change.'
          : 'It will be offered again when recording spending.'
      }
      confirmLabel={retiring ? 'Retire category' : 'Restore category'}
      destructive={retiring}
      onConfirm={confirm}
      error={error ?? undefined}
    />
  );
}
