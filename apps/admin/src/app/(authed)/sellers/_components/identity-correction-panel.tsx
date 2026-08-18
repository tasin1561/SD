'use client';

import { useState, type ReactElement } from 'react';
import { PencilLine } from 'lucide-react';
import { useUpdateSellerIdentity } from '@/lib/api-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { Button, FormField, Input, Modal, ModalFooter, Textarea } from '@skydrop/ui/components';

/**
 * Correct the company name / phone a seller was APPROVED under.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────
 * Both fields are non-editable by the seller. They are the identity an
 * admin approved, and a seller silently rewriting them turns the
 * approved entity into a different one. That left "we approved a typo"
 * with no answer at all; this is the answer — a staff correction, on
 * request, with a record.
 *
 * ── WHY IT IS BEHIND A BUTTON ────────────────────────────────────────
 * It is a CORRECTION, not routine editing. Two always-open inputs beside
 * the rest of the profile invite a change nobody intended; a collapsed
 * panel makes opening it the first deliberate act.
 *
 * ── FE-2 ─────────────────────────────────────────────────────────────
 * Cosmetic RBAC on `sellers.approve`; the server enforces regardless.
 * Nothing is pre-checked beyond "there is a reason at all" — phone
 * format, reason length, and whether anything actually changed
 * (IDENTITY_NO_CHANGES) are the server's rules, and its refusal is
 * rendered verbatim through `serverVerdict()`.
 *
 * Follows the suspend/reapprove template in `status-action-panel.tsx`:
 * confirm step → server verdict verbatim → query invalidation.
 */
export function IdentityCorrectionPanel({
  sellerId,
  currentCompanyName,
  currentPhone,
}: {
  readonly sellerId: string;
  readonly currentCompanyName: string;
  readonly currentPhone: string;
}): ReactElement {
  const canCorrect = usePermission('sellers.approve');
  const correct = useUpdateSellerIdentity(sellerId);

  const [open, setOpen] = useState(false);
  const [companyName, setCompanyName] = useState(currentCompanyName);
  const [phone, setPhone] = useState(currentPhone);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function openPanel(): void {
    // Pre-fill from the CURRENT values so the admin edits rather than
    // retypes, and so "what it was" stays on screen while they change it.
    setCompanyName(currentCompanyName);
    setPhone(currentPhone);
    setReason('');
    setError(null);
    setOpen(true);
  }

  function close(): void {
    setOpen(false);
    setReason('');
    setError(null);
  }

  async function submit(): Promise<void> {
    setError(null);
    const nextCompany = companyName.trim();
    const nextPhone = phone.trim();
    try {
      await correct.mutateAsync({
        // Only what actually moved. An unchanged field is omitted, so
        // the server sees a correction rather than a rewrite — and when
        // NOTHING moved it answers IDENTITY_NO_CHANGES, which is a
        // refusal we surface rather than pre-empt.
        ...(nextCompany === currentCompanyName ? {} : { companyName: nextCompany }),
        ...(nextPhone === currentPhone ? {} : { phone: nextPhone }),
        reason: reason.trim(),
      });
      close();
    } catch (err) {
      setError(serverVerdict(err, 'Failed to correct the seller identity.'));
    }
  }

  return (
    <>
      <dl className="grid grid-cols-[minmax(84px,36%)_1fr] sm:grid-cols-[160px_1fr] gap-x-3 sm:gap-x-6 gap-y-1.5 text-sm">
        <dt className="text-text-muted">Company name</dt>
        <dd className="text-text-body">{currentCompanyName}</dd>
        <dt className="text-text-muted">Phone</dt>
        <dd className="text-text-body font-mono text-xs">{currentPhone}</dd>
      </dl>

      <div className="mt-3">
        <Button
          variant="secondary"
          size="md"
          disabled={!canCorrect || correct.isPending}
          onClick={openPanel}
          title={!canCorrect ? "Requires the 'sellers.approve' permission" : undefined}
        >
          <PencilLine size={12} /> Correct these details…
        </Button>
      </div>

      {!canCorrect && (
        <div className="text-text-faint text-xs mt-2">
          Your role can&apos;t correct an approved identity. Ask a super-admin if a seller has
          reported one of these is wrong.
        </div>
      )}

      <Modal
        open={open}
        onOpenChange={(o) => !o && close()}
        title="Correct this seller's identity"
        description="Use this when the approved details are wrong — a mistyped company name, a phone number captured incorrectly at registration. It corrects the record; it does not move the account to a different business."
        size="lg"
      >
        <div className="space-y-3">
          <FormField
            label="Company name"
            htmlFor="identity-company-name"
            hint="As approved. Leave it exactly as it is if only the phone is wrong."
          >
            <Input
              id="identity-company-name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              maxLength={120}
              disabled={correct.isPending}
            />
          </FormField>

          <FormField
            label="Phone"
            htmlFor="identity-phone"
            hint="Bangladesh number in E.164 — starts +880, digits only after it."
          >
            <Input
              id="identity-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="font-mono"
              disabled={correct.isPending}
            />
          </FormField>

          <FormField
            label="Reason for the correction (required)"
            htmlFor="identity-reason"
            hint="This is the only record of why an approved identity changed. Whoever reads the audit row in six months has nothing else to go on — say what was wrong and who asked for it. At least 20 characters."
          >
            <Textarea
              id="identity-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={4}
              placeholder="e.g. Seller emailed 2026-08-14: trade licence reads “Nabeela Traders”, registered here as “Nabila Traders”. Corrected to match the licence."
              disabled={correct.isPending}
            />
          </FormField>
        </div>

        {error !== null && (
          <div
            className="text-critical mt-3 rounded-[5px] px-2.5 py-1.5 text-xs"
            style={{
              background: 'var(--color-critical-tint)',
              border: '1px solid var(--color-critical-ring)',
            }}
          >
            {error}
          </div>
        )}

        <ModalFooter>
          <Button variant="ghost" size="md" onClick={close} disabled={correct.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            // The ONLY client-side block: a reason that is blank or all
            // whitespace. Everything else — length, phone shape, whether
            // anything changed — is the server's to refuse.
            disabled={correct.isPending || reason.trim() === ''}
            onClick={() => {
              void submit();
            }}
          >
            {correct.isPending ? 'Correcting…' : 'Apply correction'}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
