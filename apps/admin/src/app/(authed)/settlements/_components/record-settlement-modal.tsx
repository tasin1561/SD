'use client';

import { useMemo, useState, type ReactElement } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  Button,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Money,
  Select,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
import { useCourierAccounts, useRecordSettlement } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

interface DraftLine {
  readonly key: number;
  readonly orderId: string;
  readonly settledInr: string;
}

/**
 * Record one courier payout and allocate it across the orders it
 * covers.
 *
 * The running allocated-vs-received difference is shown live, because
 * the whole value of this record is that the two match: a payout whose
 * lines don't add up to the amount that landed leaves an unexplained
 * remainder, and an unexplained remainder is indistinguishable from
 * money the courier kept.
 *
 * The UI does NOT block on a mismatch — a genuinely partial allocation
 * is a legitimate thing to record while you chase the rest. It just
 * refuses to let it happen silently.
 */
export function RecordSettlementModal({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactElement {
  const toast = useToast();
  const accounts = useCourierAccounts();
  const record = useRecordSettlement();

  const [courierAccountId, setCourierAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [amountInr, setAmountInr] = useState('');
  const [receivedAt, setReceivedAt] = useState(() => todayIso());
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<readonly DraftLine[]>([
    { key: 0, orderId: '', settledInr: '' },
  ]);
  const [error, setError] = useState<string | null>(null);

  const allocated = useMemo(
    () => lines.reduce((sum, l) => sum + (Number(l.settledInr) || 0), 0),
    [lines],
  );
  const received = Number(amountInr) || 0;
  const remainder = received - allocated;

  function reset(): void {
    setCourierAccountId('');
    setReference('');
    setAmountInr('');
    setReceivedAt(todayIso());
    setNote('');
    setLines([{ key: 0, orderId: '', settledInr: '' }]);
    setError(null);
  }

  function updateLine(key: number, patch: Partial<DraftLine>): void {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  const filled = lines.filter((l) => l.orderId.trim() !== '' && l.settledInr.trim() !== '');

  async function submit(): Promise<void> {
    setError(null);
    try {
      await record.mutateAsync({
        courierAccountId,
        reference: reference.trim(),
        amountInr: amountInr.trim(),
        receivedAt: new Date(receivedAt).toISOString(),
        lines: filled.map((l) => ({
          orderId: l.orderId.trim(),
          settledInr: l.settledInr.trim(),
        })),
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });
      toast.success('Payout recorded.');
      reset();
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
        if (!next) reset();
      }}
      size="lg"
      title="Record a courier payout"
      description="The bank credit that landed, and the orders it covers. The reference must be the courier's own UTR — it is what makes recording the same credit twice a refusal."
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Courier account" htmlFor="settle-account" required>
            <Select
              id="settle-account"
              value={courierAccountId}
              onChange={(e) => setCourierAccountId(e.target.value)}
            >
              <option value="">Choose an account…</option>
              {accounts.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} · {a.courierCode} ({a.environment.toLowerCase()})
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Received on" htmlFor="settle-date" required>
            <Input
              id="settle-date"
              type="date"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
            />
          </FormField>

          <FormField
            label="Payout reference (UTR)"
            htmlFor="settle-ref"
            hint="Unique per account."
            required
          >
            <Input
              id="settle-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="DLV-PAYOUT-2026-07-21"
              autoComplete="off"
            />
          </FormField>

          <FormField
            label="Amount received (INR)"
            htmlFor="settle-amount"
            hint="Exactly what landed in the bank."
            required
          >
            <Input
              id="settle-amount"
              inputMode="decimal"
              value={amountInr}
              onChange={(e) => setAmountInr(e.target.value)}
              placeholder="145320.00"
            />
          </FormField>
        </div>

        {/* ── allocation ── */}
        <div className="border-border border-t pt-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-text-muted text-xs font-medium tracking-wide uppercase">
              Allocation
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setLines((prev) => [
                  ...prev,
                  { key: (prev.at(-1)?.key ?? 0) + 1, orderId: '', settledInr: '' },
                ])
              }
            >
              <Plus size={13} aria-hidden /> Add order
            </Button>
          </div>

          <div className="space-y-2">
            {lines.map((line) => (
              <div key={line.key} className="flex items-center gap-2">
                <Input
                  aria-label="Order ID"
                  value={line.orderId}
                  onChange={(e) => updateLine(line.key, { orderId: e.target.value })}
                  placeholder="Order ID"
                  autoComplete="off"
                  className="flex-1"
                />
                <Input
                  aria-label="Amount attributed to this order"
                  inputMode="decimal"
                  value={line.settledInr}
                  onChange={(e) => updateLine(line.key, { settledInr: e.target.value })}
                  placeholder="0.00"
                  className="w-32 text-right"
                />
                <button
                  type="button"
                  aria-label="Remove this line"
                  onClick={() =>
                    setLines((prev) =>
                      prev.length === 1 ? prev : prev.filter((l) => l.key !== line.key),
                    )
                  }
                  disabled={lines.length === 1}
                  className="text-text-faint hover:text-[var(--color-critical)] disabled:opacity-30 shrink-0 rounded-[4px] p-1.5 transition-colors"
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
            ))}
          </div>

          {/* The reconciliation line. Reads as arithmetic, on purpose. */}
          <div className="border-border mt-3 flex items-center justify-between border-t pt-2 text-xs">
            <span className="text-text-muted">
              Allocated <Money amount={allocated} /> of <Money amount={received} /> received
            </span>
            {Math.abs(remainder) < 0.005 ? (
              <span className="text-[var(--status-delivered-fg)]">Fully allocated</span>
            ) : (
              <span className="text-[var(--status-pending-fg)]">
                {remainder > 0 ? 'Unexplained: ' : 'Over-allocated by: '}
                <Money amount={Math.abs(remainder)} />
              </span>
            )}
          </div>
        </div>

        <FormField label="Note" htmlFor="settle-note" hint="Optional.">
          <Textarea
            id="settle-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>

        {error !== null && <ErrorNote message={error} />}
      </div>

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          disabled={
            courierAccountId === '' ||
            reference.trim() === '' ||
            amountInr.trim() === '' ||
            filled.length === 0 ||
            record.isPending
          }
          onClick={() => void submit()}
        >
          {record.isPending ? 'Recording…' : 'Record payout'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
