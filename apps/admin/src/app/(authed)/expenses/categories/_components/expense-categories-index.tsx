'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
  TBody,
  THead,
  Table,
  TableEmpty,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { useExpenseCategories } from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { CategoryModal } from '../../_components/category-modal';

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
  const categories = useExpenseCategories(showInactive);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Spending categories"
        subtitle="What a cost can be filed as, so a quarter's spending can be broken down rather than read as one number."
        action={
          canWrite ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              New category
            </Button>
          ) : undefined
        }
      />

      <Link
        href="/expenses"
        className="text-text-muted hover:text-text inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-3.5" /> Back to spending
      </Link>

      {categories.isLoading ? (
        <LoadingState />
      ) : categories.isError || categories.data === undefined ? (
        <ErrorState
          message={categories.error?.message ?? 'Could not read the categories.'}
          retry={() => void categories.refetch()}
        />
      ) : (
        <>
          <Card>
            <CardBody>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                />
                Show retired categories
              </label>
              <p className="text-text-muted mt-1 text-xs">
                Categories are retired, never deleted — a category is the only thing that says what
                its past entries were for.
              </p>
            </CardBody>
          </Card>

          <Table>
            <THead>
              <Tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>What goes here</Th>
                <Th>State</Th>
              </Tr>
            </THead>
            <TBody>
              {categories.data.length === 0 ? (
                <TableEmpty colSpan={4}>
                  No categories yet. Add one before recording an expense, so the spend can be told
                  apart later.
                </TableEmpty>
              ) : (
                categories.data.map((c) => (
                  <Tr key={c.id}>
                    <Td className="font-mono text-xs">{c.code}</Td>
                    <Td>{c.name}</Td>
                    <Td className="text-text-muted text-xs">{c.hint ?? '—'}</Td>
                    <Td>
                      <StatusBadge
                        kind={c.isActive ? 'confirmed' : 'cancelled'}
                        label={c.isActive ? 'Active' : 'Retired'}
                      />
                    </Td>
                  </Tr>
                ))
              )}
            </TBody>
          </Table>
        </>
      )}

      <CategoryModal open={adding} onOpenChange={setAdding} />
    </div>
  );
}
