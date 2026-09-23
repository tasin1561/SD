'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { Receipt } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { DateField } from '@skydrop/ui/app/date-field';
import { useToast } from '@skydrop/ui/app/toast';
import {
  useExpenseCategories,
  useFreightSearch,
  usePayForwarder,
  useRecordBankEntry,
  type FreightChargeView,
} from '@/lib/ops-hooks';
import { usePlatformBankAccounts } from '@/lib/bank-account-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { localNow } from '@/lib/datetime-local';
import '../../treasury/_components/money.css';
import './expenses.css';

/**
 * Money leaving for something we bought.
 *
 * Always OURS — an expense paid out of client money would be spending a
 * seller's balance, so the owner is fixed to capital here rather than
 * offered as a choice. The amount is typed positive and negated on the
 * way out: asking an operator to type a minus sign is asking for the
 * day somebody forgets.
 */
export function ExpenseModal({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
}): ReactElement {
  const accounts = usePlatformBankAccounts(usePermission('money.view'));
  const categories = useExpenseCategories(false);
  const record = useRecordBankEntry();
  const payForwarder = usePayForwarder();

  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [occurredAt, setOccurredAt] = useState(localNow);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<FreightChargeView | null>(null);
  // The checked form waits here for a confirm that restates it; the
  // confirm then sends exactly the request the form always sent.
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();
  // One key per opening of the form, reused on every retry of it: the
  // expense (or the freight payment) it sends is then recorded once
  // however many times the button is pressed.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (open) setIdempotencyKey(crypto.randomUUID());
  }, [open]);

  const account = (accounts.data ?? []).find((a) => a.id === accountId);
  const category = (categories.data ?? []).find((c) => c.id === categoryId);
  // Offered for every category, PROMPTED for the one where leaving it
  // off is a real error: a forwarder payment with no consignment behind
  // it is counted twice in the P&L.
  const wantsLink = category?.code === 'freight_forwarder';
  // Attributing a payment goes through the freight endpoint, which is
  // gated more narrowly than recording an expense. Offering the field to
  // somebody who cannot submit it is worse than not offering it: they
  // fill it in, and the whole form 403s on the last click.
  const canAttribute = usePermission('money.freight.manage');

  /** The form's own checks, unchanged; passing them opens the confirm. */
  function review(): void {
    setError(null);
    if (account === undefined) {
      setError('Which account did it leave?');
      return;
    }
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setError('Enter what was spent, as a positive number');
      return;
    }
    if (linked === null && categoryId === '') {
      // The server refuses an uncategorised expense; saying so here is
      // just sooner (FE-2: its verdict is still what counts).
      setError('Choose what this was spent on');
      return;
    }
    setConfirming(true);
  }

  async function save(): Promise<void> {
    setError(null);
    const n = Number(amount);
    if (account === undefined) return;
    try {
      /*
        A payment ATTACHED to a consignment goes through the freight
        endpoint, not this one. That is not a convenience: the freight
        path writes the bank entry, links it to the bill and fills in
        our cost in a single transaction, and the link is what keeps the
        P&L from subtracting the same rupees twice — once as that leg's
        cost, once again in operating expenses.

        Same form, same fields, different endpoint underneath, so there
        is exactly ONE implementation of an attributed payment rather
        than a second one here that drifts from it.
      */
      if (linked !== null) {
        await payForwarder.mutateAsync({
          freightChargeId: linked.id,
          bankAccountId: account.id,
          amountPaid: n.toFixed(2),
          // A non-INR payment is priced in rupees by the server, at the
          // rate recorded for the moment it moved.
          occurredAt: new Date(occurredAt).toISOString(),
          ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
          ...(note.trim() === '' ? {} : { note: note.trim() }),
          idempotencyKey,
        });
        setAmount('');
        setReference('');
        setNote('');
        setLinked(null);
        onOpenChange(false);
        toast.success('Payment recorded and attributed');
        return;
      }

      await record.mutateAsync({
        accountId: account.id,
        amountCurrency: account.currency as 'INR' | 'BDT',
        type: 'EXPENSE',
        signedAmount: (-n).toFixed(2),
        ownerKind: 'CAPITAL',
        expenseCategoryId: categoryId,
        occurredAt: new Date(occurredAt).toISOString(),
        ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
        ...(note.trim() === '' ? {} : { note: note.trim() }),
        idempotencyKey,
      });
      setAmount('');
      setReference('');
      setNote('');
      onOpenChange(false);
      toast.success('Expense recorded');
    } catch (err) {
      setError(serverVerdict(err));
      // Keeps the confirm open with the verdict on it, to read and retry.
      throw err;
    }
  }

  const pending = record.isPending || payForwarder.isPending;
  const actionLabel = linked === null ? 'Record expense' : 'Record & attribute';

  return (
    <>
      <Dialog
        open={open && !confirming}
        onOpenChange={(next) => {
          onOpenChange(next);
          if (!next) setError(null);
        }}
        icon={<Receipt size={18} />}
        title="Record an expense"
        description="Money leaving one of our accounts for something we bought. Always ours — never a seller's."
        footer={
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={review} disabled={pending}>
              {pending ? 'Recording…' : actionLabel}
            </Button>
          </DialogFooter>
        }
      >
        <div className="mo-fields">
          <Select
            label="Paid from"
            requiredMark
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">Select an account…</option>
            {(accounts.data ?? [])
              .filter((a) => a.isActive)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} · {a.bankName} · {a.currency}
                </option>
              ))}
          </Select>
          <Select
            label="Category"
            requiredMark={linked === null}
            hint={
              (categories.data ?? []).length === 0
                ? 'No categories yet — add one first so this spend can be told apart later.'
                : undefined
            }
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Select a category…</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          {canAttribute && (
            <FreightLinkField
              value={linked}
              onChange={setLinked}
              prompt={wantsLink}
              currency={account?.currency ?? 'INR'}
            />
          )}
          <div className="mo-fields" data-cols="2">
            <TextField
              label={`Amount${account ? ` (${account.currency})` : ''}`}
              requiredMark
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
            <DateField
              label="When"
              requiredMark
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </div>
          {linked !== null && account !== undefined && account.currency !== 'INR' && (
            <p className="mo-faint">
              Paid in {account.currency}. The consignment&apos;s cost is kept in rupees, priced at
              the rate recorded for the moment this payment moved.
            </p>
          )}
          <TextField
            label="Reference"
            hint="Invoice or transaction id, so it can be matched later"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={200}
          />
          <TextArea label="Note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          {error !== null && !confirming && (
            <p className="mo-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={open && confirming}
        onOpenChange={(next) => {
          setConfirming(next);
          if (!next) setError(null);
        }}
        title={linked === null ? 'Record this expense?' : 'Record and attribute this payment?'}
        entity={account === undefined ? 'Paid from' : `${account.label} · ${account.bankName}`}
        amount={
          account === undefined ? undefined : (
            <Money
              amount={Number(amount).toFixed(2)}
              currency={account.currency as 'INR' | 'BDT'}
              convert={false}
              direction="debit"
            />
          )
        }
        consequence={
          linked === null
            ? 'This money leaves our account as an operating expense, filed under the category below.'
            : "This money leaves our account and becomes this consignment's forwarder cost, not an operating expense."
        }
        confirmLabel={actionLabel}
        onConfirm={save}
        error={confirming ? (error ?? undefined) : undefined}
      >
        <div className="ex-confirm-lines">
          {linked === null ? (
            <span>Category: {category?.name ?? '—'}</span>
          ) : (
            <span>
              Consignment:{' '}
              <span className="sk-ident">{linked.consignmentNumber ?? 'Consignment'}</span>
            </span>
          )}
          <span>
            When: {occurredAt === '' ? '—' : new Date(occurredAt).toLocaleString('en-IN')}
          </span>
          {reference.trim() !== '' && (
            <span>
              Reference: <span className="sk-ident">{reference.trim()}</span>
            </span>
          )}
        </div>
      </ConfirmDialog>
    </>
  );
}

/**
 * Attach this spend to a consignment's freight bill, by searching for it.
 *
 * ── WHY A SEARCH AND NOT A DROPDOWN ──────────────────────────────────
 * The person filling this in is holding a forwarder's invoice, and what
 * is printed on it is a consignment number or a seller's name. A list of
 * every open bill asks them to recognise a row; a search lets them type
 * what they are already reading.
 *
 * Matching is over the consignment number, the goods-receipt number and
 * the seller — the three things that invoice might name — and needs two
 * characters before it asks the server, so an empty box does not pull
 * two hundred bills nobody looked at.
 */
function FreightLinkField({
  value,
  onChange,
  prompt,
  currency,
}: {
  readonly value: FreightChargeView | null;
  readonly onChange: (next: FreightChargeView | null) => void;
  readonly prompt: boolean;
  readonly currency: string;
}): ReactElement {
  const [term, setTerm] = useState('');
  const results = useFreightSearch(term);

  if (value !== null) {
    return (
      <div>
        <p className="ex-picked__label">Attributed to</p>
        <div className="ex-picked">
          <div className="mo-wrap">
            <div className="ex-picked__title sk-ident">
              {value.consignmentNumber ?? 'Consignment'}
            </div>
            <div className="ex-picked__sub">
              {value.receiptNumber ?? 'no receipt number'} · billed {currency} {value.totalInr}
              {value.ourCostInr === null ? ' · our cost not yet recorded' : ''}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
            Remove
          </Button>
        </div>
      </div>
    );
  }

  return (
    <TextField
      label="Link to a consignment"
      hint={
        prompt
          ? 'A forwarder payment with no consignment behind it is counted twice in the profit report — once as that leg’s cost, once here. Search by consignment number, receipt or seller.'
          : 'Optional. Search by consignment number, receipt or seller.'
      }
      value={term}
      onChange={(e) => setTerm(e.target.value)}
      placeholder="e.g. CN-2026-08 or the seller’s name"
      // Loud only where leaving it empty is an actual error.
      className={prompt && term === '' ? 'ex-prompt' : undefined}
      after={
        term.trim().length >= 2 ? (
          <div className="ex-results">
            {results.isLoading ? (
              <p className="ex-results__note">Searching…</p>
            ) : (results.data ?? []).length === 0 ? (
              <p className="ex-results__note">
                No freight bill matches that. Leave it unlinked if this spend belongs to no
                consignment.
              </p>
            ) : (
              (results.data ?? []).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="ex-result"
                  onClick={() => {
                    onChange(f);
                    setTerm('');
                  }}
                >
                  <span className="ex-result__title sk-ident">
                    {f.consignmentNumber ?? 'Consignment'}
                  </span>
                  <span className="ex-result__sub">
                    {f.receiptNumber ?? 'no receipt number'} · billed {f.totalInr}
                    {f.ourCostInr === null ? ' · no cost recorded' : ` · cost ${f.ourCostInr}`}
                  </span>
                </button>
              ))
            )}
          </div>
        ) : undefined
      }
    />
  );
}
