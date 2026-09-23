'use client';

import Link from 'next/link';
import { ArrowLeftRight, Eye, PackageSearch, PencilLine } from 'lucide-react';
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

const CRUMBS = [{ label: 'Sellers', href: '/sellers' }] as const;

// Was a check against the role NAME, which cannot see a role somebody
// created — the permission is what the server enforces, so it is what
// the button should ask about.
export function SellerDetailView({ sellerId }: { sellerId: string }): ReactElement {
  const detail = useSellerDetail(sellerId);
  const canChangeStatus = usePermission('sellers.approve', 'sellers.suspend');
  // Cosmetic (FE-2): the transfer page and its endpoints refuse without it.
  const canTransfer = usePermission('money.wallet.transfer');

  if (detail.isLoading || detail.isError || !detail.data) {
    return (
      <AcPage>
        <AcHeader crumbs={[...CRUMBS, { label: 'Seller' }]} title="Seller" />
        {detail.isLoading ? (
          <SkeletonRows rows={6} cols={2} label="Loading seller…" />
        ) : detail.isError ? (
          <ErrorState
            message={detail.error?.message ?? 'Failed to load seller.'}
            retry={() => void detail.refetch()}
          />
        ) : (
          <ErrorState message="Seller not found." />
        )}
      </AcPage>
    );
  }

  const d = detail.data;

  return (
    <AcPage>
      <AcHeader
        crumbs={[...CRUMBS, { label: d.companyName }]}
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
              <span className="sk-btn__label">This seller&apos;s orders →</span>
            </Link>
            {canTransfer && (
              <Link
                href={`/wallet-transfers?sellerId=${sellerId}`}
                className={buttonClassName('secondary', 'md')}
              >
                <span className="sk-btn__icon" aria-hidden>
                  <ArrowLeftRight size={15} />
                </span>
                <span className="sk-btn__label">Debit or credit wallet →</span>
              </Link>
            )}
          </div>
        }
      />

      <AcSection title="Profile">
        <AcDl
          items={[
            {
              label: 'Short code',
              value: <InitialsRow sellerId={d.id} current={d.initials} />,
            },
            { label: 'Contact name', value: d.contactPersonName },
            { label: 'Phone', value: <span className="sk-figure">{d.phone}</span> },
            { label: 'WhatsApp', value: <span className="sk-figure">{d.whatsapp ?? '—'}</span> },
            { label: 'Country', value: d.countryCode },
            { label: 'Display currency', value: d.displayCurrency },
            { label: 'Display language', value: d.displayLanguage },
            {
              label: 'Email verified',
              value: d.emailVerifiedAt ? (
                <span className="sk-figure">
                  {new Date(d.emailVerifiedAt).toISOString().slice(0, 10)}
                </span>
              ) : (
                <span className="ac-faint">Pending</span>
              ),
            },
            {
              label: 'Approved',
              value: (
                <span className="sk-figure">
                  {d.approvedAt ? new Date(d.approvedAt).toISOString().slice(0, 10) : '—'}
                </span>
              ),
            },
            {
              label: 'Created',
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
      <AcSection title="Registered identity" bare>
        <AcCard
          title="Company name and phone"
          note="What this account was approved as. The seller cannot change either — a staff correction, recorded with a reason, is the only route."
        >
          <IdentityCorrectionPanel
            sellerId={d.id}
            currentCompanyName={d.companyName}
            currentPhone={d.phone}
          />
        </AcCard>
      </AcSection>

      <AcSection title="Status" bare>
        <AcCard
          title="Account status"
          note="Suspend a seller to immediately revoke their portal access; reapprove to restore it."
        >
          <StatusActionPanel
            sellerId={d.id}
            sellerName={d.companyName}
            currentStatus={d.status}
            canChangeStatus={canChangeStatus}
          />
        </AcCard>
      </AcSection>

      <AcSection title="Account hold" bare>
        <RestrictionPanel sellerId={d.id} canManage={canChangeStatus} />
        <BulkDequeuePanel sellerId={d.id} sellerName={d.companyName} />
      </AcSection>

      <AcSection title="Bank account" bare>
        <AcCard
          title="Reveal bank account number"
          note="Decrypts + audits HIGH. Use only when copying into a bank portal for a manual withdrawal."
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
      setRevealed(res.accountNumber ?? '(no account number captured)');
    } catch (e) {
      setError(serverVerdict(e, 'Reveal failed'));
    }
  }

  return (
    <div className="ac-form">
      <TextField
        label="Reason for revealing (recorded in the audit log)"
        hint="Optional but recommended"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={200}
        placeholder="e.g. manual withdrawal via DBBL portal — TRF-2026-06-03"
        disabled={reveal.isPending || !canReveal}
      />
      <div className="ac-buttons" data-align="start">
        <AsyncButton
          variant="primary"
          size="md"
          icon={<Eye size={15} />}
          state={phaseOf(reveal.isPending, error)}
          labels={{
            idle: 'Reveal account number',
            busy: 'Revealing…',
            error: 'Not revealed',
          }}
          onClick={() => void onReveal()}
        />
      </div>

      {revealed !== null && <AcRevealValue value={revealed} label="Bank account number" />}

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
            Change
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
        aria-label="Seller short code"
        inputClassName="sk-ident"
      />
      <AsyncButton
        variant="primary"
        size="sm"
        state={phaseOf(rename.isPending, error)}
        labels={{ idle: 'Save', busy: 'Saving…', error: 'Not saved' }}
        onClick={save}
        disabled={value.trim().length < 2}
      />
      <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      {error !== null && <AcAlert message={error} />}
    </div>
  );
}
