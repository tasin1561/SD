'use client';

import type { ReactElement } from 'react';
import { useSellerIdentity } from '@skydrop/auth/client';
import {
  Card,
  CardBody,
  ErrorState,
  PageHeader,
} from '@skydrop/ui/components';

/**
 * Seller profile — read the SellerMe SSR-hydrated identity and
 * render a clean dl/dt summary.
 *
 * Phase 1A: read-only. The PATCH endpoint for editing company
 * details + a bank-account capture form (used by the Phase 1B
 * remittance flow) both land later; for now the seller updates
 * profile fields by emailing support@skydrop.online — the welcome
 * email points at the dashboard, not at editable profile / bank
 * details, so the seller's expectations are correct.
 */
export default function ProfilePage(): ReactElement {
  const identity = useSellerIdentity();

  if (!identity) {
    return (
      <>
        <PageHeader title="Profile" subtitle="Company info + contact." />
        <ErrorState message="Identity not loaded; try refreshing." />
      </>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Profile"
        subtitle="Read-only company info. To update, email support@skydrop.online."
      />
      <Card>
        <CardBody>
          <dl className="grid grid-cols-[180px_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-text-muted">Company</dt>
            <dd className="text-text-body">{identity.companyName}</dd>
            <dt className="text-text-muted">Contact person</dt>
            <dd className="text-text-body">{identity.contactPersonName}</dd>
            <dt className="text-text-muted">Email</dt>
            <dd className="text-text-body font-mono text-xs">{identity.emailDisplay}</dd>
            <dt className="text-text-muted">Phone</dt>
            <dd className="text-text-body font-mono text-xs">{identity.phone}</dd>
            {identity.whatsapp && (
              <>
                <dt className="text-text-muted">WhatsApp</dt>
                <dd className="text-text-body font-mono text-xs">
                  {identity.whatsapp}
                </dd>
              </>
            )}
            <dt className="text-text-muted">Country</dt>
            <dd className="text-text-body">{identity.countryCode}</dd>
            <dt className="text-text-muted">Display currency</dt>
            <dd className="text-text-body">{identity.displayCurrency}</dd>
            <dt className="text-text-muted">Display language</dt>
            <dd className="text-text-body uppercase">{identity.displayLanguage}</dd>
            <dt className="text-text-muted">Account status</dt>
            <dd className="text-text-body uppercase tracking-wide">{identity.status}</dd>
            <dt className="text-text-muted">Approved at</dt>
            <dd className="text-text-body">
              {identity.approvedAt
                ? new Date(identity.approvedAt).toLocaleString()
                : '—'}
            </dd>
            <dt className="text-text-muted">Email verified at</dt>
            <dd className="text-text-body">
              {identity.emailVerifiedAt
                ? new Date(identity.emailVerifiedAt).toLocaleString()
                : 'not verified'}
            </dd>
            <dt className="text-text-muted">Member since</dt>
            <dd className="text-text-body">
              {new Date(identity.createdAt).toLocaleDateString()}
            </dd>
          </dl>
        </CardBody>
      </Card>

      <div className="mt-4 text-text-faint text-xs">
        Edit-in-place + bank-account capture land with the Phase 1B
        remittance workflow.
      </div>
    </div>
  );
}
