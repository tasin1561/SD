'use client';

import { useState, type ReactElement } from 'react';
import { Button } from '@skydrop/ui/app/button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextField } from '@skydrop/ui/app/text-field';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { useToast } from '@skydrop/ui/app/toast';
import { useMergeCredentialFields } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { useT } from '@/i18n/client';

/**
 * The mailbox the sign-in reads its emailed code from.
 *
 * ── WHY THIS EXISTS AT ALL ───────────────────────────────────────────
 * Shiprocket asks for a code by email when it does not recognise a
 * sign-in, and it never recognises ours: a fresh browser arriving from
 * a datacentre egress is exactly the shape that check is built to stop.
 * Before this, the nightly run screenshotted the 2FA box and gave up,
 * and the portal half of the cost sync had been dead since 2026-10-01 —
 * two months of P&L closed PROVISIONALLY with courier costs missing.
 *
 * ── WHY ITS OWN ACTION, LIKE THE PORTAL LOGIN ────────────────────────
 * Same reason that one is separate: it MERGES into the credential the
 * account already has, so the API token and the portal password are
 * untouched. The alternative — making a second account carrying the
 * full set — is the trap the portal-login modal documents, where the
 * HTTP layer resolves through the default account and a freshly typed
 * credential silently replaces a proven one.
 *
 * ── READ-ONLY, AND SAY SO ────────────────────────────────────────────
 * The scope is `gmail.readonly`. It cannot send, delete or modify
 * anything, and the only thing it is ever used for is reading one
 * six-digit code. The fields are stored like every other credential:
 * AES-256-GCM, decrypted with an audit row, never read back out.
 */
export function SignInCodeMailboxModal({
  accountId,
  accountLabel,
  onClose,
}: {
  readonly accountId: string;
  readonly accountLabel: string;
  readonly onClose: () => void;
}): ReactElement {
  const t = useT();
  const merge = useMergeCredentialFields();
  const toast = useToast();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  const incomplete =
    clientId.trim() === '' || clientSecret.trim() === '' || refreshToken.trim() === '';

  async function save(): Promise<void> {
    setError(null);
    try {
      const res = await merge.mutateAsync({
        accountId,
        credentialFields: {
          gmailClientId: clientId.trim(),
          gmailClientSecret: clientSecret.trim(),
          gmailRefreshToken: refreshToken.trim(),
        },
      });
      toast.success(
        res.added.length > 0
          ? t('courierAccountsSignInCodeMailboxModal.mailboxSavedAdded', {
              value: res.added.join(', '),
            })
          : t('courierAccountsSignInCodeMailboxModal.mailboxReplaced'),
      );
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t('courierAccountsSignInCodeMailboxModal.signInCodeMailbox', { accountLabel })}
      description={t('courierAccountsSignInCodeMailboxModal.theCourierEmailsACode')}
      footer={
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('courierAccountsSignInCodeMailboxModal.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={merge.isPending}
            disabled={incomplete || merge.isPending}
            onClick={() => void save()}
          >
            {t('courierAccountsSignInCodeMailboxModal.saveMailbox')}
          </Button>
        </DialogFooter>
      }
    >
      <div className="af-form">
        <TextField
          label={t('courierAccountsSignInCodeMailboxModal.clientId')}
          requiredMark
          hint={t('courierAccountsSignInCodeMailboxModal.fromTheOauthClient')}
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          autoComplete="off"
        />
        <TextField
          label={t('courierAccountsSignInCodeMailboxModal.clientSecret')}
          requiredMark
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          autoComplete="new-password"
        />
        <TextField
          label={t('courierAccountsSignInCodeMailboxModal.refreshToken')}
          requiredMark
          hint={t('courierAccountsSignInCodeMailboxModal.theLongLivedTokenFrom')}
          type="password"
          value={refreshToken}
          onChange={(e) => setRefreshToken(e.target.value)}
          autoComplete="new-password"
        />
        {error !== null && (
          <ErrorState title={t('courierAccountsSignInCodeMailboxModal.notSaved')} message={error} />
        )}
      </div>
    </Dialog>
  );
}
