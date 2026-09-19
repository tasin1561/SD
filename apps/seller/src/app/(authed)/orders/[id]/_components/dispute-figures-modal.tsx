'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Select,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
import { useRaiseStoreDispute } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

const MIN_SUBJECT = 3;

/**
 * RS-7 (2026-09-19) — Seller staff raise a dispute with the reseller
 * store about ONE of its orders.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS A DISPUTE ────────────────────────
 * Once a reseller order's credits are CREDITED, the money on it cannot
 * be re-worked-out: `seller_wallet_entries_once_per_order_uq` allows
 * each direction once per order, which is the guard against paying an
 * order twice, and a correction that reversed and rewrote a credit would
 * need a second one. So a paid order whose figures are wrong is settled
 * BETWEEN the two wallets through the dispute Skydrop already referees —
 * the same path, the same guardrails, one place where money moves.
 *
 * The STORE is not named here. It is read off the order by the server,
 * so a dispute cannot be filed against a store that had nothing to do
 * with it.
 *
 * The claim is a CLAIM. Skydrop settles with its own figure; what this
 * carries is what the seller says is owed, beside the money as it stood
 * when they said it, so the settlement is not typed from nothing.
 */
export function DisputeFiguresModal({
  open,
  onOpenChange,
  orderId,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly orderId: string;
}): ReactElement {
  const toast = useToast();
  const raise = useRaiseStoreDispute();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [correction, setCorrection] = useState(true);
  const [claimAmount, setClaimAmount] = useState('');
  const [claimPayer, setClaimPayer] = useState<'STORE' | 'SELLER'>('STORE');
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setSubject('');
    setDescription('');
    setCorrection(true);
    setClaimAmount('');
    setClaimPayer('STORE');
    setError(null);
  }

  async function submit(): Promise<void> {
    setError(null);
    try {
      await raise.mutateAsync({
        orderId,
        subject: subject.trim(),
        ...(description.trim() === '' ? {} : { description: description.trim() }),
        ...(correction
          ? {
              disputeKind: 'FIGURE_CORRECTION' as const,
              claimAmountInr: claimAmount.trim(),
              claimPayer,
            }
          : {}),
      });
      toast.success('Raised with the store. Skydrop will referee it.');
      reset();
      onOpenChange(false);
    } catch (err) {
      // FE-2 — the server's own verdict, verbatim.
      setError(serverVerdict(err));
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title="Raise this with the store"
      description="Skydrop referees it. A settlement moves money between your wallet and the store’s — never ours."
    >
      <div className="space-y-3">
        <label className="border-border flex cursor-pointer items-start gap-2 rounded-[var(--radius-2)] border px-3 py-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={correction}
            onChange={(e) => setCorrection(e.target.checked)}
          />
          <span>
            <span className="text-text-strong block text-sm">
              The money worked out on this order is wrong
            </span>
            <span className="text-text-muted block text-xs leading-relaxed">
              Say what you think is owed and who owes it. We record the order&rsquo;s figures as
              they stand now, so the settlement is argued from what was on the table.
            </span>
          </span>
        </label>

        {correction ? (
          <div className="flex flex-wrap items-end gap-2.5">
            <FormField
              label="How much"
              htmlFor="dispute-claim-amount"
              hint="₹, up to 2 decimals"
              className="w-[160px]"
            >
              <Input
                id="dispute-claim-amount"
                inputMode="decimal"
                value={claimAmount}
                onChange={(e) => setClaimAmount(e.target.value)}
                placeholder="120.00"
              />
            </FormField>
            <FormField label="Who owes it" htmlFor="dispute-claim-payer" className="w-[190px]">
              <Select
                id="dispute-claim-payer"
                value={claimPayer}
                onChange={(e) => setClaimPayer(e.target.value === 'SELLER' ? 'SELLER' : 'STORE')}
              >
                <option value="STORE">The store owes us</option>
                <option value="SELLER">We owe the store</option>
              </Select>
            </FormField>
          </div>
        ) : null}

        <FormField label="What is wrong" htmlFor="dispute-subject">
          <Input
            id="dispute-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            placeholder="The transfer price on this order is short"
          />
        </FormField>
        <FormField label="Tell us more" htmlFor="dispute-description">
          <Textarea
            id="dispute-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={4000}
            rows={4}
          />
        </FormField>
        {error !== null ? <ErrorNote message={error} /> : null}
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={raise.isPending}>
          Cancel
        </Button>
        <Button
          onClick={() => void submit()}
          disabled={raise.isPending || subject.trim().length < MIN_SUBJECT}
        >
          {raise.isPending ? 'Raising…' : 'Raise it'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
