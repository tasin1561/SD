'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { ReactElement } from 'react';
import { useSellerDetail } from '@/lib/api-hooks';
import { useStaffIdentity, hasStaffRole } from '@skydrop/auth/client';
import type { StaffRole } from '@skydrop/db';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ErrorState, LoadingState, PageHeader, Section } from '@/components/ui/page';
import { SellerStatusBadge } from '@/components/ui/status-badge';
import { StatusActionPanel } from './status-action-panel';

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
        <ErrorState message={detail.error?.message ?? 'Failed to load seller.'} />
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
                <dl className="grid grid-cols-[160px_1fr] gap-x-6 gap-y-1.5 text-sm">
                  <dt className="text-text-muted">Contact name</dt>
                  <dd className="text-text-body">{detail.data.contactPersonName}</dd>
                  <dt className="text-text-muted">Phone</dt>
                  <dd className="text-text-body font-mono text-xs">
                    {detail.data.phone}
                  </dd>
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
                        {new Date(detail.data.emailVerifiedAt)
                          .toISOString()
                          .slice(0, 10)}
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
        </>
      )}
    </div>
  );
}
