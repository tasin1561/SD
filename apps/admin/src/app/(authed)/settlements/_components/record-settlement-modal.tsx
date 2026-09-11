'use client';

import { useMemo, useState, type ReactElement } from 'react';
import { Plus, Trash2, Upload } from 'lucide-react';
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
import {
  useCourierAccounts,
  usePreviewRemittance,
  useRecordSettlement,
  type RemittancePreview,
  type RemittanceRow,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

interface DraftLine {
  readonly key: number;
  readonly orderId: string;
  readonly settledInr: string;
}

/** A file's bytes as base64, in chunks so a large file does not overflow the call stack. */
async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
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
  /**
   * What the courier kept back before paying, from its own file. The
   * early-COD fee is booked as an expense; freight taken from COD is a
   * wallet top-up (it pays for parcels the wallet ledger already costs);
   * an RTO reversal takes back COD a seller was credited, so it must name
   * the orders — each seller is debited back exactly.
   */
  const [kept, setKept] = useState<KeptBack>(NO_KEPT_BACK);
  const [reversals, setReversals] = useState<readonly DraftLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const preview = usePreviewRemittance();
  const [skipped, setSkipped] = useState<readonly RemittanceRow[]>([]);
  const [fileNotes, setFileNotes] = useState<Pick<
    RemittancePreview,
    'summary' | 'warnings'
  > | null>(null);

  /**
   * Read the courier's own remittance export instead of retyping it.
   *
   * Matching is on the WAYBILL — the identifier both sides agree on.
   * The file's "Order Number" is the seller's free-text name for the
   * parcel and is never matched against.
   *
   * Rows we cannot place are kept and SHOWN rather than dropped: a file
   * covering ten parcels where eight are recognised is the normal case,
   * and silently allocating eight is how a payout gets recorded short
   * with the difference discovered weeks later.
   */
  async function loadFile(file: File): Promise<void> {
    setError(null);
    const courier = accounts.data?.find((a) => a.id === courierAccountId)?.courierCode;
    if (courier === undefined) {
      setError('Choose the courier account first — the file is read in its own format.');
      return;
    }
    setFileNotes(null);
    try {
      // Sent exactly as downloaded: Shiprocket's export is a binary .xls,
      // which reading as text would corrupt. The server recognises the
      // format from the bytes.
      const out = await preview.mutateAsync({
        courierCode: courier,
        fileBase64: await toBase64(file),
        fileName: file.name,
      });
      setFileNotes({ summary: out.summary, warnings: out.warnings });
      // Unlike the amount, these ARE filled from the file: the bank
      // statement shows only the net, so the courier's own breakdown is
      // the only source of what it kept, and the operator can still edit.
      setKept(
        out.summary === null
          ? NO_KEPT_BACK
          : {
              earlyCodFeeInr: nonZero(out.summary.earlyCodFeeInr),
              freightInr: nonZero(out.summary.freightInr),
              rtoReversalInr: nonZero(out.summary.rtoReversalInr),
            },
      );
      const usable = out.rows.filter((r) => r.problem === null && r.orderId !== null);
      setLines(
        usable.map((r, i) => ({
          key: i,
          orderId: r.orderId ?? '',
          settledInr: r.settledInr,
        })),
      );
      setSkipped(out.rows.filter((r) => r.problem !== null));
      // The amount stays the OPERATOR's to type: the file is the
      // courier's claim, the bank statement is the fact, and they can
      // differ. Pre-filling it would quietly make the claim the truth.
      if (usable.length === 0) {
        setError(`Nothing in this file could be matched to an order (${out.rows.length} rows).`);
      }
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  const allocated = useMemo(
    () => lines.reduce((sum, l) => sum + (Number(l.settledInr) || 0), 0),
    [lines],
  );
  const received = Number(amountInr) || 0;
  const namedReversals = reversals.filter(
    (r) => r.orderId.trim() !== '' && r.settledInr.trim() !== '',
  );
  const reversedTotal = namedReversals.reduce((sum, r) => sum + (Number(r.settledInr) || 0), 0);
  const keptTotal =
    (Number(kept.earlyCodFeeInr) || 0) +
    (Number(kept.freightInr) || 0) +
    // The orders named are what is booked; the file's figure is a check.
    (namedReversals.length > 0 ? reversedTotal : Number(kept.rtoReversalInr) || 0);
  // What landed plus what the courier kept should be exactly the COD of
  // the orders it covers.
  const remainder = received + keptTotal - allocated;

  function reset(): void {
    setCourierAccountId('');
    setReference('');
    setAmountInr('');
    setReceivedAt(todayIso());
    setNote('');
    setLines([{ key: 0, orderId: '', settledInr: '' }]);
    setKept(NO_KEPT_BACK);
    setReversals([]);
    setError(null);
    setSkipped([]);
    setFileNotes(null);
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
        ...(keptTotal > 0
          ? {
              deductions: {
                ...(kept.earlyCodFeeInr.trim() === ''
                  ? {}
                  : { earlyCodFeeInr: kept.earlyCodFeeInr.trim() }),
                ...(kept.freightInr.trim() === '' ? {} : { freightInr: kept.freightInr.trim() }),
                ...(kept.rtoReversalInr.trim() === ''
                  ? {}
                  : { rtoReversalInr: kept.rtoReversalInr.trim() }),
                ...(namedReversals.length === 0
                  ? {}
                  : {
                      rtoReversals: namedReversals.map((r) => ({
                        orderId: r.orderId.trim(),
                        amountInr: r.settledInr.trim(),
                      })),
                    }),
              },
            }
          : {}),
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

          <label className="border-border mb-3 flex cursor-pointer items-center gap-2 rounded-[10px] border border-dashed px-3 py-2 text-xs">
            <Upload size={14} aria-hidden className="text-text-muted" />
            <span className="text-text-muted">
              {preview.isPending
                ? 'Reading the file…'
                : 'Upload the courier’s remittance export — matched on waybill'}
            </span>
            <input
              type="file"
              accept=".csv,text/csv,.xls,application/vnd.ms-excel,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f !== undefined) void loadFile(f);
                e.target.value = '';
              }}
            />
          </label>

          {fileNotes !== null && (fileNotes.summary !== null || fileNotes.warnings.length > 0) && (
            <div className="border-border mb-3 rounded-[10px] border p-2 text-xs">
              {fileNotes.summary !== null && (
                // Shown, never filled in: the file is the courier's claim,
                // the bank statement is the fact, and the operator types
                // the reference and amount from the latter.
                <div className="text-text-body">
                  The file says: UTR{' '}
                  <span className="font-mono">
                    {fileNotes.summary.references.join(', ') || '—'}
                  </span>{' '}
                  · collected <Money amount={fileNotes.summary.codInr} /> · kept back{' '}
                  <Money amount={fileNotes.summary.deductedInr} /> · remitted{' '}
                  <Money amount={fileNotes.summary.remittedInr} />
                </div>
              )}
              {fileNotes.warnings.length > 0 && (
                <ul className="text-text-muted mt-1 list-disc space-y-0.5 pl-4">
                  {fileNotes.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {skipped.length > 0 && (
            <div className="border-border mb-3 rounded-[10px] border p-2 text-xs">
              <div className="text-text-body mb-1 font-medium">
                {skipped.length} row(s) in the file were not allocated
              </div>
              {/* Named, not counted. "8 of 10 matched" tells an operator
                  there is a problem; naming the waybills tells them
                  which one to chase. */}
              <ul className="text-text-muted space-y-0.5">
                {skipped.slice(0, 8).map((r) => (
                  <li key={r.line}>
                    <span className="font-mono">{r.awbNumber}</span> — {r.problem}
                  </li>
                ))}
                {skipped.length > 8 && <li>…and {skipped.length - 8} more</li>}
              </ul>
            </div>
          )}

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

          {/* What the courier kept back before paying. */}
          <div className="border-border mt-3 border-t pt-3">
            <h3 className="text-text-muted mb-2 text-xs font-medium tracking-wide uppercase">
              Kept back by the courier
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField
                label="Early-COD fee"
                htmlFor="settle-kept-fee"
                hint="Booked as an expense (Courier COD fees)."
              >
                <Input
                  id="settle-kept-fee"
                  inputMode="decimal"
                  value={kept.earlyCodFeeInr}
                  onChange={(e) => setKept((k) => ({ ...k, earlyCodFeeInr: e.target.value }))}
                  placeholder="0.00"
                />
              </FormField>
              <FormField
                label="Freight from COD"
                htmlFor="settle-kept-freight"
                hint="Booked as a courier wallet top-up."
              >
                <Input
                  id="settle-kept-freight"
                  inputMode="decimal"
                  value={kept.freightInr}
                  onChange={(e) => setKept((k) => ({ ...k, freightInr: e.target.value }))}
                  placeholder="0.00"
                />
              </FormField>
              <FormField
                label="RTO reversal"
                htmlFor="settle-kept-rto"
                hint="The file's total — name the orders below."
              >
                <Input
                  id="settle-kept-rto"
                  inputMode="decimal"
                  value={kept.rtoReversalInr}
                  onChange={(e) => setKept((k) => ({ ...k, rtoReversalInr: e.target.value }))}
                  placeholder="0.00"
                />
              </FormField>
            </div>

            {/* Each reversed order: its seller's COD credit is taken back
                and our tax and fee on it returned, so it must be exact. */}
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-text-muted text-xs">
                  Orders whose COD was reversed
                  {namedReversals.length > 0 && (
                    <>
                      {' '}
                      · <Money amount={reversedTotal} />
                    </>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setReversals((prev) => [
                      ...prev,
                      { key: (prev.at(-1)?.key ?? 0) + 1, orderId: '', settledInr: '' },
                    ])
                  }
                >
                  <Plus size={13} aria-hidden /> Add reversed order
                </Button>
              </div>
              <div className="space-y-2">
                {reversals.map((r) => (
                  <div key={r.key} className="flex items-center gap-2">
                    <Input
                      aria-label="Reversed order ID"
                      value={r.orderId}
                      onChange={(e) =>
                        setReversals((prev) =>
                          prev.map((x) =>
                            x.key === r.key ? { ...x, orderId: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="Order ID"
                      autoComplete="off"
                      className="flex-1"
                    />
                    <Input
                      aria-label="COD reversed for this order"
                      inputMode="decimal"
                      value={r.settledInr}
                      onChange={(e) =>
                        setReversals((prev) =>
                          prev.map((x) =>
                            x.key === r.key ? { ...x, settledInr: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="0.00"
                      className="w-32 text-right"
                    />
                    <button
                      type="button"
                      aria-label="Remove this reversed order"
                      onClick={() => setReversals((prev) => prev.filter((x) => x.key !== r.key))}
                      className="text-text-faint hover:text-[var(--color-critical)] shrink-0 rounded-[4px] p-1.5 transition-colors"
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* The reconciliation line. Reads as arithmetic, on purpose. */}
          <div className="border-border mt-3 flex items-center justify-between border-t pt-2 text-xs">
            <span className="text-text-muted">
              Allocated <Money amount={allocated} /> of <Money amount={received} /> received
              {keptTotal > 0 && (
                <>
                  {' '}
                  + <Money amount={keptTotal} /> kept back
                </>
              )}
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

interface KeptBack {
  readonly earlyCodFeeInr: string;
  readonly freightInr: string;
  readonly rtoReversalInr: string;
}

const NO_KEPT_BACK: KeptBack = { earlyCodFeeInr: '', freightInr: '', rtoReversalInr: '' };

/** A file's "0.00" reads as blank, so an untouched field stays empty. */
function nonZero(v: string): string {
  return Number(v) === 0 ? '' : v;
}
