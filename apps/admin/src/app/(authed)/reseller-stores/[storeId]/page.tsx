'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  EmptyState,
  ErrorState,
  LoadingState,
  Money,
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
import { useAdminResellerStoreTerms } from '@/lib/reseller-terms-hooks';
import { StoreWalletPanel } from './_components/store-wallet-panel';
import { usePermission } from '@/lib/use-permission';
import { PauseStoreModal } from '../_components/pause-store-modal';

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

/**
 * RS-4 — the store's terms, read-only: they are the seller's to publish and
 * the store's to accept. Shows who accepted each version, when and from
 * which address — the evidence if the two ever disagree about what was
 * agreed.
 */
function TermsSection({ storeId }: { storeId: string }): ReactElement {
  const terms = useAdminResellerStoreTerms(storeId);
  if (terms.isPending) return <LoadingState label="Loading the terms" rows={3} />;
  if (terms.isError) {
    return <ErrorState message={serverVerdict(terms.error)} retry={() => void terms.refetch()} />;
  }
  const t = terms.data;
  const c = t.current;
  return (
    <Section
      title="Terms"
      subtitle="Who pays which Skydrop fee on this store’s orders, and when each side is credited."
    >
      {c === null ? (
        <EmptyState
          title="No terms published"
          description="The store cannot place orders until the seller publishes terms and the store accepts them."
        />
      ) : (
        <div className="space-y-4">
          <p className="text-sm">
            Version {c.version}, published {when(c.publishedAt)} —{' '}
            {c.acceptance === null
              ? 'not accepted by the store yet.'
              : `accepted by ${c.acceptance.acceptedByName} on ${when(c.acceptance.acceptedAt)}${
                  c.acceptance.ipAddress === null ? '' : ` from ${c.acceptance.ipAddress}`
                }.`}
          </p>
          {t.needsRevision !== null ? (
            <p role="alert" className="text-critical text-sm">
              {t.needsRevision}
            </p>
          ) : null}
          <Table>
            <THead>
              <Tr>
                <Th>Fee</Th>
                <Th>Store pays</Th>
                <Th>Seller pays</Th>
                <Th>Example</Th>
              </Tr>
            </THead>
            <TBody>
              {c.shares.map((sh) => {
                const ex = t.examples.find((e) => e.feeType === sh.feeType);
                return (
                  <Tr key={sh.feeType}>
                    <Td>{sh.label}</Td>
                    <Td>{Number(sh.storePercent)}%</Td>
                    <Td>{Number(sh.sellerPercent)}%</Td>
                    <Td>
                      {ex === undefined ? (
                        '—'
                      ) : (
                        <>
                          <Money amount={ex.feeInr} convert={false} /> →{' '}
                          <Money amount={ex.storeInr} convert={false} /> /{' '}
                          <Money amount={ex.sellerInr} convert={false} />
                        </>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
          <ul className="space-y-1 text-sm">
            <li>{c.storeCredit.words}</li>
            <li>{c.sellerCredit.words}</li>
          </ul>
          <p className="text-text-muted text-xs">{t.rounding}</p>
        </div>
      )}
      {t.history.length > 1 ? (
        <div className="mt-4">
          <Table>
            <THead>
              <Tr>
                <Th>Version</Th>
                <Th>Published</Th>
                <Th>Accepted</Th>
                <Th>Note</Th>
              </Tr>
            </THead>
            <TBody>
              {t.history.map((v) => (
                <Tr key={v.id}>
                  <Td>{v.version}</Td>
                  <Td>{when(v.publishedAt)}</Td>
                  <Td>
                    {v.acceptance === null
                      ? '—'
                      : `${v.acceptance.acceptedByName}, ${when(v.acceptance.acceptedAt)}${
                          v.acceptance.ipAddress === null ? '' : ` (${v.acceptance.ipAddress})`
                        }`}
                  </Td>
                  <Td>{v.note ?? '—'}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      ) : null}
    </Section>
  );
}

/** One reseller store: its details, its status history and its team — read-only. */
export default function AdminResellerStorePage(): ReactElement {
  const { storeId } = useParams<{ storeId: string }>();
  const store = useAdminResellerStore(storeId);
  const mayPause = usePermission('reseller.stores.pause');
  const [pausing, setPausing] = useState(false);

  const back = (
    <div>
      <Link href="/reseller-stores" className="text-accent hover:text-accent-hover text-sm">
        ← All reseller stores
      </Link>
    </div>
  );
  // The header and the way back stay on screen while the store loads or
  // fails, so a slow or refused read never leaves a blank page.
  if (store.isPending || store.isError) {
    return (
      <div className="space-y-6">
        {back}
        <PageHeader title="Reseller store" />
        {store.isPending ? (
          <LoadingState label="Loading the store" rows={5} />
        ) : (
          <ErrorState message={serverVerdict(store.error)} retry={() => void store.refetch()} />
        )}
      </div>
    );
  }
  const s = store.data;

  return (
    <div className="space-y-6">
      {back}
      <PageHeader
        title={s.name}
        subtitle={<ResellerStoreStatusBadge status={s.status} />}
        action={
          mayPause && s.status === 'ACTIVE' ? (
            <Button variant="destructive" size="md" onClick={() => setPausing(true)}>
              Pause store
            </Button>
          ) : undefined
        }
      />
      {pausing ? (
        <PauseStoreModal storeId={s.id} storeName={s.name} onClose={() => setPausing(false)} />
      ) : null}

      <Card>
        <CardHeader title="Details" />
        <CardBody>
          <DescriptionList
            columns={2}
            items={[
              {
                label: 'Seller',
                value: (
                  <>
                    <Link href={`/sellers/${s.sellerId}`} className="text-accent">
                      {s.sellerCompanyName}
                    </Link>{' '}
                    <Link
                      href={`/reseller-stores?sellerId=${s.sellerId}`}
                      className="text-text-muted text-xs hover:underline"
                    >
                      (their other stores)
                    </Link>
                  </>
                ),
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
      <TermsSection storeId={s.id} />
      <StoreWalletPanel storeId={s.id} />

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
