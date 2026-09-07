'use client';

import { useState, type ReactElement } from 'react';
import { Banknote } from 'lucide-react';
import {
  Button,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Money,
  Select,
} from '@skydrop/ui/components';
import { usePayForwarder, useSetFreightOurCost, type FreightChargeView } from '@/lib/ops-hooks';
import { usePlatformBankAccounts } from '@/lib/bank-account-hooks';
import { useFxRatesList } from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';

/**
 * What the FORWARDER charged us, against what we billed the seller.
 *
 * ── TWO ROUTES, AND THE PROMINENT ONE IS THE RIGHT ONE ───────────────
 * **Record payment** writes the bank entry, attributes it to this bill
 * and fills in the cost, in one transaction. That link is what stops the
 * P&L counting the same rupees twice — once as this leg's cost and again
 * in operating expenses — which is what happened when the cash was
 * recorded on /expenses and the cost typed in here separately.
 *
 * **Cost only** stays for the case it was built for: their invoice
 * routinely arrives weeks before it is paid, and the margin should not
 * wait on the bank. It is deliberately the quieter of the two, because
 * the number without the cash is the half that leaves the books
 * incomplete.
 *
 * Both are editable at any point in the bill's life, including after
 * settlement: what the seller paid is an independent fact from what we
 * paid, and blocking either on the other would only produce a guess. A
 * guessed cost is worse than a missing one — the P&L can say "not
 * measured", it cannot say "measured, but made up".
 */
export function OurCostCell({ row }: { readonly row: FreightChargeView }): ReactElement {
  // Read here rather than threaded down: the gate is cosmetic (FE-2 —
  // the server is the boundary), and a prop through every row exists
  // only to be forgotten on the next one added.
  const canWrite = usePermission('money.freight.manage');
  const [costOpen, setCostOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const margin = row.ourCostInr === null ? null : Number(row.totalInr) - Number(row.ourCostInr);

  return (
    <>
      {row.ourCostInr === null ? (
        canWrite ? (
          <div className="flex flex-col items-end gap-1">
            {/* Loud on purpose. An unrecorded forwarder cost makes this
                consignment read as pure profit, and nothing else on the
                page says so. */}
            <Button size="sm" onClick={() => setPayOpen(true)}>
              <Banknote className="size-3.5" /> Record payment
            </Button>
            <button
              type="button"
              className="text-text-muted hover:text-text text-xs underline underline-offset-2"
              onClick={() => setCostOpen(true)}
            >
              cost only, not paid yet
            </button>
          </div>
        ) : (
          <span className="text-status-pending-fg text-xs">Not recorded</span>
        )
      ) : (
        <div className="flex flex-col items-end gap-0.5">
          <button
            type="button"
            className="text-right disabled:cursor-default"
            onClick={() => canWrite && setCostOpen(true)}
            disabled={!canWrite}
          >
            <Money amount={row.ourCostInr} />
            {margin !== null && (
              <div
                className={`text-xs ${margin < 0 ? 'text-danger' : 'text-text-muted'}`}
                title="What we billed the seller, less what the forwarder charged us"
              >
                {margin < 0 ? '' : '+'}
                {margin.toFixed(2)} margin
              </div>
            )}
          </button>
          {canWrite && (
            <button
              type="button"
              className="text-text-muted hover:text-text text-xs underline underline-offset-2"
              onClick={() => setPayOpen(true)}
            >
              record a payment
            </button>
          )}
        </div>
      )}

      {costOpen && <CostOnlyModal row={row} onClose={() => setCostOpen(false)} />}
      {payOpen && <PayForwarderModal row={row} onClose={() => setPayOpen(false)} />}
    </>
  );
}

/** The number only — for an invoice that has arrived but is not paid. */
function CostOnlyModal({
  row,
  onClose,
}: {
  readonly row: FreightChargeView;
  readonly onClose: () => void;
}): ReactElement {
  const set = useSetFreightOurCost();
  const [value, setValue] = useState(row.ourCostInr ?? '');
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setError(null);
    if (value.trim() === '' || Number.isNaN(Number(value))) {
      setError('Enter what the forwarder charged, in INR');
      return;
    }
    try {
      await set.mutateAsync({ freightChargeId: row.id, ourCostInr: Number(value).toFixed(2) });
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="What did the forwarder charge us?"
      description="The cost only — no money is recorded as leaving any account. Use this when their invoice has arrived but has not been paid; record the payment itself when it goes out, so the cash and the cost stay together."
    >
      <Input
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. 8500.00"
        autoFocus
      />
      <p className="text-text-muted mt-2 text-xs">
        Billed to the seller: <Money amount={row.totalInr} />
      </p>
      {error !== null && <p className="text-danger mt-2 text-sm">{error}</p>}
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={set.isPending}>
          {set.isPending ? 'Saving…' : 'Save'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/** The cash and the attribution, in one act. */
function PayForwarderModal({
  row,
  onClose,
}: {
  readonly row: FreightChargeView;
  readonly onClose: () => void;
}): ReactElement {
  const pay = usePayForwarder();
  const banks = usePlatformBankAccounts(usePermission('money.view'));
  // Read unconditionally — `a && usePermission(b)` short-circuits, which
  // skips a hook call and changes the hook ORDER between renders.
  const canReadFx = usePermission('fx.view');
  const [bankAccountId, setBankAccountId] = useState('');
  const [amountPaid, setAmountPaid] = useState(row.ourCostInr ?? '');
  const [costInr, setCostInr] = useState('');
  /*
    The rate used to reach the INR figure.

    Typed here rather than only pulled from the FX table, because the
    rate that matters is the one the BANK gave on this transfer — not
    the one posted that morning. It is PRE-FILLED from the current rate
    so the ordinary case is one keystroke, and the INR box stays
    editable underneath: a bank charge shows up as an INR figure that
    does not match rate × amount, and that difference is a real cost
    (TRE-5) rather than something to round away.
  */
  const [rate, setRate] = useState('');
  const [rateTouched, setRateTouched] = useState(false);
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  // EVERY active account, not just the INR ones. The forwarder is a
  // Bangladeshi business and is routinely paid in BDT from a BDT
  // account; filtering those out made the ordinary case unrecordable.
  const accounts = (banks.data ?? []).filter((b) => b.isActive);
  const account = accounts.find((b) => b.id === bankAccountId);
  const crossCurrency = account !== undefined && account.currency !== 'INR';
  const fx = useFxRatesList(canReadFx && crossCurrency);
  /*
    Quoted as ₹1 = X of theirs — the direction the FX page uses and the
    one people here think in. It is also the direction the table stores
    for BDT, so the ordinary case needs no reciprocal at all; the
    fallback covers a pair stored the other way round.

    The INR cost is therefore amount ÷ rate, NOT amount × rate. Getting
    that backwards on a 1.23 rate lands in the same ballpark as the
    right answer, which is exactly the kind of error that survives a
    glance.
  */
  const posted =
    account === undefined
      ? null
      : ((): string | null => {
          const direct = (fx.data ?? []).find(
            (r) => r.fromCurrency === 'INR' && r.toCurrency === account.currency,
          );
          if (direct !== undefined) return Number(direct.rate).toFixed(4);
          const inverse = (fx.data ?? []).find(
            (r) => r.fromCurrency === account.currency && r.toCurrency === 'INR',
          );
          return inverse === undefined || Number(inverse.rate) === 0
            ? null
            : (1 / Number(inverse.rate)).toFixed(4);
        })();

  const effectiveRate = rateTouched || rate !== '' ? rate : (posted ?? '');
  // Shown beside the INR box rather than forced into it, so a figure
  // read off a statement is never silently overwritten by an
  // arithmetic one.
  const computed =
    effectiveRate !== '' &&
    amountPaid !== '' &&
    Number.isFinite(Number(effectiveRate)) &&
    Number(effectiveRate) > 0
      ? (Number(amountPaid) / Number(effectiveRate)).toFixed(2)
      : null;

  // The INR figure follows the rate until somebody types over it. Not a
  // one-way binding: once edited it stays edited, because a statement
  // figure must never be silently replaced by an arithmetic one.
  const [costTouched, setCostTouched] = useState(false);
  const shownCost = costTouched ? costInr : (computed ?? costInr);

  async function save(): Promise<void> {
    setError(null);
    if (bankAccountId === '' || amountPaid.trim() === '' || Number.isNaN(Number(amountPaid))) {
      setError('Choose the account and enter what was paid');
      return;
    }
    if (crossCurrency && (shownCost.trim() === '' || Number.isNaN(Number(shownCost)))) {
      setError('Enter what the payment cost in INR — the P&L is in INR');
      return;
    }
    try {
      await pay.mutateAsync({
        freightChargeId: row.id,
        bankAccountId,
        amountPaid: Number(amountPaid).toFixed(2),
        ...(crossCurrency ? { costInr: Number(shownCost).toFixed(2) } : {}),
        occurredAt: new Date(`${occurredAt}T00:00:00Z`).toISOString(),
        ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
      });
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Pay the forwarder"
      description="Records the money leaving the account AND attributes it to this consignment, in one step. Recording it as a loose expense instead would count the same cost twice in the P&L — once here, once in operating expenses."
    >
      <div className="space-y-4">
        <FormField label="Paid from" required>
          <Select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
            <option value="">Choose an account…</option>
            {accounts.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label} · {b.bankName} · {b.currency}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={`Amount paid${account === undefined ? '' : ` (${account.currency})`}`}
            required
            hint={
              crossCurrency
                ? 'What actually left that account, in its own currency'
                : row.ourCostInr === null
                  ? 'This also fills in our cost for the leg'
                  : 'Our recorded cost is left as it is — a part payment does not restate the invoice'
            }
          >
            <Input
              type="number"
              step="0.01"
              min="0"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
              placeholder="e.g. 8500.00"
              autoFocus
            />
          </FormField>
          <FormField label="Date paid" required>
            <Input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </FormField>
        </div>
        {crossCurrency && account !== undefined && (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={`Rate (₹1 = ${account.currency})`}
              required
              hint={
                posted === null
                  ? 'No posted rate found — enter the rate the bank gave you.'
                  : `Posted rate ₹1 = ${posted} ${account.currency}. Change it to the rate the bank actually gave.`
              }
            >
              <Input
                type="number"
                step="0.000001"
                min="0"
                value={effectiveRate}
                onChange={(e) => {
                  setRateTouched(true);
                  setRate(e.target.value);
                  // Typing a rate re-takes control of the INR box, so a
                  // corrected rate is not ignored because a stale
                  // computed figure had already been "touched".
                  setCostTouched(false);
                }}
                placeholder={posted ?? 'e.g. 1.2300'}
              />
            </FormField>
            <FormField
              label="What it cost us (₹)"
              required
              hint={
                computed !== null && shownCost !== computed
                  ? `Amount ÷ rate is ₹${computed} — the difference is the bank's charge, and recording it is the point.`
                  : 'Worked out from the rate. Overwrite it with the INR figure on the statement if they differ.'
              }
            >
              <Input
                type="number"
                step="0.01"
                min="0"
                value={shownCost}
                onChange={(e) => {
                  setCostTouched(true);
                  setCostInr(e.target.value);
                }}
                placeholder="e.g. 6200.00"
              />
            </FormField>
          </div>
        )}
        <FormField label="Reference" hint="Their invoice number or the bank's transaction id">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </FormField>
        <p className="text-text-muted text-xs">
          Billed to the seller for this consignment: <Money amount={row.totalInr} />
        </p>
        {error !== null && <p className="text-danger text-sm">{error}</p>}
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={pay.isPending}>
          {pay.isPending ? 'Recording…' : 'Record the payment'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
