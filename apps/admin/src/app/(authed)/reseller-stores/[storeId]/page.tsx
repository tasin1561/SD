'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import { PauseCircle, ShieldAlert } from 'lucide-react';
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
import { StartImpersonationDialog } from '../../impersonation/_components/start-impersonation-dialog';
import { useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

function when(iso: string | null): string {
  return iso === null
    ? '—'
    : new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

const EVENT_WORDS = (tr: Translate<MessageKey>): Record<string, string> => ({
  CREATED: tr('resellerStoresStoreIdPage.opened'),
  APPROVED: tr('resellerStoresStoreIdPage.approvedByTheClient'),
  REJECTED: tr('resellerStoresStoreIdPage.rejectedByTheClient'),
  PAUSED: tr('resellerStoresStoreIdPage.paused'),
  RESUMED: tr('resellerStoresStoreIdPage.resumed'),
  CLOSED: tr('resellerStoresStoreIdPage.closed'),
  WALLET_MANAGER_CHANGED: tr('resellerStoresStoreIdPage.walletManagerChanged'),
});

const ACTOR_WORDS = (tr: Translate<MessageKey>): Record<string, string> => ({
  STAFF: tr('resellerStoresStoreIdPage.skydropStaff'),
  SELLER: tr('resellerStoresStoreIdPage.theClient'),
  STORE: tr('resellerStoresStoreIdPage.theStore'),
  SYSTEM: tr('resellerStoresStoreIdPage.system'),
  API: tr('resellerStoresStoreIdPage.theClientSSystems'),
});

/**
 * RS-4 — the store's terms, read-only: they are the seller's to publish and
 * the store's to accept. Shows who accepted each version, when and from
 * which address — the evidence if the two ever disagree about what was
 * agreed.
 */
function TermsSection({ storeId }: { storeId: string }): ReactElement {
  const tr = useT();
  const terms = useAdminResellerStoreTerms(storeId);
  if (terms.isPending)
    return (
      <SkeletonRows rows={3} cols={4} label={tr('resellerStoresStoreIdPage.loadingTheTerms')} />
    );
  if (terms.isError) {
    return <ErrorState message={serverVerdict(terms.error)} retry={() => void terms.refetch()} />;
  }
  const t = terms.data;
  const c = t.current;
  return (
    <AcSection
      title={tr('resellerStoresStoreIdPage.terms')}
      note={tr('resellerStoresStoreIdPage.whoPaysWhichSkydropFee')}
      bare
    >
      {c === null ? (
        <EmptyState
          title={tr('resellerStoresStoreIdPage.noTermsPublished')}
          description={tr('resellerStoresStoreIdPage.theStoreCannotPlaceOrders')}
        />
      ) : (
        <AcCard flush>
          <div className="ac-pad">
            <p className="ac-text">
              Version <span className="sk-figure">{c.version}</span>, published{' '}
              {when(c.publishedAt)} —{' '}
              {c.acceptance === null
                ? tr('resellerStoresStoreIdPage.notAcceptedByTheStore')
                : tr('resellerStoresStoreIdPage.acceptedByOn', {
                    acceptedByName: c.acceptance.acceptedByName,
                    value: when(c.acceptance.acceptedAt),
                    value2:
                      c.acceptance.ipAddress === null ? '' : ` from ${c.acceptance.ipAddress}`,
                  })}
            </p>
          </div>
          {t.needsRevision !== null ? (
            <div className="ac-pad">
              <AcAlert message={t.needsRevision} />
            </div>
          ) : null}
          <Table caption={tr('resellerStoresStoreIdPage.feeShares')}>
            <THead>
              <Tr>
                <Th>{tr('resellerStoresStoreIdPage.fee')}</Th>
                <Th align="right">{tr('resellerStoresStoreIdPage.storePays')}</Th>
                <Th align="right">{tr('resellerStoresStoreIdPage.clientPays')}</Th>
                <Th>{tr('resellerStoresStoreIdPage.example')}</Th>
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
        <AcCard flush title={tr('resellerStoresStoreIdPage.earlierVersions')}>
          <Table caption={tr('resellerStoresStoreIdPage.termsVersions')}>
            <THead>
              <Tr>
                <Th>{tr('resellerStoresStoreIdPage.version')}</Th>
                <Th>{tr('resellerStoresStoreIdPage.published')}</Th>
                <Th>{tr('resellerStoresStoreIdPage.accepted')}</Th>
                <Th>{tr('resellerStoresStoreIdPage.note')}</Th>
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
  const tr = useT();
  const { storeId } = useParams<{ storeId: string }>();
  const store = useAdminResellerStore(storeId);
  const mayPause = usePermission('reseller.stores.pause');
  const [pausing, setPausing] = useState(false);
  // Going INSIDE the store's account. `support.impersonate` opens a
  // session; whether it may also WRITE is asked in the dialog, which is
  // where the choice is actually made.
  const canImpersonate = usePermission('support.impersonate');
  const [impersonating, setImpersonating] = useState(false);

  const crumbs = [
    { label: tr('resellerStoresStoreIdPage.memberStores'), href: '/reseller-stores' },
  ] as const;
  // The header and the way back stay on screen while the store loads or
  // fails, so a slow or refused read never leaves a blank page.
  if (store.isPending || store.isError) {
    return (
      <AcPage>
        <AcHeader
          crumbs={[...crumbs, { label: tr('resellerStoresStoreIdPage.memberStore') }]}
          title={tr('resellerStoresStoreIdPage.memberStore')}
        />
        {store.isPending ? (
          <SkeletonRows rows={5} cols={2} label={tr('resellerStoresStoreIdPage.loadingTheStore')} />
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
          <div className="ac-buttons">
            {canImpersonate ? (
              /* Destructive, because for as long as the session lasts
                 this console's operator is indistinguishable from the
                 shopkeeper in their own store's history. */
              <Button
                variant="destructive"
                size="md"
                icon={<ShieldAlert size={15} />}
                onClick={() => setImpersonating(true)}
              >
                {tr('resellerStoresStoreIdPage.signInAs', { name: s.name })}
              </Button>
            ) : null}
            {mayPause && s.status === 'ACTIVE' ? (
              <Button
                variant="destructive"
                size="md"
                icon={<PauseCircle size={15} />}
                onClick={() => setPausing(true)}
              >
                {tr('resellerStoresStoreIdPage.pauseStore')}
              </Button>
            ) : null}
          </div>
        }
      />
      {pausing ? (
        <PauseStoreModal storeId={s.id} storeName={s.name} onClose={() => setPausing(false)} />
      ) : null}
      {impersonating ? (
        <StartImpersonationDialog
          subjectKind="STORE"
          subjectId={s.id}
          subjectName={s.name}
          onClose={() => setImpersonating(false)}
        />
      ) : null}

      <AcSection title={tr('resellerStoresStoreIdPage.details')}>
        <AcDl
          columns={2}
          items={[
            {
              label: tr('resellerStoresStoreIdPage.client'),
              value: (
                <span className="ac-inline">
                  <Link href={`/sellers/${s.sellerId}`} className="ac-link">
                    {s.sellerCompanyName}
                  </Link>
                  <Link
                    href={`/reseller-stores?sellerId=${s.sellerId}`}
                    className="ac-link ac-faint"
                  >
                    {tr('resellerStoresStoreIdPage.theirOtherStores')}
                  </Link>
                </span>
              ),
            },
            { label: tr('resellerStoresStoreIdPage.customersSee'), value: s.displayName ?? s.name },
            {
              label: tr('resellerStoresStoreIdPage.openedBy'),
              value:
                s.origin === 'ADMIN'
                  ? tr('resellerStoresStoreIdPage.skydrop')
                  : tr('resellerStoresStoreIdPage.theClient'),
            },
            {
              label: tr('resellerStoresStoreIdPage.walletManagedBy'),
              value:
                s.walletManagedBy === 'SKYDROP'
                  ? tr('resellerStoresStoreIdPage.skydrop')
                  : tr('resellerStoresStoreIdPage.theClient'),
            },
            { label: tr('resellerStoresStoreIdPage.contactEmail'), value: s.contactEmail ?? '—' },
            { label: tr('resellerStoresStoreIdPage.contactPhone'), value: s.contactPhone ?? '—' },
            { label: tr('resellerStoresStoreIdPage.note'), value: s.note ?? '—' },
            { label: tr('resellerStoresStoreIdPage.statusSince'), value: when(s.statusChangedAt) },
          ]}
        />
      </AcSection>

      <CatalogueTerms storeId={s.id} />
      <TermsSection storeId={s.id} />
      <StoreWalletPanel storeId={s.id} />

      <AcSection
        title={tr('resellerStoresStoreIdPage.statusHistory')}
        note={tr('resellerStoresStoreIdPage.everyChangeToThisStore')}
      >
        {events.length === 0 ? (
          <EmptyState bare title={tr('resellerStoresStoreIdPage.noHistory')} />
        ) : (
          <Timeline
            label={tr('resellerStoresStoreIdPage.statusHistory')}
            steps={events.map((e, i) => ({
              id: e.id,
              label: EVENT_WORDS(tr)[e.kind] ?? e.kind,
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
                  {ACTOR_WORDS(tr)[e.actorType] ?? e.actorType}
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
        title={tr('resellerStoresStoreIdPage.team')}
        note={tr('resellerStoresStoreIdPage.loginsOnTheMemberStore')}
        flush
      >
        {s.team.members.length === 0 && s.team.invitations.length === 0 ? (
          <EmptyState
            bare
            title={tr('resellerStoresStoreIdPage.nobodyOnTheTeamYet')}
            description={tr('resellerStoresStoreIdPage.theClientInvitesTheStore')}
          />
        ) : (
          <Table caption={tr('resellerStoresStoreIdPage.storeTeam')}>
            <THead>
              <Tr>
                <Th>{tr('resellerStoresStoreIdPage.name')}</Th>
                <Th>{tr('resellerStoresStoreIdPage.email')}</Th>
                <Th>{tr('resellerStoresStoreIdPage.role')}</Th>
                <Th>{tr('resellerStoresStoreIdPage.state')}</Th>
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
                  <Td>
                    {tr('resellerStoresStoreIdPage.lastSignedIn', { value: when(m.lastLoginAt) })}
                  </Td>
                </Tr>
              ))}
              {s.team.invitations.map((i) => (
                <Tr key={i.id}>
                  <Td>
                    <span className="ac-cell-main">{i.fullName}</span>
                  </Td>
                  <Td>{i.email}</Td>
                  <Td>{i.roleName}</Td>
                  <Td>
                    {tr('resellerStoresStoreIdPage.invitedExpires', { value: when(i.expiresAt) })}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </AcSection>
    </AcPage>
  );
}
