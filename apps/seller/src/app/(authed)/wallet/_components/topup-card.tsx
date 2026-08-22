'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Select,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import { can } from '@/lib/page-access';
import { useSellerIdentity } from '@skydrop/auth/client';
import {
  usePresignTopupProof,
  useSubmitTopup,
  useTopupBankAccounts,
  useTopupRequests,
} from '@/lib/api-hooks';

/**
 * Adding money to the wallet.
 *
 * ── WAL-2, AND WHY THE COPY MATTERS ──────────────────────────────────
 * Submitting this is a CLAIM, not a payment. Nothing is credited until
 * somebody at Skydrop has matched it against the bank statement —
 * crediting on submission would let anyone raise their own balance with
 * a form, and the reversal would land after they had already withdrawn
 * against it.
 *
 * So the screen must never imply the money has arrived. The button says
 * "Tell us about a transfer", the toast says recorded rather than
 * credited, and the balance above deliberately does not move.
 *
 * ── A REFERENCE IS MANDATORY ─────────────────────────────────────────
 * The server requires a transaction ref OR a proof upload, because
 * without one there is nothing to match against the statement and the
 * claim can never be resolved either way. The form enforces the same
 * thing at the button so a seller is not told after typing everything.
 *
 * Until this existed the endpoints had no caller at all: COD was the
 * only way a balance could rise, while order charges, RTO fees and
 * inbound freight all debited it.
 */
/**
 * Every top-up the seller has claimed, whatever became of it.
 *
 * The modal is driven from OUTSIDE — the action lives up in the balance
 * row, where a seller looks when they want to move money, rather than
 * buried beside the list of what they already sent.
 *
 * Pending and rejected claims live HERE and never in the ledger. That
 * is not a filter: a claim is not a payment, so no wallet entry exists
 * until an operator matches it against the statement. The ledger showing
 * only accepted top-ups is a property of when the entry is written, not
 * something this view chooses.
 */
export function TopupCard({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactElement | null {
  const identity = useSellerIdentity();
  const toast = useToast();
  const banks = useTopupBankAccounts();
  const requests = useTopupRequests();
  const presign = usePresignTopupProof();
  const submit = useSubmitTopup();

  const [bankAccountId, setBankAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [transactionRef, setTransactionRef] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Cosmetic (FE-2): the wallet page opens on wallet.view; submitting
  // needs wallet.topup, which finance and owner hold and others do not.
  if (!can(identity, 'wallet.topup')) return null;

  function reset(): void {
    setBankAccountId('');
    setAmount('');
    setTransactionRef('');
    setProof(null);
    setError(null);
  }

  const amountNum = Number(amount);
  const amountValid = amount.trim() !== '' && Number.isFinite(amountNum) && amountNum >= 0.01;
  // Mirrors the server's own rule rather than inventing a stricter one.
  const hasReference = transactionRef.trim() !== '' || proof !== null;
  const canSubmit = bankAccountId !== '' && amountValid && hasReference && !busy;

  async function onSubmit(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      let proofSpacesKey: string | undefined;
      let proofMimeType: string | undefined;

      if (proof !== null) {
        // Presign → PUT straight to Spaces → submit the key. The upload
        // does NOT go through our origin, so it is a bare fetch rather
        // than the ApiClient (same shape as the catalog image flow).
        const signed = await presign.mutateAsync({ mimeType: proof.type });
        const put = await fetch(signed.uploadUrl, {
          method: 'PUT',
          body: proof,
          headers: { 'content-type': proof.type },
        });
        if (!put.ok) throw new Error(`Proof upload failed (${put.status})`);
        proofSpacesKey = signed.spacesKey;
        proofMimeType = proof.type;
      }

      await submit.mutateAsync({
        bankAccountId,
        amount: amountNum,
        ...(transactionRef.trim() ? { transactionRef: transactionRef.trim() } : {}),
        // Both keys or neither: proofMimeType is only meaningful with a
        // key, and under exactOptionalPropertyTypes an explicit
        // undefined is not the same as an absent field.
        ...(proofSpacesKey !== undefined && proofMimeType !== undefined
          ? { proofSpacesKey, proofMimeType }
          : {}),
      });
      onOpenChange(false);
      reset();
      // "Recorded", never "credited" — the balance has not moved.
      toast.success('Transfer recorded. We will credit it once we see it on our statement.');
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { code?: string; message?: string } | undefined;
        setError(body?.code ? `[${body.code}] ${body.message ?? err.message}` : err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    } finally {
      setBusy(false);
    }
  }

  const rows = requests.data ?? [];
  const selectedBank = (banks.data ?? []).find((b) => b.id === bankAccountId);

  return (
    <Card>
      <CardBody>
        {rows.length === 0 ? (
          <p className="text-text-muted py-2 text-sm">
            No transfers recorded yet. Send money to one of our accounts, then tell us here — we
            credit it once it shows on our statement, so it is not instant.
          </p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Sent</Th>
                <Th>To</Th>
                <Th align="right">Amount</Th>
                <Th>Reference</Th>
                <Th>Status</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="text-text-muted text-xs">
                    {new Date(r.createdAt).toISOString().slice(0, 10)}
                  </Td>
                  <Td className="text-text-body">{r.bankLabel}</Td>
                  <Td align="right" className="font-mono">
                    {r.amount}
                  </Td>
                  <Td className="text-text-faint font-mono text-xs">
                    {r.transactionRef ?? (r.hasProof ? 'proof attached' : '—')}
                  </Td>
                  <Td>
                    <span className="text-text-body text-xs">{r.status}</span>
                    {/* A rejection is only useful if the reason travels
                        with it — otherwise the seller resubmits the same
                        thing. */}
                    {r.reviewNote !== null && r.reviewNote !== '' && (
                      <div className="text-text-faint mt-0.5 text-xs">{r.reviewNote}</div>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}

        <Modal
          open={open}
          onOpenChange={(next) => {
            if (!next) {
              onOpenChange(false);
              reset();
            }
          }}
          title="Tell us about a transfer"
        >
          <p className="text-text-muted mb-3 text-sm">
            Send the money first, then record it here. Nothing is added to your balance until we
            match it against our bank statement.
          </p>

          {error !== null && (
            <div className="border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] text-critical mb-3 rounded-md border px-3 py-2 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-3">
            {/* A dropdown with nothing in it is a dead end: the seller
                cannot proceed and is told nothing about why. This is not
                their mistake to fix, so it says who has to. */}
            {!banks.isLoading && (banks.data ?? []).length === 0 ? (
              <div className="border-border text-text-muted rounded-md border px-3 py-2 text-sm">
                We have not published a bank account yet, so there is nowhere to send money. Please
                contact support before transferring anything — a payment we have not published an
                account for is one we cannot match to you.
              </div>
            ) : (
              <FormField label="Which account you paid into" required>
                <Select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
                  <option value="">
                    {banks.isLoading ? 'Loading accounts…' : 'Choose an account…'}
                  </option>
                  {(banks.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label} — {b.bankName} ({b.currency})
                    </option>
                  ))}
                </Select>
              </FormField>
            )}

            {/* Shown after choosing, so the seller can check they sent it
                to the right place before claiming it. */}
            {selectedBank !== undefined && (
              <div className="border-border text-text-muted rounded-md border px-3 py-2 text-xs">
                {/* Everything the seller has to type into their bank.
                    They read it off this screen, so a missing branch or
                    routing number is a transfer that goes nowhere — or
                    worse, somewhere we cannot match to them. */}
                <div className="text-text-body font-mono">{selectedBank.accountNumber}</div>
                <div>{selectedBank.accountName}</div>
                {(selectedBank.branchName !== null || selectedBank.district !== null) && (
                  <div>
                    {[selectedBank.branchName, selectedBank.district].filter(Boolean).join(' · ')}
                    {selectedBank.branchName !== null ? ' branch' : ''}
                  </div>
                )}
                {selectedBank.routingNumber !== null && (
                  <div>
                    Routing{' '}
                    <span className="text-text-body font-mono">{selectedBank.routingNumber}</span>
                  </div>
                )}
                {selectedBank.branchCode !== null && (
                  <div>
                    IFSC/SWIFT{' '}
                    <span className="text-text-body font-mono">{selectedBank.branchCode}</span>
                  </div>
                )}
                {selectedBank.instructions !== null && (
                  <div className="mt-1">{selectedBank.instructions}</div>
                )}
              </div>
            )}

            {/* The amount is in the currency of the account they are
                wiring TO — that is the number on their bank transfer.
                Naming it stops a seller typing rupees against a taka
                account. We convert it to rupees when we credit it. */}
            <FormField
              label={`Amount (${selectedBank?.currency === 'BDT' ? '৳' : '₹'})`}
              hint="What you are transferring, in the currency of the account above."
              required
            >
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </FormField>

            <FormField
              label="Transaction reference / UTR"
              hint="Either this or a receipt — without one we cannot find your payment on the statement."
            >
              <Input
                value={transactionRef}
                onChange={(e) => setTransactionRef(e.target.value)}
                maxLength={120}
              />
            </FormField>

            <FormField
              label="Receipt"
              hint="A screenshot or PDF of the transfer. Optional if you gave a reference."
            >
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setProof(e.target.files?.[0] ?? null)}
                className="text-text-muted text-sm"
              />
            </FormField>

            {!hasReference && (
              <p className="text-text-faint text-xs">Add a reference or a receipt to continue.</p>
            )}
          </div>

          <ModalFooter>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                onOpenChange(false);
                reset();
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={!canSubmit}
              onClick={() => void onSubmit()}
            >
              {busy ? 'Recording…' : 'Record this transfer'}
            </Button>
          </ModalFooter>
        </Modal>
      </CardBody>
    </Card>
  );
}
