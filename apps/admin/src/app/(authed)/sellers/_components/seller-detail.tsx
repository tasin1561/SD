'use client';

import Link from 'next/link';
import { ArrowLeft, Copy, Eye } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { ApiError } from '@skydrop/api-client';
import { useRevealBankAccount, useSellerDetail } from '@/lib/api-hooks';
import { useStaffIdentity, hasStaffRole } from '@skydrop/auth/client';
import type { StaffRole } from '@skydrop/db';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  PageHeader,
  Section,
  SellerStatusBadge,
} from '@skydrop/ui/components';
import { StatusActionPanel } from './status-action-panel';
import { SellerSettingsSection } from './seller-settings-section';

const STATUS_ROLES: readonly StaffRole[] = [
  'SUPER_ADMIN' as StaffRole,
  'SELLER_APPROVAL_ADMIN' as StaffRole,
];

export function SellerDetailView({ sellerId }: { sellerId: string }): ReactElement {
  const detail = useSellerDetail(sellerId);
  const staff = useStaffIdentity();
  const canChangeStatus = hasStaffRole(staff, STATUS_ROLES);

  return (
    <div className="max-w-4xl">
      <Link
        href="/sellers"
        className="inline-flex items-center gap-1.5 text-text-muted hover:text-text-body text-xs mb-4 transition-colors"
      >
        <ArrowLeft size={12} /> Sellers
      </Link>

      {detail.isLoading ? (
        <LoadingState label="Loading seller…" />
      ) : detail.isError ? (
        <ErrorState
          message={detail.error?.message ?? 'Failed to load seller.'}
          retry={() => void detail.refetch()}
        />
      ) : !detail.data ? (
        <ErrorState message="Seller not found." />
      ) : (
        <>
          <PageHeader
            title={detail.data.companyName}
            subtitle={
              <>
                <span className="font-mono">{detail.data.email}</span>
                <span className="mx-2">·</span>
                <span>{detail.data.contactPersonName}</span>
              </>
            }
            action={<SellerStatusBadge status={detail.data.status} />}
          />

          <Section title="Profile">
            <Card>
              <CardBody>
                <dl className="grid grid-cols-[minmax(84px,36%)_1fr] sm:grid-cols-[160px_1fr] gap-x-3 sm:gap-x-6 gap-y-1.5 text-sm">
                  <dt className="text-text-muted">Contact name</dt>
                  <dd className="text-text-body">{detail.data.contactPersonName}</dd>
                  <dt className="text-text-muted">Phone</dt>
                  <dd className="text-text-body font-mono text-xs">{detail.data.phone}</dd>
                  <dt className="text-text-muted">WhatsApp</dt>
                  <dd className="text-text-body font-mono text-xs">
                    {detail.data.whatsapp ?? '—'}
                  </dd>
                  <dt className="text-text-muted">Country</dt>
                  <dd className="text-text-body">{detail.data.countryCode}</dd>
                  <dt className="text-text-muted">Display currency</dt>
                  <dd className="text-text-body">{detail.data.displayCurrency}</dd>
                  <dt className="text-text-muted">Display language</dt>
                  <dd className="text-text-body">{detail.data.displayLanguage}</dd>
                  <dt className="text-text-muted">Email verified</dt>
                  <dd className="text-text-body">
                    {detail.data.emailVerifiedAt ? (
                      <span className="text-text-body">
                        {new Date(detail.data.emailVerifiedAt).toISOString().slice(0, 10)}
                      </span>
                    ) : (
                      <span className="text-text-muted">Pending</span>
                    )}
                  </dd>
                  <dt className="text-text-muted">Approved</dt>
                  <dd className="text-text-body">
                    {detail.data.approvedAt
                      ? new Date(detail.data.approvedAt).toISOString().slice(0, 10)
                      : '—'}
                  </dd>
                  <dt className="text-text-muted">Created</dt>
                  <dd className="text-text-body font-mono text-xs">
                    {new Date(detail.data.createdAt).toISOString().slice(0, 16)}
                  </dd>
                </dl>
              </CardBody>
            </Card>
          </Section>

          <Section title="Status">
            <Card>
              <CardHeader
                title="Account status"
                subtitle="Suspend a seller to immediately revoke their portal access; reapprove to restore it."
              />
              <CardBody>
                <StatusActionPanel
                  sellerId={detail.data.id}
                  currentStatus={detail.data.status}
                  canChangeStatus={canChangeStatus}
                />
              </CardBody>
            </Card>
          </Section>

          <Section title="Bank account">
            <Card>
              <CardHeader
                title="Reveal bank account number"
                subtitle="Decrypts + audits HIGH. Use only when copying into a bank portal for a manual payout."
              />
              <CardBody>
                <RevealBankAccountPanel sellerId={detail.data.id} />
              </CardBody>
            </Card>
          </Section>

          {/* SET-1 per-seller overrides. Lives here rather than on its own
              page because "what is this seller on" is a question you ask
              while looking at the seller. */}
          <SellerSettingsSection sellerId={detail.data.id} />
        </>
      )}
    </div>
  );
}

/**
 * Reveal panel — admin types a short reason, server decrypts the
 * encrypted account number + writes a HIGH audit, the plaintext
 * shows in a one-shot input the operator can copy to clipboard.
 * Refreshing the page clears it. FE-2: server rejection verbatim.
 */
function RevealBankAccountPanel({ sellerId }: { readonly sellerId: string }): ReactElement {
  const [reason, setReason] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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
      if (e instanceof ApiError) {
        const b = e.body as { code?: unknown; message?: unknown } | null;
        const code = typeof b?.code === 'string' ? b.code : null;
        const msg = typeof b?.message === 'string' ? b.message : e.message;
        setError(code ? `[${code}] ${msg}` : msg);
      } else {
        setError(e instanceof Error ? e.message : 'Reveal failed');
      }
    }
  }

  async function onCopy(): Promise<void> {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_500);
    } catch {
      // Falls back to manual selection in the input.
    }
  }

  return (
    <div className="space-y-3">
      <FormField
        label="Reason for revealing (recorded in the audit log)"
        hint="Optional but recommended"
      >
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          placeholder="e.g. manual payout via DBBL portal — TRF-2026-06-03"
          disabled={reveal.isPending}
        />
      </FormField>
      <Button
        variant="primary"
        size="md"
        disabled={reveal.isPending}
        onClick={() => void onReveal()}
      >
        <Eye size={12} /> {reveal.isPending ? 'Revealing…' : 'Reveal account number'}
      </Button>

      {revealed !== null && (
        <div className="mt-2 flex items-stretch gap-2">
          <input
            readOnly
            value={revealed}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 px-3 py-1.5 rounded-[5px] bg-bg border border-border text-text-bright text-sm font-mono focus:border-accent focus:outline-none"
          />
          <Button type="button" variant="secondary" size="md" onClick={() => void onCopy()}>
            <Copy size={12} /> {copied ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      )}

      {error && (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px]">
          {error}
        </div>
      )}
    </div>
  );
}
