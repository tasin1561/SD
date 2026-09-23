'use client';

import { useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { Plus, ReceiptText, Trash2 } from 'lucide-react';
import { useStoreIdentity } from '@skydrop/auth/client';
import { Money } from '@skydrop/ui/components';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { DateField } from '@skydrop/ui/app/date-field';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
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
import { RmSection } from '../wallet/_components/rm-parts';

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
    <div className="rm-page">
      <PageHeader
        title="Expenses"
        subtitle="What your store spent. It counts in your profit and loss and return on ad spend; it moves no money and your seller never sees it."
      />
      {mayRecord && <RecordExpense />}
      <div className="rm-filters">
        <DateField id="from" label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
        <DateField id="to" label="To" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {list.isPending && <SkeletonRows rows={5} cols={4} label="Loading expenses" />}
      {list.isError && (
        <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      )}
      {list.data !== undefined && (
        <RmSection>
          <SectionHeading
            title="Recorded"
            note={
              <>
                Total <Money amount={list.data.totalInr} />
                {list.data.byCategory.length === 0
                  ? ' · nothing yet'
                  : list.data.byCategory.map((c) => (
                      <span key={c.category}>
                        {' · '}
                        {c.label} <Money amount={c.amountInr} />
                      </span>
                    ))}
              </>
            }
          />
          {list.data.items.length === 0 ? (
            <EmptyState
              icon={<ReceiptText size={22} />}
              title="No expenses in this window"
              description={
                mayRecord ? 'Record one above.' : 'Somebody with “Record expenses” can add them.'
              }
            />
          ) : (
            <Table caption="Recorded expenses">
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
                    <Td className="rm-when sk-figure">{x.expenseDate}</Td>
                    <Td>{x.categoryLabel}</Td>
                    <Td>
                      <span className={x.deletedAt === null ? '' : 'rm-struck'}>
                        {x.description}
                      </span>
                      {x.reference !== null && (
                        <span className="rm-faint rm-block">
                          Ref <span className="sk-ident">{x.reference}</span>
                        </span>
                      )}
                      {x.deleteReason !== null && (
                        <span className="rm-faint rm-block">Removed: {x.deleteReason}</span>
                      )}
                    </Td>
                    <Td align="right">
                      <Money amount={x.amountInr} />
                    </Td>
                    {mayRecord && (
                      <Td align="right">
                        {x.deletedAt === null && (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Trash2 size={14} />}
                            onClick={() => setRemoving(x)}
                          >
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
        </RmSection>
      )}
      {removing !== null && <RemoveExpense expense={removing} onClose={() => setRemoving(null)} />}
    </div>
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
  const [confirming, setConfirming] = useState(false);
  // IDEM-1: one key per form, reused on a retry, new after a success.
  const [key, setKey] = useState(() => crypto.randomUUID());

  const categoryLabel = EXPENSE_CATEGORIES.find((c) => c.value === category)?.label ?? category;

  // The browser's own `required` checks run on submit; the confirmation
  // then reads the entry back before the same request is sent.
  function submit(e: FormEvent): void {
    e.preventDefault();
    setConfirming(true);
  }

  async function send(): Promise<void> {
    try {
      await record.mutateAsync({
        category,
        amountInr: amount,
        expenseDate: date,
        description,
        ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
        idempotencyKey: key,
      });
      toast.success('Recorded.');
      setAmount('');
      setDescription('');
      setReference('');
      setKey(crypto.randomUUID());
    } catch (err) {
      toast.error(serverVerdict(err));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <RmSection>
      <SectionHeading title="Record an expense" />
      <form onSubmit={submit} className="rm-form rm-form--3 rm-card">
        <Select
          id="category"
          label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
        >
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
        <TextField
          id="amount"
          label="Amount (₹)"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        <DateField
          id="date"
          label="Date spent"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
        <TextField
          id="description"
          label="What it was for"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
        <TextField
          id="reference"
          label="Invoice or receipt number"
          inputClassName="sk-ident"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        <div className="rm-form__end">
          <AsyncButton
            type="submit"
            variant="primary"
            size="md"
            icon={<Plus size={15} />}
            state={record.isPending ? 'busy' : 'idle'}
            labels={{ idle: 'Record', busy: 'Recording…' }}
          />
        </div>
      </form>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Record this expense?"
        entity={`${categoryLabel} · ${date} · ${description.trim()}`}
        amount={<Money amount={amount.trim() === '' ? '0' : amount.trim()} />}
        consequence="It counts in your profit and loss and return on ad spend. It moves no money; a mistake is removed with a reason, never edited."
        confirmLabel="Record"
        onConfirm={send}
      />
    </RmSection>
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
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      tone="critical"
      icon={<Trash2 size={18} />}
      size="sm"
      locked={remove.isPending}
      title="Remove this expense?"
      description={
        <>
          {expense.categoryLabel} · <Money amount={expense.amountInr} /> · {expense.expenseDate}. It
          stays on the record with your reason; if its month has closed, the change is carried into
          this month.
        </>
      }
      footer={
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={remove.isPending}>
            Keep it
          </Button>
          <AsyncButton
            variant="destructive"
            icon={<Trash2 size={15} />}
            disabled={reason.trim() === ''}
            state={remove.isPending ? 'busy' : 'idle'}
            labels={{ idle: 'Remove', busy: 'Removing…' }}
            onClick={() =>
              remove.mutate(
                { id: expense.id, reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast.success('Removed.');
                    onClose();
                  },
                  onError: (err) => toast.error(serverVerdict(err)),
                },
              )
            }
          />
        </DialogFooter>
      }
    >
      <TextField
        id="reason"
        label="Why"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
      />
    </Dialog>
  );
}
