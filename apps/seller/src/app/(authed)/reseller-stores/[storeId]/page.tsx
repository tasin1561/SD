'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent, type ReactElement } from 'react';
import {
  CalendarClock,
  CircleDot,
  CirclePause,
  CirclePlay,
  AlertTriangle,
  Mail,
  Store,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { KpiCard, type KpiTone } from '@skydrop/ui/app/kpi-card';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Tabs } from '@skydrop/ui/app/tabs';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { MultiSelect } from '@skydrop/ui/app/multi-select';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton, SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { resellerStoreStatusKind, resellerStoreStatusLabel } from '@skydrop/ui/status';
import type { ResellerStoreStatusValue } from '@skydrop/api-client';
import { verdict } from '@/i18n/verdict';
import { roleLine } from '@/lib/role-words';
import { StoreActionsSection } from './_components/store-actions-section';
import { StoreCatalogue } from './_components/store-catalogue';
import { StoreWalletSection } from './_components/store-wallet-section';
import {
  useApproveResellerStore,
  useCloseResellerStore,
  useInviteToResellerStore,
  useResendResellerInvitation,
  usePauseResellerStore,
  useRejectResellerStore,
  useResellerStore,
  useResumeResellerStore,
  useRevokeResellerInvitation,
  useSetWalletManager,
  type InviteInput,
  type ResellerStoreDetail,
  type StoreRoleKey,
  type WalletManager,
} from '@/lib/reseller-store-hooks';
import { TermsSection } from './_components/terms-section';
import {
  RsBack,
  RsError,
  RsFact,
  RsFacts,
  RsLink,
  RsSection,
  pendingPhase,
} from '../_components/rs-parts';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

type StoreTab = 'overview' | 'catalogue' | 'terms' | 'actions';

function isStoreTab(id: string): id is StoreTab {
  return id === 'overview' || id === 'catalogue' || id === 'terms' || id === 'actions';
}

function when(iso: string | null): string {
  return iso === null
    ? '—'
    : new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Day and month only — a tile is a glance, not a timestamp. */
function day(iso: string | null): string {
  return iso === null
    ? '—'
    : new Date(iso).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
}

const eventWordsOf = (t: Translate<MessageKey>): Record<string, string> => ({
  CREATED: t('resellerStoreDetail.opened'),
  APPROVED: t('resellerStoreDetail.approved'),
  REJECTED: t('resellerStoreDetail.rejected'),
  PAUSED: t('resellerStoreDetail.paused'),
  RESUMED: t('resellerStoreDetail.resumed'),
  CLOSED: t('resellerStoreDetail.closed'),
  WALLET_MANAGER_CHANGED: t('resellerStoreDetail.walletManagerChanged'),
});

const actorWordsOf = (t: Translate<MessageKey>): Record<string, string> => ({
  STAFF: t('resellerStoreDetail.skydrop2'),
  SELLER: t('resellerStoreDetail.you2'),
  STORE: t('resellerStoreDetail.theStore'),
  SYSTEM: t('resellerStoreDetail.system'),
  API: t('resellerStoreDetail.yourSystems'),
});

/**
 * The tone of the STATUS card.
 *
 * EXHAUSTIVE over `ResellerStoreStatusValue` (the F2 discipline): the
 * `never` assignment means a new state fails to COMPILE until somebody
 * decides whether it reads as open, waiting or finished.
 *
 * Deliberately NOT a reach into the chip's own kind mapping, which
 * answers a different question — what colour a CHIP is. The distinction
 * worth drawing here is "selling" versus "not selling", which is what a
 * seller is scanning the page for. The four tones are the ones the tile
 * always had (good / warn / bad / neutral), drawn in the KPI card's hues.
 */
function statusTone(status: ResellerStoreStatusValue): KpiTone {
  switch (status) {
    case 'ACTIVE':
      return 'credit';
    case 'PENDING_SELLER_APPROVAL':
    case 'PAUSED':
      return 'pending';
    case 'REJECTED':
    case 'CLOSED':
      return 'debit';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function statusWords(t: Translate<MessageKey>, status: ResellerStoreStatusValue): string {
  switch (status) {
    case 'ACTIVE':
      return t('resellerStoreDetail.selling');
    case 'PENDING_SELLER_APPROVAL':
      return t('resellerStoreDetail.awaitingYou');
    case 'PAUSED':
      return t('resellerStoreDetail.paused');
    case 'REJECTED':
      return t('resellerStoreDetail.rejected');
    case 'CLOSED':
      return t('resellerStoreDetail.closed');
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

/**
 * One reseller store: its life, who manages its wallet, its team, its
 * history.
 *
 * ── WHAT THE CONSOLE COMPS SHOW THAT IS NOT HERE ────────────────────
 *   ORDERS / REVENUE FOR THIS STORE   real, but over a WINDOW that has
 *       to be chosen, and that is the reports page — which this links
 *       to. A figure with no window beside it is one nobody could
 *       reproduce.
 *   A CONTRACT / SIGNED-ON DATE       the terms are versioned and the
 *       store ACCEPTS a version; that history is on the Terms tab. The
 *       store row itself carries no signing date.
 */
export default function ResellerStorePage(): ReactElement {
  const t = useT();
  const { storeId } = useParams<{ storeId: string }>();
  const store = useResellerStore(storeId);
  const [tab, setTab] = useState<StoreTab>('overview');

  if (store.isPending || store.isError) {
    // The way back and the page's name stay put while it loads or fails —
    // an error with nothing around it reads as a broken app, not a store.
    return (
      <div className="rs-page">
        <div className="rs-head">
          <RsBack href="/reseller-stores">{t('resellerStoreDetail.allMemberStores')}</RsBack>
          <PageHeader
            breadcrumbs={[
              { label: t('resellerStoreDetail.clientConsole') },
              { label: t('resellerStoreDetail.reselling') },
              { label: t('resellerStoreDetail.stores'), href: '/reseller-stores' },
              { label: t('resellerStoreDetail.store') },
            ]}
            Link={Link}
            title={t('resellerStoreDetail.memberStore')}
          />
        </div>
        {store.isPending ? (
          <>
            <div className="rs-kpis">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="rs-kpi-skel" height={104} rounded="md" />
              ))}
            </div>
            <SkeletonRows rows={5} cols={4} label={t('resellerStoreDetail.loadingTheStore')} />
          </>
        ) : (
          <ErrorState message={verdict(store.error, t)} retry={() => void store.refetch()} />
        )}
      </div>
    );
  }
  const s = store.data;
  const open = s.status === 'ACTIVE' || s.status === 'PAUSED';
  const final = s.status === 'CLOSED' || s.status === 'REJECTED';
  const invited = s.team.invitations.length;

  return (
    <div className="rs-page">
      <div className="rs-head">
        <RsBack href="/reseller-stores">{t('resellerStoreDetail.allMemberStores')}</RsBack>
        <PageHeader
          breadcrumbs={[
            { label: t('resellerStoreDetail.clientConsole') },
            { label: t('resellerStoreDetail.reselling') },
            { label: t('resellerStoreDetail.stores'), href: '/reseller-stores' },
            { label: s.name },
          ]}
          Link={Link}
          title={s.name}
          subtitle={
            s.displayName === null
              ? t('resellerStoreDetail.customersSeeThisName')
              : t('resellerStoreDetail.customersSee', { displayName: s.displayName })
          }
          meta={
            <RsFacts>
              <RsFact tone={s.origin === 'ADMIN' ? 'accent' : undefined}>
                {t(
                  s.origin === 'ADMIN'
                    ? 'resellerStoreDetail.openedBySkydrop'
                    : 'resellerStoreDetail.openedByYou',
                )}
              </RsFact>
              <RsFact>
                {t(
                  s.walletManagedBy === 'SKYDROP'
                    ? 'resellerStoreDetail.walletRunBySkydrop'
                    : 'resellerStoreDetail.walletRunByYou',
                )}
              </RsFact>
              {invited > 0 && (
                <RsFact tone="warn" dot>
                  {invited} invitation{invited === 1 ? '' : 's'} outstanding
                </RsFact>
              )}
            </RsFacts>
          }
          action={
            <div className="rs-actions">
              <StatusChip
                kind={resellerStoreStatusKind(s.status)}
                label={resellerStoreStatusLabel(s.status)}
              />
              <RsLink href={`/orders?storeId=${encodeURIComponent(s.id)}`}>
                {t('resellerStoreDetail.itsOrders')}
              </RsLink>
              <RsLink href="/reseller-stores/reports">{t('resellerStoreDetail.reports')}</RsLink>
            </div>
          }
        />
      </div>

      {/* ── Standing facts about this store ─────────────────────────
             Four cards, every one a column on the store row — nothing
             derived and nothing summed from another endpoint. What it
             has EARNED needs a window and lives on the reports page. Only
             the team count is a plain number, so only it rolls up. */}
      <div className="rs-kpis">
        <KpiCard
          label={t('resellerStoreDetail.status')}
          icon={<CircleDot size={14} />}
          figure={statusWords(t, s.status)}
          tone={statusTone(s.status)}
          hint={
            s.statusChangedAt === null
              ? t('resellerStoreDetail.sinceItWasOpened')
              : t('resellerStoreDetail.since', { statusChangedAt: day(s.statusChangedAt) })
          }
        />
        <KpiCard
          label={t('resellerStoreDetail.team')}
          icon={<Users size={14} />}
          value={s.memberCount}
          unit={s.memberCount === 1 ? 'person' : 'people'}
          tone="neutral"
          hint={
            invited === 0
              ? t('resellerStoreDetail.everyoneWhoCanSign')
              : t('resellerStoreDetail.moreInvitedAndNot', { invited })
          }
        />
        <KpiCard
          label={t('resellerStoreDetail.walletManagedBy')}
          icon={<Wallet size={14} />}
          figure={s.walletManagedBy === 'SKYDROP' ? 'Skydrop' : t('resellerStoreDetail.youCap')}
          tone="neutral"
          hint={
            s.walletManagedBy === 'SKYDROP'
              ? t('resellerStoreDetail.itTopsUpTo')
              : t('resellerStoreDetail.youTopItUp')
          }
        />
        <KpiCard
          label={t('resellerStoreDetail.opened')}
          icon={<CalendarClock size={14} />}
          figure={day(s.createdAt)}
          tone="neutral"
          hint={t(
            s.events.length === 1
              ? 'resellerStoreDetail.historyEntryOne'
              : 'resellerStoreDetail.historyEntryMany',
            { count: s.events.length },
          )}
        />
      </div>

      {/* A real tablist now: the primitive provides what the old chips
          only claimed — roving focus, arrow keys, and a `tabpanel`
          labelled by its tab. Only the chosen panel is mounted, exactly
          as before, so a tab's data is asked for when it is opened. */}
      <Tabs
        label={t('resellerStoreDetail.storeSections')}
        panelClassName="rs-panel"
        value={tab}
        onChange={(id) => {
          if (isStoreTab(id)) setTab(id);
        }}
        items={[
          {
            id: 'overview',
            label: t('resellerStoreDetail.overview'),
            panel: <OverviewTab store={s} open={open} final={final} />,
          },
          {
            id: 'catalogue',
            label: t('resellerStoreDetail.catalogueStock'),
            panel: <StoreCatalogue storeId={s.id} storeName={s.name} final={final} />,
          },
          {
            id: 'terms',
            label: t('resellerStoreDetail.terms'),
            panel: <TermsSection storeId={s.id} final={final} />,
          },
          {
            id: 'actions',
            label: t('resellerStoreDetail.whatTheyCanDo'),
            panel: <StoreActionsSection storeId={s.id} storeName={s.name} final={final} />,
          },
        ]}
      />
    </div>
  );
}

function OverviewTab({
  store: s,
  open,
  final,
}: {
  store: ResellerStoreDetail;
  open: boolean;
  final: boolean;
}): ReactElement {
  const t = useT();
  const details: ReadonlyArray<{ label: string; value: string }> = [
    { label: t('resellerStoreDetail.customersSee2'), value: s.displayName ?? s.name },
    {
      label: t('resellerStoreDetail.openedBy'),
      value: s.origin === 'ADMIN' ? 'Skydrop' : t('resellerStoreDetail.youCap'),
    },
    { label: t('resellerStoreDetail.contactEmail'), value: s.contactEmail ?? '—' },
    { label: t('resellerStoreDetail.contactPhone'), value: s.contactPhone ?? '—' },
    { label: t('resellerStoreDetail.note2'), value: s.note ?? '—' },
    { label: t('resellerStoreDetail.statusSince'), value: when(s.statusChangedAt) },
  ];
  return (
    <>
      {s.status === 'PENDING_SELLER_APPROVAL' ? <DecisionCard store={s} /> : null}
      {open ? <LifecycleCard store={s} /> : null}

      <RsSection
        title={t('resellerStoreDetail.details')}
        note={t('resellerStoreDetail.howWeHoldThis')}
      >
        <dl className="rs-facts-list">
          {details.map((d) => (
            <div key={d.label} className="rs-facts-list__item">
              <dt>{d.label}</dt>
              <dd>{d.value}</dd>
            </div>
          ))}
        </dl>
      </RsSection>

      <WalletCard store={s} disabled={final} />
      <StoreWalletSection store={s} />
      <TeamSection store={s} canInvite={open} />

      <RsSection
        title={t('resellerStoreDetail.history')}
        note={t('resellerStoreDetail.everyChangeToThis')}
        flush
      >
        {s.events.length === 0 ? (
          <EmptyState bare title={t('resellerStoreDetail.noHistoryYet')} />
        ) : (
          <Table caption={t('resellerStoreDetail.storeHistory')}>
            <THead>
              <Tr>
                <Th>{t('resellerStoreDetail.when')}</Th>
                <Th>{t('resellerStoreDetail.what')}</Th>
                <Th>{t('resellerStoreDetail.by')}</Th>
                <Th>{t('resellerStoreDetail.note2')}</Th>
              </Tr>
            </THead>
            <TBody>
              {s.events.map((e) => (
                <Tr key={e.id}>
                  <Td className="rs-when sk-figure">{when(e.createdAt)}</Td>
                  <Td className="rs-strong">{eventWordsOf(t)[e.kind] ?? e.kind}</Td>
                  <Td className="rs-small">{actorWordsOf(t)[e.actorType] ?? e.actorType}</Td>
                  <Td className="rs-small">{e.note ?? '—'}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </RsSection>
    </>
  );
}

function DecisionCard({ store }: { store: ResellerStoreDetail }): ReactElement {
  const t = useT();
  const toast = useToast();
  const approve = useApproveResellerStore();
  const reject = useRejectResellerStore();
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function doApprove(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    // Required since 2026-09-16: approving is what opens the store, and a
    // store nobody can sign in to is not open.
    const invite: InviteInput = {
      email: inviteEmail.trim(),
      fullName: inviteName.trim(),
      roleKeys: ['owner'],
    };
    try {
      await approve.mutateAsync({ storeId: store.id, body: { invite } });
      toast.success(t('resellerStoreDetail.isApprovedAndOpen', { store: store.name }));
      setApproving(false);
    } catch (err) {
      setError(verdict(err, t));
    }
  }

  async function doReject(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      await reject.mutateAsync({ storeId: store.id, body: { reason: reason.trim() } });
      toast.success(t('resellerStoreDetail.isRejected', { store: store.name }));
      setRejecting(false);
    } catch (err) {
      setError(verdict(err, t));
    }
  }

  return (
    // A CARD with a saffron rule, not a plain section: this is a decision
    // waiting on the reader, not a region of the record.
    <div className="rs-card" data-tone="decision">
      <div className="rs-decision">
        <div className="rs-decision__text">
          <span className="rs-decision__chip" aria-hidden>
            <Store size={18} />
          </span>
          <div>
            <h2 className="rs-decision__title">
              {t('resellerStoreDetail.skydropOpenedThisStore')}
            </h2>
            <p className="rs-decision__body">{t('resellerStoreDetail.nothingCanBeOrdered')}</p>
          </div>
        </div>
        <div className="rs-actions">
          <Button variant="primary" size="md" onClick={() => setApproving(true)}>
            {t('resellerStoreDetail.approve')}
          </Button>
          <Button variant="destructive" size="md" onClick={() => setRejecting(true)}>
            {t('resellerStoreDetail.reject')}
          </Button>
        </div>
      </div>
      <Dialog
        open={approving}
        onOpenChange={setApproving}
        title={t('resellerStoreDetail.approve2', { store: store.name })}
        description={t('resellerStoreDetail.itOpensAtOnce')}
        icon={<UserPlus size={18} />}
        footer={
          <DialogFooter>
            <Button variant="secondary" size="md" onClick={() => setApproving(false)}>
              {t('resellerStoreDetail.cancel')}
            </Button>
            <AsyncButton
              type="submit"
              form="rs-approve-form"
              variant="primary"
              size="md"
              state={pendingPhase(approve.isPending)}
              labels={{
                idle: t('resellerStoreDetail.approve'),
                busy: t('resellerStoreDetail.approving'),
              }}
            />
          </DialogFooter>
        }
      >
        <form id="rs-approve-form" onSubmit={doApprove} className="rs-form">
          <TextField
            id="ap-email"
            label={t('resellerStoreDetail.firstUserSEmail')}
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <TextField
            id="ap-name"
            label={t('resellerStoreDetail.theirName')}
            hint={t('resellerStoreDetail.theyBecomeTheStore')}
            required
            value={inviteName}
            onChange={(e) => setInviteName(e.target.value)}
          />
          {error !== null ? <RsError>{error}</RsError> : null}
        </form>
      </Dialog>
      <Dialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={t('resellerStoreDetail.reject2', { store: store.name })}
        description={t('resellerStoreDetail.thisIsFinalSay')}
        tone="critical"
        footer={
          <DialogFooter>
            <Button variant="secondary" size="md" onClick={() => setRejecting(false)}>
              {t('resellerStoreDetail.cancel')}
            </Button>
            <AsyncButton
              type="submit"
              form="rs-reject-form"
              variant="destructive"
              size="md"
              state={pendingPhase(reject.isPending)}
              labels={{
                idle: t('resellerStoreDetail.rejectForGood'),
                busy: t('resellerStoreDetail.rejecting'),
              }}
            />
          </DialogFooter>
        }
      >
        <form id="rs-reject-form" onSubmit={doReject} className="rs-form">
          <TextArea
            id="rj-reason"
            label={t('resellerStoreDetail.why')}
            hint={t('resellerStoreDetail.atLeast10Characters')}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {error !== null ? <RsError>{error}</RsError> : null}
        </form>
      </Dialog>
    </div>
  );
}

function LifecycleCard({ store }: { store: ResellerStoreDetail }): ReactElement {
  const t = useT();
  const toast = useToast();
  const pause = usePauseResellerStore();
  const resume = useResumeResellerStore();
  const close = useCloseResellerStore();
  const [pausing, setPausing] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function doClose(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      await close.mutateAsync({ storeId: store.id, body: { reason: reason.trim() } });
      toast.success(t('resellerStoreDetail.isClosed', { store: store.name }));
      setClosing(false);
    } catch (err) {
      // STORE_HAS_ORDERS_IN_FLIGHT / STORE_HAS_CREDITS_TO_RUN /
      // STORE_WALLET_NOT_SETTLED each say what to do instead (FE-2).
      setError(verdict(err, t));
    }
  }

  const paused = store.status === 'PAUSED';

  return (
    <div className="rs-card" data-tone="open">
      <div className="rs-decision">
        <div className="rs-decision__text">
          <span className="rs-decision__chip" aria-hidden>
            {paused ? <CirclePause size={18} /> : <CirclePlay size={18} />}
          </span>
          <div>
            <h2 className="rs-decision__title">
              {paused ? t('resellerStoreDetail.paused') : t('resellerStoreDetail.open')}
            </h2>
            <p className="rs-decision__body">
              {paused
                ? t('resellerStoreDetail.itTakesNoNew')
                : t('resellerStoreDetail.pausingStopsNewOrders')}
            </p>
          </div>
        </div>
        <div className="rs-actions">
          {store.status === 'ACTIVE' ? (
            <Button
              variant="secondary"
              size="md"
              icon={<CirclePause size={15} />}
              onClick={() => setPausing(true)}
            >
              {t('resellerStoreDetail.pause')}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              icon={<CirclePlay size={15} />}
              disabled={resume.isPending}
              onClick={() => setResuming(true)}
            >
              {t('resellerStoreDetail.resume')}
            </Button>
          )}
          {paused ? (
            <Button variant="destructive" size="md" onClick={() => setClosing(true)}>
              {t('resellerStoreDetail.closeForGood')}
            </Button>
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        open={pausing}
        onOpenChange={setPausing}
        title={t('resellerStoreDetail.pause2', { store: store.name })}
        entity={store.name}
        consequence={t('resellerStoreDetail.itStopsTakingNew')}
        confirmLabel={t('resellerStoreDetail.pause')}
        closeOnSuccess={false}
        onConfirm={async () => {
          try {
            await pause.mutateAsync({ storeId: store.id, body: {} });
            toast.success(t('resellerStoreDetail.isPaused', { store: store.name }));
            setPausing(false);
          } catch (err) {
            toast.error(verdict(err, t));
          }
        }}
      />
      {/* Resume asks first (owner's decision): it puts the store back in
          front of customers. The SAME request as before fires on confirm. */}
      <ConfirmDialog
        open={resuming}
        onOpenChange={setResuming}
        title={t('resellerStoreDetail.resume2', { store: store.name })}
        entity={store.name}
        consequence={t('resellerStoreDetail.itTakesNewOrders')}
        confirmLabel={t('resellerStoreDetail.resume')}
        closeOnSuccess={false}
        onConfirm={async () => {
          try {
            await resume.mutateAsync({ storeId: store.id });
            toast.success(t('resellerStoreDetail.takesOrdersAgain', { store: store.name }));
            setResuming(false);
          } catch (err) {
            toast.error(verdict(err, t));
          }
        }}
      />
      <Dialog
        open={closing}
        onOpenChange={setClosing}
        title={t('resellerStoreDetail.closeForGood2', { store: store.name })}
        description={t('resellerStoreDetail.itsTeamLosesAccess')}
        tone="critical"
        footer={
          <DialogFooter>
            <Button variant="secondary" size="md" onClick={() => setClosing(false)}>
              {t('resellerStoreDetail.cancel')}
            </Button>
            <AsyncButton
              type="submit"
              form="rs-close-form"
              variant="destructive"
              size="md"
              state={pendingPhase(close.isPending)}
              labels={{
                idle: t('resellerStoreDetail.closeForGood'),
                busy: t('resellerStoreDetail.closing'),
              }}
            />
          </DialogFooter>
        }
      >
        <form id="rs-close-form" onSubmit={doClose} className="rs-form">
          <TextArea
            id="cl-reason"
            label={t('resellerStoreDetail.why')}
            hint={t('resellerStoreDetail.atLeast10Characters')}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {error !== null ? <RsError>{error}</RsError> : null}
        </form>
      </Dialog>
    </div>
  );
}

function WalletCard({
  store,
  disabled,
}: {
  store: ResellerStoreDetail;
  disabled: boolean;
}): ReactElement {
  const t = useT();
  const toast = useToast();
  const set = useSetWalletManager();
  const [value, setValue] = useState<WalletManager>(store.walletManagedBy);
  const [confirming, setConfirming] = useState(false);
  return (
    <RsSection
      title={t('resellerStoreDetail.whoManagesTheStore')}
      note={t('resellerStoreDetail.itCannotChangeWhile')}
    >
      <ul className="rs-who">
        <li>
          <span>
            {richMessage(t('resellerStoreDetail.youTopTheStore'), {
              b: <b>{t('resellerStoreDetail.you')}</b>,
            })}
          </span>
        </li>
        <li>
          <span>
            {richMessage(t('resellerStoreDetail.theStoreTopsUp'), {
              b: <b>{t('resellerStoreDetail.skydrop')}</b>,
            })}
          </span>
        </li>
      </ul>
      <div className="rs-row rs-row--end">
        <div className="rs-inline-field">
          <Select
            id="wallet-manager"
            label={t('resellerStoreDetail.managedBy')}
            value={value}
            disabled={disabled}
            onChange={(e) => setValue(e.target.value as WalletManager)}
          >
            <option value="SELLER">{t('resellerStoreDetail.you2')}</option>
            <option value="SKYDROP">Skydrop</option>
          </Select>
        </div>
        <Button
          variant="secondary"
          size="md"
          disabled={disabled || set.isPending || value === store.walletManagedBy}
          onClick={() => setConfirming(true)}
        >
          {t('resellerStoreDetail.save')}
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={
          value === 'SKYDROP'
            ? t('resellerStoreDetail.letSkydropManageS', { store: store.name })
            : t('resellerStoreDetail.manageSWalletYourself', { store: store.name })
        }
        entity={store.name}
        consequence={
          value === 'SKYDROP'
            ? t('resellerStoreDetail.fromNowOnThe')
            : t('resellerStoreDetail.fromNowOnYou')
        }
        confirmLabel={t('resellerStoreDetail.changeWhoManagesIt')}
        closeOnSuccess={false}
        onConfirm={async () => {
          try {
            await set.mutateAsync({ storeId: store.id, body: { walletManagedBy: value } });
            toast.success(t('resellerStoreDetail.saved'));
          } catch (err) {
            toast.error(verdict(err, t));
          }
          setConfirming(false);
        }}
      />
    </RsSection>
  );
}

function TeamSection({
  store,
  canInvite,
}: {
  store: ResellerStoreDetail;
  canInvite: boolean;
}): ReactElement {
  const t = useT();
  const toast = useToast();
  const invite = useInviteToResellerStore();
  const resend = useResendResellerInvitation();

  async function doResend(invitationId: string, email: string): Promise<void> {
    try {
      await resend.mutateAsync({ storeId: store.id, invitationId });
      // Says the old link is dead, because somebody who forwards the
      // first email after resending will otherwise be sending a key
      // that no longer turns.
      toast.success(t('resellerStoreDetail.invitationSentAgainTo', { email }));
    } catch (err) {
      toast.error(verdict(err, t));
    }
  }
  const revoke = useRevokeResellerInvitation();
  const [withdrawing, setWithdrawing] = useState<{ id: string; email: string } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  // SEVERAL. A store user's permissions are the union of every role they
  // hold, so somebody can do the daily work and the money without a
  // bespoke sixth role being invented for them. Starts empty rather than
  // on 'owner': a pre-ticked owner is how a colleague who should handle
  // returns is given the whole store by somebody who did not look.
  const [roleKeys, setRoleKeys] = useState<readonly StoreRoleKey[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function doInvite(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      await invite.mutateAsync({
        storeId: store.id,
        body: { email: email.trim(), fullName: fullName.trim(), roleKeys },
      });
      toast.success(t('resellerStoreDetail.invitationSentTo', { email: email.trim() }));
      setInviting(false);
      setEmail('');
      setFullName('');
      setRoleKeys([]);
    } catch (err) {
      setError(verdict(err, t));
    }
  }

  return (
    <RsSection
      title={t('resellerStoreDetail.theStoreSTeam')}
      note={t('resellerStoreDetail.peopleWithALogin')}
      action={
        canInvite ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<UserPlus size={14} />}
            onClick={() => setInviting(true)}
          >
            {t('resellerStoreDetail.inviteSomeone')}
          </Button>
        ) : undefined
      }
      flush
    >
      {store.team.members.length === 0 && store.team.invitations.length === 0 ? (
        <EmptyState
          bare
          title={t('resellerStoreDetail.nobodyOnTheTeam')}
          description={canInvite ? t('resellerStoreDetail.inviteTheStoreS') : undefined}
        />
      ) : (
        <Table caption={t('resellerStoreDetail.theStoreSTeam')}>
          <THead>
            <Tr>
              <Th>{t('resellerStoreDetail.name')}</Th>
              <Th>{t('resellerStoreDetail.email')}</Th>
              <Th>{t('resellerStoreDetail.roles')}</Th>
              <Th>{t('resellerStoreDetail.state')}</Th>
              {/* Only an invitation can be acted on here: there is no seller
                  endpoint to change a store member's role or remove them —
                  the store's own admins do that on the reseller portal. */}
              {store.team.invitations.length > 0 ? (
                <Th>{t('resellerStoreDetail.actions')}</Th>
              ) : null}
            </Tr>
          </THead>
          <TBody>
            {store.team.members.map((m) => (
              <Tr key={m.id}>
                <Td className="rs-strong">{m.fullName}</Td>
                <Td className="rs-small">{m.email}</Td>
                {/* Every role held. `roleName` is the FIRST one — a
                    label — so a member who is Ops AND Finance read as
                    Ops, on the screen a seller uses to check who at a
                    store can reach its money. */}
                <Td className="rs-small">{roleLine(m)}</Td>
                <Td className="rs-small">
                  {richMessage(t('resellerStoreDetail.lastSignedIn'), {
                    lastLoginAt: when(m.lastLoginAt),
                  })}
                </Td>
                {store.team.invitations.length > 0 ? <Td /> : null}
              </Tr>
            ))}
            {store.team.invitations.map((i) => (
              <Tr key={i.id}>
                <Td className="rs-strong">{i.fullName}</Td>
                <Td className="rs-small">{i.email}</Td>
                <Td className="rs-small">{roleLine(i)}</Td>
                {/* The word as well as the colour: an expired row and a
                    live one must not differ only by tint. */}
                <Td className="rs-small">
                  <span className="rs-row">
                    {i.expired ? (
                      <>
                        <AlertTriangle size={13} aria-hidden />
                        {t('resellerStoreDetail.expiredNeverAccepted', { when: when(i.expiresAt) })}
                      </>
                    ) : (
                      <>
                        <Mail size={13} aria-hidden />
                        {t('resellerStoreDetail.invitedExpires', { when: when(i.expiresAt) })}
                      </>
                    )}
                  </span>
                </Td>
                <Td>
                  <span className="rs-row">
                    <Button
                      variant={i.expired ? 'primary' : 'secondary'}
                      size="sm"
                      disabled={resend.isPending || revoke.isPending}
                      onClick={() => void doResend(i.id, i.email)}
                    >
                      {i.expired
                        ? t('resellerStoreDetail.sendAgain')
                        : t('resellerStoreDetail.resend')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={revoke.isPending || resend.isPending}
                      onClick={() => setWithdrawing({ id: i.id, email: i.email })}
                    >
                      {t('resellerStoreDetail.withdraw')}
                    </Button>
                  </span>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      <ConfirmDialog
        open={withdrawing !== null}
        onOpenChange={(o) => {
          if (!o) setWithdrawing(null);
        }}
        title={t('resellerStoreDetail.withdrawTheInvitationTo', {
          email: withdrawing?.email ?? '',
        })}
        entity={withdrawing?.email ?? ''}
        consequence={t('resellerStoreDetail.theLinkInTheir')}
        confirmLabel={t('resellerStoreDetail.withdrawIt')}
        destructive
        closeOnSuccess={false}
        onConfirm={async () => {
          if (withdrawing === null) return;
          try {
            await revoke.mutateAsync({ storeId: store.id, invitationId: withdrawing.id });
            toast.success(t('resellerStoreDetail.invitationWithdrawn'));
          } catch (err) {
            toast.error(verdict(err, t));
          }
          setWithdrawing(null);
        }}
      />
      <Dialog
        open={inviting}
        onOpenChange={setInviting}
        title={t('resellerStoreDetail.inviteSomeoneToThe')}
        description={t('resellerStoreDetail.theyGetAnEmail')}
        icon={<UserPlus size={18} />}
        footer={
          <DialogFooter>
            <Button variant="secondary" size="md" onClick={() => setInviting(false)}>
              {t('resellerStoreDetail.cancel')}
            </Button>
            <AsyncButton
              type="submit"
              form="rs-invite-form"
              variant="primary"
              size="md"
              state={pendingPhase(invite.isPending)}
              labels={{
                idle: t('resellerStoreDetail.sendInvitation'),
                busy: t('resellerStoreDetail.sending'),
              }}
            />
          </DialogFooter>
        }
      >
        <form id="rs-invite-form" onSubmit={doInvite} className="rs-form">
          <TextField
            id="ti-name"
            label={t('resellerStoreDetail.name')}
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <TextField
            id="ti-email"
            label={t('resellerStoreDetail.email')}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {/* Not disabled on an empty selection: the server refuses that
              and its words are what `error` shows (FE-2). Nothing here
              names the code — which refusal it is depends on whether the
              DTO, the service or the guard answers first. */}
          <MultiSelect
            id="ti-role"
            label={t('resellerStoreDetail.roles')}
            required
            options={store.team.roles.map((r) => ({
              value: r.key,
              label: r.name,
              ...(r.description === null ? {} : { description: r.description }),
            }))}
            value={roleKeys}
            onChange={(next) => {
              setError(null);
              setRoleKeys(next as readonly StoreRoleKey[]);
            }}
            placeholder={
              roleKeys.length === 0
                ? t('resellerStoreDetail.chooseOneOrMore')
                : t('resellerStoreDetail.addAnotherRole')
            }
            hint={t('resellerStoreDetail.theyCanDoEverything')}
            emptyText={t('resellerStoreDetail.noMatchingRole')}
          />
          {error !== null ? <RsError>{error}</RsError> : null}
        </form>
      </Dialog>
    </RsSection>
  );
}
