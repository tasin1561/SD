'use client';

import { useEffect, useState, type ReactElement } from 'react';
import {
  Button,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Select,
  Textarea,
} from '@skydrop/ui/components';
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

function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

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

  async function save(): Promise<void> {
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
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setError(null);
      }}
      title="Record an expense"
      description="Money leaving one of our accounts for something we bought. Always ours — never a seller's."
    >
      <div className="space-y-3">
        <FormField label="Paid from" required>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Select an account…</option>
            {(accounts.data ?? [])
              .filter((a) => a.isActive)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} · {a.bankName} · {a.currency}
                </option>
              ))}
          </Select>
        </FormField>
        <FormField
          label="Category"
          required={linked === null}
          hint={
            (categories.data ?? []).length === 0
              ? 'No categories yet — add one first so this spend can be told apart later.'
              : undefined
          }
        >
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Select a category…</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </FormField>
        {canAttribute && (
          <FreightLinkField
            value={linked}
            onChange={setLinked}
            prompt={wantsLink}
            currency={account?.currency ?? 'INR'}
          />
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label={`Amount${account ? ` (${account.currency})` : ''}`} required>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </FormField>
          <FormField label="When" required>
            <Input
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </FormField>
        </div>
        {linked !== null && account !== undefined && account.currency !== 'INR' && (
          <p className="text-text-muted text-xs">
            Paid in {account.currency}. The consignment&apos;s cost is kept in rupees, priced at the
            rate recorded for the moment this payment moved.
          </p>
        )}
        <FormField label="Reference" hint="Invoice or transaction id, so it can be matched later">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} />
        </FormField>
        <FormField label="Note">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </FormField>
      </div>
      {error !== null && <p className="text-danger mt-2 text-sm">{error}</p>}
      <ModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={record.isPending || payForwarder.isPending}>
          {record.isPending || payForwarder.isPending
            ? 'Recording…'
            : linked === null
              ? 'Record expense'
              : 'Record & attribute'}
        </Button>
      </ModalFooter>
    </Modal>
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
      <FormField label="Attributed to">
        <div className="border-border bg-surface-raised flex items-center justify-between gap-3 rounded-md border px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {value.consignmentNumber ?? 'Consignment'}
            </div>
            <div className="text-text-muted truncate text-xs">
              {value.receiptNumber ?? 'no receipt number'} · billed {currency} {value.totalInr}
              {value.ourCostInr === null ? ' · our cost not yet recorded' : ''}
            </div>
          </div>
          <button
            type="button"
            className="text-text-muted hover:text-text shrink-0 text-xs underline underline-offset-2"
            onClick={() => onChange(null)}
          >
            Remove
          </button>
        </div>
      </FormField>
    );
  }

  return (
    <FormField
      label="Link to a consignment"
      hint={
        prompt
          ? 'A forwarder payment with no consignment behind it is counted twice in the profit report — once as that leg’s cost, once here. Search by consignment number, receipt or seller.'
          : 'Optional. Search by consignment number, receipt or seller.'
      }
    >
      <Input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="e.g. CN-2026-08 or the seller’s name"
        // Loud only where leaving it empty is an actual error.
        className={prompt && term === '' ? 'border-status-pending-fg' : undefined}
      />
      {term.trim().length >= 2 && (
        <div className="border-border mt-1 max-h-44 overflow-y-auto rounded-md border">
          {results.isLoading ? (
            <p className="text-text-muted px-3 py-2 text-xs">Searching…</p>
          ) : (results.data ?? []).length === 0 ? (
            <p className="text-text-muted px-3 py-2 text-xs">
              No freight bill matches that. Leave it unlinked if this spend belongs to no
              consignment.
            </p>
          ) : (
            (results.data ?? []).map((f) => (
              <button
                key={f.id}
                type="button"
                className="hover:bg-surface-raised block w-full px-3 py-2 text-left"
                onClick={() => {
                  onChange(f);
                  setTerm('');
                }}
              >
                <div className="text-sm">{f.consignmentNumber ?? 'Consignment'}</div>
                <div className="text-text-muted text-xs">
                  {f.receiptNumber ?? 'no receipt number'} · billed {f.totalInr}
                  {f.ourCostInr === null ? ' · no cost recorded' : ` · cost ${f.ourCostInr}`}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </FormField>
  );
}
