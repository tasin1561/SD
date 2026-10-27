'use client';

import { useState, type ReactElement } from 'react';
import { PencilLine } from 'lucide-react';
import { useUpdateSellerIdentity } from '@/lib/api-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { AcAlert, AcDl, phaseOf } from '../../settings/_components/ac-parts';
import { useT } from '@/i18n/client';

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
  const t = useT();
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
      setError(serverVerdict(err, t('sellersIdentityCorrectionPanel.failedToCorrectTheClient')));
    }
  }

  return (
    <>
      <AcDl
        items={[
          { label: t('sellersIdentityCorrectionPanel.companyName'), value: currentCompanyName },
          {
            label: t('sellersIdentityCorrectionPanel.phone'),
            value: <span className="sk-figure">{currentPhone}</span>,
          },
        ]}
      />

      <div className="ac-buttons" data-align="start">
        <Button
          variant="secondary"
          size="md"
          icon={<PencilLine size={15} />}
          disabled={!canCorrect || correct.isPending}
          onClick={openPanel}
          title={
            !canCorrect
              ? t('sellersIdentityCorrectionPanel.requiresTheSellersApprovePermission')
              : undefined
          }
        >
          {t('sellersIdentityCorrectionPanel.correctTheseDetails')}
        </Button>
      </div>

      {!canCorrect && (
        <p className="ac-faint">{t('sellersIdentityCorrectionPanel.yourRoleCanTCorrect')}</p>
      )}

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) close();
        }}
        title={t('sellersIdentityCorrectionPanel.correctThisClientSIdentity')}
        description={t('sellersIdentityCorrectionPanel.useThisWhenTheApproved')}
        icon={<PencilLine size={18} />}
        size="lg"
        locked={correct.isPending}
        footer={
          <DialogFooter>
            <Button variant="ghost" size="md" onClick={close} disabled={correct.isPending}>
              {t('sellersIdentityCorrectionPanel.cancel')}
            </Button>
            <AsyncButton
              variant="primary"
              size="md"
              state={phaseOf(correct.isPending, error)}
              labels={{
                idle: t('sellersIdentityCorrectionPanel.applyCorrection'),
                busy: t('sellersIdentityCorrectionPanel.correcting'),
                error: t('sellersIdentityCorrectionPanel.notApplied'),
              }}
              // The ONLY client-side block: a reason that is blank or all
              // whitespace. Everything else — length, phone shape, whether
              // anything changed — is the server's to refuse.
              disabled={correct.isPending || reason.trim() === ''}
              onClick={() => {
                void submit();
              }}
            />
          </DialogFooter>
        }
      >
        <div className="ac-form">
          <TextField
            label={t('sellersIdentityCorrectionPanel.companyName')}
            id="identity-company-name"
            hint={t('sellersIdentityCorrectionPanel.asApprovedLeaveItExactly')}
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            maxLength={120}
            disabled={correct.isPending}
          />

          <TextField
            label={t('sellersIdentityCorrectionPanel.phone')}
            id="identity-phone"
            hint={t('sellersIdentityCorrectionPanel.bangladeshNumberInE164')}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputClassName="sk-figure"
            disabled={correct.isPending}
          />

          <TextArea
            label={t('sellersIdentityCorrectionPanel.reasonForTheCorrectionRequired')}
            id="identity-reason"
            hint={t('sellersIdentityCorrectionPanel.thisIsTheOnlyRecord')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={4}
            placeholder={t('sellersIdentityCorrectionPanel.eGClientEmailed2026')}
            disabled={correct.isPending}
          />

          {error !== null && <AcAlert message={error} />}
        </div>
      </Dialog>
    </>
  );
}
