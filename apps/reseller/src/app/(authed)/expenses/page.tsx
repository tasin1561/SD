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
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';
import { richMessage, useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
import { RmSection } from '../wallet/_components/rm-parts';

/**
 * The store's OWN expense book (RS-8) — what it spent on ads, staff,
 * software and the rest. It feeds the store's P&L and return on ad spend;
 * no money moves and the seller never sees it. A mistake is removed with
 * a reason that stays on the record, never edited.
 */
const CATEGORY_KEY: Readonly<Record<ExpenseCategory, MessageKey>> = {
  AD_SPEND: 'exp.cat.AD_SPEND',
  STAFF: 'exp.cat.STAFF',
  SOFTWARE: 'exp.cat.SOFTWARE',
  PHOTOGRAPHY: 'exp.cat.PHOTOGRAPHY',
  PACKAGING: 'exp.cat.PACKAGING',
  CUSTOMER_REFUNDS: 'exp.cat.CUSTOMER_REFUNDS',
  RENT: 'exp.cat.RENT',
  OTHER: 'exp.cat.OTHER',
};

/** The category in this console's language; the server's own label for one this build does not know. */
function categoryName(
  category: ExpenseCategory,
  serverLabel: string,
  t: Translate<MessageKey>,
): string {
  const key = CATEGORY_KEY[category] as MessageKey | undefined;
  return key === undefined ? serverLabel : t(key);
}

export default function StoreExpensesPage(): ReactElement {
  const t = useT();
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
      <PageHeader title={t('exp.title')} subtitle={t('exp.subtitle')} />
      {mayRecord && <RecordExpense />}
      <div className="rm-filters">
        <DateField
          id="from"
          label={t('exp.from')}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <DateField id="to" label={t('exp.to')} value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {list.isPending && <SkeletonRows rows={5} cols={4} label={t('exp.loading')} />}
      {list.isError && (
        <ErrorState message={verdict(list.error, t)} retry={() => void list.refetch()} />
      )}
      {list.data !== undefined && (
        <RmSection>
          <SectionHeading
            title={t('exp.recorded')}
            note={
              <>
                {richMessage(t('exp.total'), { amount: <Money amount={list.data.totalInr} /> })}
                {list.data.byCategory.length === 0
                  ? t('exp.nothingYet')
                  : list.data.byCategory.map((c) => (
                      <span key={c.category}>
                        {' · '}
                        {categoryName(c.category, c.label, t)} <Money amount={c.amountInr} />
                      </span>
                    ))}
              </>
            }
          />
          {list.data.items.length === 0 ? (
            <EmptyState
              icon={<ReceiptText size={22} />}
              title={t('exp.empty')}
              description={mayRecord ? t('exp.empty.record') : t('exp.empty.permission')}
            />
          ) : (
            <Table caption={t('exp.caption')}>
              <THead>
                <Tr>
                  <Th>{t('exp.col.date')}</Th>
                  <Th>{t('exp.col.category')}</Th>
                  <Th>{t('exp.col.what')}</Th>
                  <Th align="right">{t('exp.col.amount')}</Th>
                  {mayRecord && <Th />}
                </Tr>
              </THead>
              <TBody>
                {list.data.items.map((x) => (
                  <Tr key={x.id}>
                    <Td className="rm-when sk-figure">{x.expenseDate}</Td>
                    <Td>{categoryName(x.category, x.categoryLabel, t)}</Td>
                    <Td>
                      <span className={x.deletedAt === null ? '' : 'rm-struck'}>
                        {x.description}
                      </span>
                      {x.reference !== null && (
                        <span className="rm-faint rm-block">
                          {richMessage(t('exp.ref'), {
                            ref: <span className="sk-ident">{x.reference}</span>,
                          })}
                        </span>
                      )}
                      {x.deleteReason !== null && (
                        <span className="rm-faint rm-block">
                          {t('exp.removedWhy', { reason: x.deleteReason })}
                        </span>
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
                            {t('exp.remove')}
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
  const t = useT();
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

  const categoryLabel = categoryName(
    category,
    EXPENSE_CATEGORIES.find((c) => c.value === category)?.label ?? category,
    t,
  );

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
      toast.success(t('exp.rec.toast'));
      setAmount('');
      setDescription('');
      setReference('');
      setKey(crypto.randomUUID());
    } catch (err) {
      toast.error(verdict(err, t));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <RmSection>
      <SectionHeading title={t('exp.rec.title')} />
      <form onSubmit={submit} className="rm-form rm-form--3 rm-card">
        <Select
          id="category"
          label={t('exp.rec.category')}
          value={category}
          onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
        >
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {categoryName(c.value, c.label, t)}
            </option>
          ))}
        </Select>
        <TextField
          id="amount"
          label={t('exp.rec.amount')}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        <DateField
          id="date"
          label={t('exp.rec.date')}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
        <TextField
          id="description"
          label={t('exp.rec.what')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
        <TextField
          id="reference"
          label={t('exp.rec.invoice')}
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
            labels={{ idle: t('exp.rec.submit'), busy: t('exp.rec.recording') }}
          />
        </div>
      </form>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('exp.rec.confirmTitle')}
        entity={`${categoryLabel} · ${date} · ${description.trim()}`}
        amount={<Money amount={amount.trim() === '' ? '0' : amount.trim()} />}
        consequence={t('exp.rec.confirmBody')}
        confirmLabel={t('exp.rec.submit')}
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
  const t = useT();
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
      title={t('exp.rm.title')}
      description={richMessage(
        t('exp.rm.desc', {
          category: categoryName(expense.category, expense.categoryLabel, t),
          date: expense.expenseDate,
        }),
        { amount: <Money amount={expense.amountInr} /> },
      )}
      footer={
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={remove.isPending}>
            {t('exp.rm.keep')}
          </Button>
          <AsyncButton
            variant="destructive"
            icon={<Trash2 size={15} />}
            disabled={reason.trim() === ''}
            state={remove.isPending ? 'busy' : 'idle'}
            labels={{ idle: t('exp.rm.submit'), busy: t('exp.rm.removing') }}
            onClick={() =>
              remove.mutate(
                { id: expense.id, reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast.success(t('exp.rm.toast'));
                    onClose();
                  },
                  onError: (err) => toast.error(verdict(err, t)),
                },
              )
            }
          />
        </DialogFooter>
      }
    >
      <TextField
        id="reason"
        label={t('exp.rm.why')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
      />
    </Dialog>
  );
}
