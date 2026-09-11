'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  useToast,
} from '@skydrop/ui/components';
import { useMergeCredentialFields } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

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
          ? `Portal login saved — added ${res.added.join(', ')}`
          : 'Portal login replaced',
      );
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Portal login — ${accountLabel}`}
      description={
        needsCompany
          ? 'Delhivery has no billing API, so the nightly cost sync signs into their panel. Stored encrypted; never shown again.'
          : 'Shiprocket has no API for its passbook, ledger or recharges, so the automation signs into app.shiprocket.in through the Bangalore tunnel. Stored encrypted; never shown again.'
      }
    >
      <FormField
        label="Email"
        required
        hint={
          needsCompany
            ? 'The address you use at one.delhivery.com.'
            : 'The address you use at app.shiprocket.in — the website login, not the API user.'
        }
      >
        <Input
          type="email"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="off"
        />
      </FormField>
      <FormField label="Password" required>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </FormField>
      {needsCompany && (
        <FormField
          label="Company"
          required
          hint="Exactly as it appears in their login dropdown — e.g. MS EXPORTS. One login reaches several companies and each has its own wallet, so this decides which one is read."
        >
          <Input value={company} onChange={(e) => setCompany(e.target.value)} />
        </FormField>
      )}

      <p className="text-text-muted text-xs">
        The API token on this account is left exactly as it is — this adds to the credential rather
        than replacing it.
      </p>

      {error !== null && <ErrorNote message={error} />}

      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={incomplete || merge.isPending}
          onClick={() => void save()}
        >
          {merge.isPending ? 'Saving…' : 'Save login'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
