'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ReactElement } from 'react';
import {
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  ResellerStoreStatusBadge,
  Section,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { useAdminResellerStore } from '@/lib/reseller-store-hooks';
import { CatalogueTerms } from './_components/catalogue-terms';

function when(iso: string | null): string {
  return iso === null
    ? '—'
    : new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

const EVENT_WORDS: Record<string, string> = {
  CREATED: 'Opened',
  APPROVED: 'Approved by the seller',
  REJECTED: 'Rejected by the seller',
  PAUSED: 'Paused',
  RESUMED: 'Resumed',
  CLOSED: 'Closed',
  WALLET_MANAGER_CHANGED: 'Wallet manager changed',
};

const ACTOR_WORDS: Record<string, string> = {
  STAFF: 'Skydrop staff',
  SELLER: 'The seller',
  STORE: 'The store',
  SYSTEM: 'System',
  API: 'The seller’s systems',
};

/** One reseller store: its details, its status history and its team — read-only. */
export default function AdminResellerStorePage(): ReactElement {
  const { storeId } = useParams<{ storeId: string }>();
  const store = useAdminResellerStore(storeId);

  if (store.isPending) return <LoadingState label="Loading the store" rows={5} />;
  if (store.isError) {
    return <ErrorState message={serverVerdict(store.error)} retry={() => void store.refetch()} />;
  }
  const s = store.data;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reseller-stores" className="text-accent hover:text-accent-hover text-sm">
          ← All reseller stores
        </Link>
      </div>
      <PageHeader title={s.name} subtitle={<ResellerStoreStatusBadge status={s.status} />} />

      <Card>
        <CardHeader title="Details" />
        <CardBody>
          <DescriptionList
            columns={2}
            items={[
              {
                label: 'Seller',
                value: <Link href={`/sellers/${s.sellerId}`}>{s.sellerCompanyName}</Link>,
              },
              { label: 'Customers see', value: s.displayName ?? s.name },
              { label: 'Opened by', value: s.origin === 'ADMIN' ? 'Skydrop' : 'The seller' },
              {
                label: 'Wallet managed by',
                value: s.walletManagedBy === 'SKYDROP' ? 'Skydrop' : 'The seller',
              },
              { label: 'Contact email', value: s.contactEmail ?? '—' },
              { label: 'Contact phone', value: s.contactPhone ?? '—' },
              { label: 'Note', value: s.note ?? '—' },
              { label: 'Status since', value: when(s.statusChangedAt) },
            ]}
          />
        </CardBody>
      </Card>

      <CatalogueTerms storeId={s.id} />

      <Section title="Status history" subtitle="Every change to this store’s life, oldest first.">
        {s.events.length === 0 ? (
          <EmptyState title="No history" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>When</Th>
                <Th>What</Th>
                <Th>From → to</Th>
                <Th>By</Th>
                <Th>Note</Th>
              </Tr>
            </THead>
            <TBody>
              {s.events.map((e) => (
                <Tr key={e.id}>
                  <Td>{when(e.createdAt)}</Td>
                  <Td>{EVENT_WORDS[e.kind] ?? e.kind}</Td>
                  <Td>
                    {e.fromStatus === null && e.toStatus === null
                      ? '—'
                      : `${e.fromStatus?.toLowerCase().replace(/_/g, ' ') ?? 'new'} → ${
                          e.toStatus?.toLowerCase().replace(/_/g, ' ') ?? '—'
                        }`}
                  </Td>
                  <Td>{ACTOR_WORDS[e.actorType] ?? e.actorType}</Td>
                  <Td>{e.note ?? '—'}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      <Section title="Team" subtitle="Logins on the reseller portal, and invitations still open.">
        {s.team.members.length === 0 && s.team.invitations.length === 0 ? (
          <EmptyState
            title="Nobody on the team yet"
            description="The seller invites the store’s first user."
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>State</Th>
              </Tr>
            </THead>
            <TBody>
              {s.team.members.map((m) => (
                <Tr key={m.id}>
                  <Td>{m.fullName}</Td>
                  <Td>{m.email}</Td>
                  <Td>{m.roleName}</Td>
                  <Td>Last signed in {when(m.lastLoginAt)}</Td>
                </Tr>
              ))}
              {s.team.invitations.map((i) => (
                <Tr key={i.id}>
                  <Td>{i.fullName}</Td>
                  <Td>{i.email}</Td>
                  <Td>{i.roleName}</Td>
                  <Td>Invited — expires {when(i.expiresAt)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
