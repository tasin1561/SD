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
  const [bankAccountId, setBankAccountId] = useState('');
  const [amountInr, setAmountInr] = useState(row.ourCostInr ?? '');
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inr = (banks.data ?? []).filter((b) => b.currency === 'INR');

  async function save(): Promise<void> {
    setError(null);
    if (bankAccountId === '' || amountInr.trim() === '' || Number.isNaN(Number(amountInr))) {
      setError('Choose the account and enter what was paid');
      return;
    }
    try {
      await pay.mutateAsync({
        freightChargeId: row.id,
        bankAccountId,
        amountInr: Number(amountInr).toFixed(2),
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
            {inr.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label} · {b.bankName}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Amount paid (₹)"
            required
            hint={
              row.ourCostInr === null
                ? 'This also fills in our cost for the leg'
                : 'Our recorded cost is left as it is — a part payment does not restate the invoice'
            }
          >
            <Input
              type="number"
              step="0.01"
              min="0"
              value={amountInr}
              onChange={(e) => setAmountInr(e.target.value)}
              placeholder="e.g. 8500.00"
              autoFocus
            />
          </FormField>
          <FormField label="Date paid" required>
            <Input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </FormField>
        </div>
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
