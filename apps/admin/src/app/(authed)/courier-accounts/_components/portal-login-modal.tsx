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
 * The portal login, added beside the API token that already works.
 *
 * ── WHY A SEPARATE ACTION ────────────────────────────────────────────
 * The API token authenticates our REST calls; the portal login is a
 * human login to their panel, and the nightly wallet sync needs it to
 * read what they actually charged — they have no billing API. Both live
 * on the same credential, so this MERGES: the token is untouched.
 *
 * Creating a second account with the full set was the only way to do
 * this before, and it is a trap — the HTTP layer resolves through the
 * default account, so a second credential silently becomes the one that
 * authenticates, replacing a proven token with a freshly typed one.
 *
 * ── THE COMPANY IS NOT OPTIONAL ──────────────────────────────────────
 * Delhivery asks for it between the email and the password, because one
 * login reaches several companies and each has its OWN wallet. Choosing
 * wrong reads another company's money against these parcels, so it is
 * asked for here rather than guessed at run time.
 */
export function PortalLoginModal({
  accountId,
  accountLabel,
  courierCode,
  onClose,
}: {
  readonly accountId: string;
  readonly accountLabel: string;
  /** Delhivery asks which company to sign in as; Shiprocket does not. */
  readonly courierCode: string;
  readonly onClose: () => void;
}): ReactElement {
  const t = useT();
  const needsCompany = courierCode === 'delhivery';
  const merge = useMergeCredentialFields();
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [company, setCompany] = useState('');
  const [error, setError] = useState<string | null>(null);

  const incomplete =
    username.trim() === '' || password.trim() === '' || (needsCompany && company.trim() === '');

  async function save(): Promise<void> {
    setError(null);
    try {
      const res = await merge.mutateAsync({
        accountId,
        credentialFields: {
          portalUsername: username.trim(),
          portalPassword: password,
          ...(needsCompany ? { portalCompany: company.trim() } : {}),
        },
      });
      toast.success(
        res.added.length > 0
          ? t('courierAccountsPortalLoginModal.portalLoginSavedAdded', {
              value: res.added.join(', '),
            })
          : t('courierAccountsPortalLoginModal.portalLoginReplaced'),
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
      title={t('courierAccountsPortalLoginModal.portalLogin', { accountLabel })}
      description={
        needsCompany
          ? t('courierAccountsPortalLoginModal.delhiveryHasNoBillingApi')
          : t('courierAccountsPortalLoginModal.shiprocketHasNoApiFor')
      }
      footer={
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('courierAccountsPortalLoginModal.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={merge.isPending}
            disabled={incomplete || merge.isPending}
            onClick={() => void save()}
          >
            {t('courierAccountsPortalLoginModal.saveLogin')}
          </Button>
        </DialogFooter>
      }
    >
      <div className="af-form">
        <TextField
          label={t('courierAccountsPortalLoginModal.email')}
          requiredMark
          hint={
            needsCompany
              ? t('courierAccountsPortalLoginModal.theAddressYouUseAt')
              : t('courierAccountsPortalLoginModal.theAddressYouUseAt2')
          }
          type="email"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="off"
        />
        <TextField
          label={t('courierAccountsPortalLoginModal.password')}
          requiredMark
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        {needsCompany && (
          <TextField
            label={t('courierAccountsPortalLoginModal.company')}
            requiredMark
            hint={t('courierAccountsPortalLoginModal.exactlyAsItAppearsIn')}
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        )}

        <p className="af-small">{t('courierAccountsPortalLoginModal.theApiTokenOnThis')}</p>

        {error !== null && (
          <ErrorState title={t('courierAccountsPortalLoginModal.notSaved')} message={error} />
        )}
      </div>
    </Dialog>
  );
}
