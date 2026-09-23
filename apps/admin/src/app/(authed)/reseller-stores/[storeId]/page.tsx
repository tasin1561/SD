'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import { PauseCircle } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { resellerStoreStatusKind, resellerStoreStatusLabel } from '@skydrop/ui/status';
import { Button } from '@skydrop/ui/app/button';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Timeline } from '@skydrop/ui/app/timeline';
import { TBody, THead, Table, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import {
  AcAlert,
  AcCard,
  AcDl,
  AcHeader,
  AcPage,
  AcSection,
} from '../../settings/_components/ac-parts';
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
  if (terms.isPending) return <SkeletonRows rows={3} cols={4} label="Loading the terms" />;
  if (terms.isError) {
    return <ErrorState message={serverVerdict(terms.error)} retry={() => void terms.refetch()} />;
  }
  const t = terms.data;
  const c = t.current;
  return (
    <AcSection
      title="Terms"
      note="Who pays which Skydrop fee on this store’s orders, and when each side is credited."
      bare
    >
      {c === null ? (
        <EmptyState
          title="No terms published"
          description="The store cannot place orders until the seller publishes terms and the store accepts them."
        />
      ) : (
        <AcCard flush>
          <div className="ac-pad">
            <p className="ac-text">
              Version <span className="sk-figure">{c.version}</span>, published{' '}
              {when(c.publishedAt)} —{' '}
              {c.acceptance === null
                ? 'not accepted by the store yet.'
                : `accepted by ${c.acceptance.acceptedByName} on ${when(c.acceptance.acceptedAt)}${
                    c.acceptance.ipAddress === null ? '' : ` from ${c.acceptance.ipAddress}`
                  }.`}
            </p>
          </div>
          {t.needsRevision !== null ? (
            <div className="ac-pad">
              <AcAlert message={t.needsRevision} />
            </div>
          ) : null}
          <Table caption="Fee shares">
            <THead>
              <Tr>
                <Th>Fee</Th>
                <Th align="right">Store pays</Th>
                <Th align="right">Seller pays</Th>
                <Th>Example</Th>
              </Tr>
            </THead>
            <TBody>
              {c.shares.map((sh) => {
                const ex = t.examples.find((e) => e.feeType === sh.feeType);
                return (
                  <Tr key={sh.feeType}>
                    <Td>{sh.label}</Td>
                    <Td align="right">
                      <span className="sk-figure">{Number(sh.storePercent)}%</span>
                    </Td>
                    <Td align="right">
                      <span className="sk-figure">{Number(sh.sellerPercent)}%</span>
                    </Td>
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
          <div className="ac-pad">
            <ul className="ac-list">
              <li>{c.storeCredit.words}</li>
              <li>{c.sellerCredit.words}</li>
            </ul>
            <p className="ac-muted">{t.rounding}</p>
          </div>
        </AcCard>
      )}
      {t.history.length > 1 ? (
        <AcCard flush title="Earlier versions">
          <Table caption="Terms versions">
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
                  <Td>
                    <span className="sk-figure">{v.version}</span>
                  </Td>
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
        </AcCard>
      ) : null}
    </AcSection>
  );
}

/** One reseller store: its details, its status history and its team — read-only. */
export default function AdminResellerStorePage(): ReactElement {
  const { storeId } = useParams<{ storeId: string }>();
  const store = useAdminResellerStore(storeId);
  const mayPause = usePermission('reseller.stores.pause');
  const [pausing, setPausing] = useState(false);

  const crumbs = [{ label: 'Reseller stores', href: '/reseller-stores' }] as const;
  // The header and the way back stay on screen while the store loads or
  // fails, so a slow or refused read never leaves a blank page.
  if (store.isPending || store.isError) {
    return (
      <AcPage>
        <AcHeader crumbs={[...crumbs, { label: 'Reseller store' }]} title="Reseller store" />
        {store.isPending ? (
          <SkeletonRows rows={5} cols={2} label="Loading the store" />
        ) : (
          <ErrorState message={serverVerdict(store.error)} retry={() => void store.refetch()} />
        )}
      </AcPage>
    );
  }
  const s = store.data;
  const events = s.events;

  return (
    <AcPage>
      <AcHeader
        crumbs={[...crumbs, { label: s.name }]}
        title={s.name}
        meta={
          <div className="ac-meta">
            <StatusChip
              kind={resellerStoreStatusKind(s.status)}
              label={resellerStoreStatusLabel(s.status)}
            />
          </div>
        }
        action={
          mayPause && s.status === 'ACTIVE' ? (
            <Button
              variant="destructive"
              size="md"
              icon={<PauseCircle size={15} />}
              onClick={() => setPausing(true)}
            >
              Pause store
            </Button>
          ) : undefined
        }
      />
      {pausing ? (
        <PauseStoreModal storeId={s.id} storeName={s.name} onClose={() => setPausing(false)} />
      ) : null}

      <AcSection title="Details">
        <AcDl
          columns={2}
          items={[
            {
              label: 'Seller',
              value: (
                <span className="ac-inline">
                  <Link href={`/sellers/${s.sellerId}`} className="ac-link">
                    {s.sellerCompanyName}
                  </Link>
                  <Link
                    href={`/reseller-stores?sellerId=${s.sellerId}`}
                    className="ac-link ac-faint"
                  >
                    (their other stores)
                  </Link>
                </span>
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
      </AcSection>

      <CatalogueTerms storeId={s.id} />
      <TermsSection storeId={s.id} />
      <StoreWalletPanel storeId={s.id} />

      <AcSection title="Status history" note="Every change to this store’s life, oldest first.">
        {events.length === 0 ? (
          <EmptyState bare title="No history" />
        ) : (
          <Timeline
            label="Status history"
            steps={events.map((e, i) => ({
              id: e.id,
              label: EVENT_WORDS[e.kind] ?? e.kind,
              state: i === events.length - 1 ? ('current' as const) : ('done' as const),
              time: when(e.createdAt),
              description: (
                <>
                  {e.fromStatus === null && e.toStatus === null
                    ? '—'
                    : `${e.fromStatus?.toLowerCase().replace(/_/g, ' ') ?? 'new'} → ${
                        e.toStatus?.toLowerCase().replace(/_/g, ' ') ?? '—'
                      }`}
                  {' · '}
                  {ACTOR_WORDS[e.actorType] ?? e.actorType}
                  {e.note === null ? null : (
                    <>
                      {' · '}
                      {e.note}
                    </>
                  )}
                </>
              ),
            }))}
          />
        )}
      </AcSection>

      <AcSection
        title="Team"
        note="Logins on the reseller portal, and invitations still open."
        flush
      >
        {s.team.members.length === 0 && s.team.invitations.length === 0 ? (
          <EmptyState
            bare
            title="Nobody on the team yet"
            description="The seller invites the store’s first user."
          />
        ) : (
          <Table caption="Store team">
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
                  <Td>
                    <span className="ac-cell-main">{m.fullName}</span>
                  </Td>
                  <Td>{m.email}</Td>
                  <Td>{m.roleName}</Td>
                  <Td>Last signed in {when(m.lastLoginAt)}</Td>
                </Tr>
              ))}
              {s.team.invitations.map((i) => (
                <Tr key={i.id}>
                  <Td>
                    <span className="ac-cell-main">{i.fullName}</span>
                  </Td>
                  <Td>{i.email}</Td>
                  <Td>{i.roleName}</Td>
                  <Td>Invited — expires {when(i.expiresAt)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </AcSection>
    </AcPage>
  );
}
