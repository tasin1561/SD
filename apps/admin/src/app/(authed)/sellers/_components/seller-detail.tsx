'use client';

import Link from 'next/link';
import { ArrowLeftRight, Eye, PackageSearch, PencilLine, ShieldAlert } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useRevealBankAccount, useSellerDetail, useUpdateSellerInitials } from '@/lib/api-hooks';
import { usePermission } from '@/lib/use-permission';
import { Button, buttonClassName } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { TextField } from '@skydrop/ui/app/text-field';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { RestrictionPanel } from './restriction-panel';
import { StatusActionPanel } from './status-action-panel';
import { IdentityCorrectionPanel } from './identity-correction-panel';
import { SellerSettingsSection } from './seller-settings-section';
import { CreditAfterConfirmationPanel } from './credit-after-confirmation-panel';
import { SellerCourierLinksSection } from './seller-courier-links-section';
import { BulkDequeuePanel } from './bulk-dequeue-panel';
import { StartImpersonationDialog } from '../../impersonation/_components/start-impersonation-dialog';
import { serverVerdict } from '@/lib/server-verdict';
import {
  AcAlert,
  AcCard,
  AcDl,
  AcHeader,
  AcPage,
  AcRevealValue,
  AcSection,
  SellerStatusChip,
  phaseOf,
} from '../../settings/_components/ac-parts';
import { useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

const CRUMBS = (t: Translate<MessageKey>) =>
  [{ label: t('sellersSellerDetail.clients'), href: '/sellers' }] as const;

// Was a check against the role NAME, which cannot see a role somebody
// created — the permission is what the server enforces, so it is what
// the button should ask about.
export function SellerDetailView({ sellerId }: { sellerId: string }): ReactElement {
  const t = useT();
  const detail = useSellerDetail(sellerId);
  // `sellers.suspend` only — matching the route, which dropped
  // `sellers.approve`. `usePermission` is OR like the server's decorator,
  // so offering both keys showed the control to an onboarding-only role
  // AND it worked; a visibly-offered control that 403s is the worse
  // failure of the two (FE-2), so these move together.
  const canChangeStatus = usePermission('sellers.suspend');
  // Cosmetic (FE-2): the transfer page and its endpoints refuse without it.
  const canTransfer = usePermission('money.wallet.transfer');
  // Going INSIDE this account. `support.impersonate` is the key that
  // opens a session; whether it may also WRITE is asked separately, in
  // the dialog, because that is where the choice is made.
  const canImpersonate = usePermission('support.impersonate');
  const [impersonating, setImpersonating] = useState(false);

  if (detail.isLoading || detail.isError || !detail.data) {
    return (
      <AcPage>
        <AcHeader
          crumbs={[...CRUMBS(t), { label: t('sellersSellerDetail.client') }]}
          title={t('sellersSellerDetail.client')}
        />
        {detail.isLoading ? (
          <SkeletonRows rows={6} cols={2} label={t('sellersSellerDetail.loadingClient')} />
        ) : detail.isError ? (
          <ErrorState
            message={detail.error?.message ?? t('sellersSellerDetail.failedToLoadClient')}
            retry={() => void detail.refetch()}
          />
        ) : (
          <ErrorState message={t('sellersSellerDetail.clientNotFound')} />
        )}
      </AcPage>
    );
  }

  const d = detail.data;

  return (
    <AcPage>
      <AcHeader
        crumbs={[...CRUMBS(t), { label: d.companyName }]}
        title={d.companyName}
        meta={
          <div className="ac-meta">
            <SellerStatusChip status={d.status} />
            <span className="ac-muted">
              <span>{d.email}</span>
              <span aria-hidden> · </span>
              <span>{d.contactPersonName}</span>
            </span>
          </div>
        }
        action={
          <div className="ac-buttons">
            <Link
              href={`/orders?sellerId=${sellerId}`}
              className={buttonClassName('secondary', 'md')}
            >
              <span className="sk-btn__icon" aria-hidden>
                <PackageSearch size={15} />
              </span>
              <span className="sk-btn__label">{t('sellersSellerDetail.thisClientSOrders')}</span>
            </Link>
            {canTransfer && (
              <Link
                href={`/wallet-transfers?sellerId=${sellerId}`}
                className={buttonClassName('secondary', 'md')}
              >
                <span className="sk-btn__icon" aria-hidden>
                  <ArrowLeftRight size={15} />
                </span>
                <span className="sk-btn__label">
                  {t('sellersSellerDetail.debitOrCreditWallet')}
                </span>
              </Link>
            )}
            {canImpersonate && (
              /* Destructive, because it is: for as long as the session
                 lasts, this console's operator is indistinguishable from
                 the seller in their own account's history. A secondary
                 button beside "their orders" would read as one more way
                 to look at them. */
              <Button
                variant="destructive"
                size="md"
                icon={<ShieldAlert size={15} />}
                onClick={() => setImpersonating(true)}
              >
                {t('sellersSellerDetail.signInAs', { companyName: d.companyName })}
              </Button>
            )}
          </div>
        }
      />

      {impersonating && (
        <StartImpersonationDialog
          subjectKind="SELLER"
          subjectId={d.id}
          subjectName={d.companyName}
          onClose={() => setImpersonating(false)}
        />
      )}

      <AcSection title={t('sellersSellerDetail.profile')}>
        <AcDl
          items={[
            {
              label: t('sellersSellerDetail.shortCode'),
              value: <InitialsRow sellerId={d.id} current={d.initials} />,
            },
            { label: t('sellersSellerDetail.contactName'), value: d.contactPersonName },
            {
              label: t('sellersSellerDetail.phone'),
              value: <span className="sk-figure">{d.phone}</span>,
            },
            {
              label: t('sellersSellerDetail.whatsapp'),
              value: <span className="sk-figure">{d.whatsapp ?? '—'}</span>,
            },
            { label: t('sellersSellerDetail.country'), value: d.countryCode },
            { label: t('sellersSellerDetail.displayCurrency'), value: d.displayCurrency },
            { label: t('sellersSellerDetail.displayLanguage'), value: d.displayLanguage },
            {
              label: t('sellersSellerDetail.emailVerified'),
              value: d.emailVerifiedAt ? (
                <span className="sk-figure">
                  {new Date(d.emailVerifiedAt).toISOString().slice(0, 10)}
                </span>
              ) : (
                <span className="ac-faint">{t('sellersSellerDetail.pending')}</span>
              ),
            },
            {
              label: t('sellersSellerDetail.approved'),
              value: (
                <span className="sk-figure">
                  {d.approvedAt ? new Date(d.approvedAt).toISOString().slice(0, 10) : '—'}
                </span>
              ),
            },
            {
              label: t('sellersSellerDetail.created'),
              value: (
                <span className="sk-figure">
                  {new Date(d.createdAt).toISOString().slice(0, 16)}
                </span>
              ),
            },
          ]}
        />
      </AcSection>

      {/* The approved identity, and the only way it moves. Sits
          directly under the profile because that is where an operator
          reads the wrong value and forms the intent to fix it. */}
      <AcSection title={t('sellersSellerDetail.registeredIdentity')} bare>
        <AcCard
          title={t('sellersSellerDetail.companyNameAndPhone')}
          note={t('sellersSellerDetail.whatThisAccountWasApproved')}
        >
          <IdentityCorrectionPanel
            sellerId={d.id}
            currentCompanyName={d.companyName}
            currentPhone={d.phone}
          />
        </AcCard>
      </AcSection>

      <AcSection title={t('sellersSellerDetail.status')} bare>
        <AcCard
          title={t('sellersSellerDetail.accountStatus')}
          note={t('sellersSellerDetail.suspendAClientToImmediately')}
        >
          <StatusActionPanel
            sellerId={d.id}
            sellerName={d.companyName}
            currentStatus={d.status}
            canChangeStatus={canChangeStatus}
          />
        </AcCard>
      </AcSection>

      <AcSection title={t('sellersSellerDetail.accountHold')} bare>
        <RestrictionPanel sellerId={d.id} canManage={canChangeStatus} />
        <BulkDequeuePanel sellerId={d.id} sellerName={d.companyName} />
      </AcSection>

      <AcSection title={t('sellersSellerDetail.bankAccount')} bare>
        <AcCard
          title={t('sellersSellerDetail.revealBankAccountNumber')}
          note={t('sellersSellerDetail.decryptsAuditsHighUseOnly')}
          tone="warn"
        >
          <RevealBankAccountPanel sellerId={d.id} />
        </AcCard>
      </AcSection>

      {/* SET-1 per-seller overrides. Lives here rather than on its own
          page because "what is this seller on" is a question you ask
          while looking at the seller. */}
      <SellerSettingsSection sellerId={d.id} />
      {/* CACC-1 weighted routing: which courier accounts carry this
          seller's parcels. Beside the settings because it is the same
          question — what has been agreed with this seller. */}
      <SellerCourierLinksSection sellerId={d.id} />
      <CreditAfterConfirmationPanel sellerId={d.id} />
    </AcPage>
  );
}

/**
 * Reveal panel — admin types a short reason, server decrypts the
 * encrypted account number + writes a HIGH audit, the plaintext
 * shows in a one-shot input the operator can copy to clipboard.
 * Refreshing the page clears it. FE-2: server rejection verbatim.
 */
function RevealBankAccountPanel({ sellerId }: { readonly sellerId: string }): ReactElement {
  const t = useT();
  const canReveal = usePermission('sellers.bank_account.reveal');
  const [reason, setReason] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reveal = useRevealBankAccount(sellerId);

  async function onReveal(): Promise<void> {
    setError(null);
    setRevealed(null);
    try {
      const res = await reveal.mutateAsync({
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setRevealed(res.accountNumber ?? t('sellersSellerDetail.noAccountNumberCaptured'));
    } catch (e) {
      setError(serverVerdict(e, t('sellersSellerDetail.revealFailed')));
    }
  }

  return (
    <div className="ac-form">
      <TextField
        label={t('sellersSellerDetail.reasonForRevealingRecordedIn')}
        hint={t('sellersSellerDetail.optionalButRecommended')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={200}
        placeholder={t('sellersSellerDetail.eGManualWithdrawalVia')}
        disabled={reveal.isPending || !canReveal}
      />
      <div className="ac-buttons" data-align="start">
        <AsyncButton
          variant="primary"
          size="md"
          icon={<Eye size={15} />}
          state={phaseOf(reveal.isPending, error)}
          labels={{
            idle: t('sellersSellerDetail.revealAccountNumber'),
            busy: t('sellersSellerDetail.revealing'),
            error: t('sellersSellerDetail.notRevealed'),
          }}
          onClick={() => void onReveal()}
        />
      </div>

      {revealed !== null && (
        <AcRevealValue value={revealed} label={t('sellersSellerDetail.bankAccountNumber')} />
      )}

      {error && <AcAlert message={error} />}
    </div>
  );
}

/**
 * The seller's operations short code, with an inline staff rename.
 *
 * Editable HERE and nowhere else. The seller portal has no equivalent
 * control and the API has no seller-facing route, because the code goes
 * on totes and manifests — a seller renaming it would invalidate
 * paperwork that already exists in the world.
 *
 * FE-2: the uniqueness rule is the SERVER's. This does not pre-check
 * whether a code is free, because it cannot know, and a client-side
 * mirror of that rule would go stale the moment another seller is
 * created. A duplicate comes back as [INITIALS_TAKEN] and is shown
 * verbatim.
 */
function InitialsRow({
  sellerId,
  current,
}: {
  readonly sellerId: string;
  readonly current: string | null;
}): ReactElement {
  const t = useT();
  const canEdit = usePermission('sellers.approve');
  const rename = useUpdateSellerInitials(sellerId);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current ?? '');
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <div className="ac-inline">
        <span className="sk-ident">{current ?? '—'}</span>
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            icon={<PencilLine size={14} />}
            onClick={() => {
              setValue(current ?? '');
              setError(null);
              setEditing(true);
            }}
          >
            {t('sellersSellerDetail.change')}
          </Button>
        )}
      </div>
    );
  }

  const save = (): void => {
    void (async () => {
      try {
        await rename.mutateAsync(value.trim());
        setEditing(false);
        setError(null);
      } catch (err) {
        setError(serverVerdict(err));
      }
    })();
  };

  return (
    <div className="ac-inline-edit">
      <TextField
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={4}
        aria-label={t('sellersSellerDetail.clientShortCode')}
        inputClassName="sk-ident"
      />
      <AsyncButton
        variant="primary"
        size="sm"
        state={phaseOf(rename.isPending, error)}
        labels={{
          idle: t('sellersSellerDetail.save'),
          busy: t('sellersSellerDetail.saving'),
          error: t('sellersSellerDetail.notSaved'),
        }}
        onClick={save}
        disabled={value.trim().length < 2}
      />
      <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
        {t('sellersSellerDetail.cancel')}
      </Button>
      {error !== null && <AcAlert message={error} />}
    </div>
  );
}
