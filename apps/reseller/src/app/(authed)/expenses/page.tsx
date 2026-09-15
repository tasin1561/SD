'use client';

import { useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { useStoreIdentity } from '@skydrop/auth/client';
import {
  Button,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  Money,
  PageHeader,
  Section,
  Select,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { istDay, istDayRange, lastDays } from '@/lib/ist-day';
import { can } from '@/lib/page-access';
import {
  EXPENSE_CATEGORIES,
  useRecordStoreExpense,
  useRemoveStoreExpense,
  useStoreExpenses,
  type ExpenseCategory,
  type StoreExpenseView,
} from '@/lib/report-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * The store's OWN expense book (RS-8) — what it spent on ads, staff,
 * software and the rest. It feeds the store's P&L and return on ad spend;
 * no money moves and the seller never sees it. A mistake is removed with
 * a reason that stays on the record, never edited.
 */
export default function StoreExpensesPage(): ReactElement {
  const identity = useStoreIdentity();
  const mayRecord = can(identity, 'expenses.manage');
  const initial = lastDays(90);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const window = useMemo(() => istDayRange(from, to), [from, to]);
  const list = useStoreExpenses(window);
  const [removing, setRemoving] = useState<StoreExpenseView | null>(null);

  return (
    <>
      <PageHeader
        title="Expenses"
        subtitle="What your store spent. It counts in your profit and loss and return on ad spend; it moves no money and your seller never sees it."
      />
      {mayRecord && <RecordExpense />}
      <div className="mb-4 flex flex-wrap gap-3">
        <FormField label="From" htmlFor="from">
          <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </FormField>
        <FormField label="To" htmlFor="to">
          <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </FormField>
      </div>
      {list.isPending && <LoadingState rows={5} />}
      {list.isError && (
        <ErrorState message={list.error.message} retry={() => void list.refetch()} />
      )}
      {list.data !== undefined && (
        <Section
          title="Recorded"
          subtitle={
            <>
              Total <Money amount={list.data.totalInr} /> ·{' '}
              {list.data.byCategory.map((c) => `${c.label} ₹${c.amountInr}`).join(' · ') ||
                'nothing yet'}
            </>
          }
        >
          {list.data.items.length === 0 ? (
            <EmptyState
              title="No expenses in this window"
              description={
                mayRecord ? 'Record one above.' : 'Somebody with “Record expenses” can add them.'
              }
            />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Date</Th>
                  <Th>Category</Th>
                  <Th>What</Th>
                  <Th align="right">Amount</Th>
                  {mayRecord && <Th />}
                </Tr>
              </THead>
              <TBody>
                {list.data.items.map((x) => (
                  <Tr key={x.id}>
                    <Td>{x.expenseDate}</Td>
                    <Td>{x.categoryLabel}</Td>
                    <Td>
                      <span className={x.deletedAt === null ? '' : 'line-through'}>
                        {x.description}
                      </span>
                      {x.reference !== null && (
                        <span className="text-text-muted block text-xs">Ref {x.reference}</span>
                      )}
                      {x.deleteReason !== null && (
                        <span className="text-text-muted block text-xs">
                          Removed: {x.deleteReason}
                        </span>
                      )}
                    </Td>
                    <Td align="right">
                      <Money amount={x.amountInr} />
                    </Td>
                    {mayRecord && (
                      <Td align="right">
                        {x.deletedAt === null && (
                          <Button size="sm" variant="ghost" onClick={() => setRemoving(x)}>
                            Remove
                          </Button>
                        )}
                      </Td>
                    )}
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Section>
      )}
      {removing !== null && <RemoveExpense expense={removing} onClose={() => setRemoving(null)} />}
    </>
  );
}

function RecordExpense(): ReactElement {
  const toast = useToast();
  const record = useRecordStoreExpense();
  const [category, setCategory] = useState<ExpenseCategory>('AD_SPEND');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(istDay(new Date()));
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  // IDEM-1: one key per form, reused on a retry, new after a success.
  const [key, setKey] = useState(() => crypto.randomUUID());

  function submit(e: FormEvent): void {
    e.preventDefault();
    record.mutate(
      {
        category,
        amountInr: amount,
        expenseDate: date,
        description,
        ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
        idempotencyKey: key,
      },
      {
        onSuccess: () => {
          toast.success('Recorded.');
          setAmount('');
          setDescription('');
          setReference('');
          setKey(crypto.randomUUID());
        },
        onError: (err) => toast.error(serverVerdict(err)),
      },
    );
  }

  return (
    <Section title="Record an expense">
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FormField label="Category" htmlFor="category">
          <Select
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Amount (₹)" htmlFor="amount" required>
          <Input
            id="amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </FormField>
        <FormField label="Date spent" htmlFor="date" required>
          <Input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </FormField>
        <FormField label="What it was for" htmlFor="description" required>
          <Input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
        </FormField>
        <FormField label="Invoice or receipt number" htmlFor="reference">
          <Input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} />
        </FormField>
        <div className="flex items-end">
          <Button type="submit" variant="primary" size="md" disabled={record.isPending}>
            Record
          </Button>
        </div>
      </form>
    </Section>
  );
}

function RemoveExpense({
  expense,
  onClose,
}: {
  expense: StoreExpenseView;
  onClose: () => void;
}): ReactElement {
  const toast = useToast();
  const remove = useRemoveStoreExpense();
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Remove this expense?"
      description={`${expense.categoryLabel} · ₹${expense.amountInr} · ${expense.expenseDate}. It stays on the record with your reason; if its month has closed, the change is carried into this month.`}
    >
      <FormField label="Why" htmlFor="reason" required>
        <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
      <ModalFooter>
        <Button onClick={onClose}>Keep it</Button>
        <Button
          variant="destructive"
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(
              { id: expense.id, reason },
              {
                onSuccess: () => {
                  toast.success('Removed.');
                  onClose();
                },
                onError: (err) => toast.error(serverVerdict(err)),
              },
            )
          }
        >
          Remove
        </Button>
      </ModalFooter>
    </Modal>
  );
}
