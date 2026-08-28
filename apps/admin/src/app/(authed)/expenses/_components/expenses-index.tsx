'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  ErrorState,
  LoadingState,
  Money,
  PageHeader,
  Section,
  StatusBadge,
  TBody,
  THead,
  Table,
  TableEmpty,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { useExpenseCategories, useInvestments } from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { CategoryModal } from './category-modal';
import { ExpenseModal } from './expense-modal';
import { InvestmentModal } from './investment-modal';
import { InvestmentReturnModal } from './investment-return-modal';

/**
 * What we spend, and what we have parked.
 *
 * Both are ours — client money is not spendable and not investable —
 * which is why they live together and away from the seller-facing money
 * pages. Both post through the same bank ledger, so an expense paid and
 * a deposit placed both move a real account rather than being noted
 * somewhere off to the side.
 */
export function ExpensesIndex(): ReactElement {
  const canWrite = usePermission('money.treasury.manage');
  const [showInactive, setShowInactive] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const categories = useExpenseCategories(showInactive);
  const investments = useInvestments(showClosed);

  const [spending, setSpending] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [returningTo, setReturningTo] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Expenses & investments"
        subtitle="What it costs to exist, and what we have parked somewhere it can earn."
      />

      <Section
        title="Spending"
        action={
          canWrite ? (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAddingCategory(true)}>
                New category
              </Button>
              <Button size="sm" onClick={() => setSpending(true)}>
                Record an expense
              </Button>
            </div>
          ) : undefined
        }
      >
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
                  Categories are retired, never deleted — a category is the only thing that says
                  what its past entries were for.
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
      </Section>

      <Section
        title="Investments"
        action={
          canWrite ? (
            <Button size="sm" onClick={() => setPlacing(true)}>
              Place capital
            </Button>
          ) : undefined
        }
      >
        {investments.isLoading ? (
          <LoadingState />
        ) : investments.isError || investments.data === undefined ? (
          <ErrorState
            message={investments.error?.message ?? 'Could not read the investments.'}
            retry={() => void investments.refetch()}
          />
        ) : (
          <>
            <Card>
              <CardBody>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={showClosed}
                    onChange={(e) => setShowClosed(e.target.checked)}
                  />
                  Show closed
                </label>
                <p className="text-text-muted mt-1 text-xs">
                  Placed capital leaves the bank without being spent, so client-money coverage still
                  reads correctly while it is out.
                </p>
              </CardBody>
            </Card>

            <Table>
              <THead>
                <Tr>
                  <Th>What</Th>
                  <Th>With</Th>
                  <Th align="right">Placed</Th>
                  <Th align="right">Returned</Th>
                  <Th align="right">Net</Th>
                  <Th>State</Th>
                  <Th align="right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {investments.data.length === 0 ? (
                  <TableEmpty colSpan={7}>
                    Nothing placed. A fixed deposit or a loan out is recorded here so it stops
                    reading as money that vanished.
                  </TableEmpty>
                ) : (
                  investments.data.map((i) => (
                    <Tr key={i.id}>
                      <Td>{i.label}</Td>
                      <Td className="text-text-muted">{i.counterparty}</Td>
                      <Td align="right">
                        <Money amount={i.placedInr} currency={i.currency} convert={false} />
                      </Td>
                      <Td align="right">
                        <Money amount={i.returnedInr} currency={i.currency} convert={false} />
                      </Td>
                      <Td align="right">
                        <Money
                          amount={i.netInr}
                          currency={i.currency}
                          convert={false}
                          direction={Number(i.netInr) < 0 ? 'debit' : 'credit'}
                        />
                      </Td>
                      <Td>
                        <StatusBadge
                          kind={i.closedAt === null ? 'in-transit' : 'delivered'}
                          label={i.closedAt === null ? 'Out' : 'Closed'}
                        />
                      </Td>
                      <Td align="right">
                        {canWrite && i.closedAt === null ? (
                          <Button variant="ghost" size="sm" onClick={() => setReturningTo(i.id)}>
                            Record return
                          </Button>
                        ) : (
                          <span className="text-text-faint">—</span>
                        )}
                      </Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          </>
        )}
      </Section>

      <CategoryModal open={addingCategory} onOpenChange={setAddingCategory} />
      <ExpenseModal open={spending} onOpenChange={setSpending} />
      <InvestmentModal open={placing} onOpenChange={setPlacing} />
      <InvestmentReturnModal investmentId={returningTo} onClose={() => setReturningTo(null)} />
    </div>
  );
}
