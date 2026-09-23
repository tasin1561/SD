'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent, type ReactElement } from 'react';
import {
  CalendarClock,
  CircleDot,
  CirclePause,
  CirclePlay,
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
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton, SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { resellerStoreStatusKind, resellerStoreStatusLabel } from '@skydrop/ui/status';
import type { ResellerStoreStatusValue } from '@skydrop/api-client';
import { serverVerdict } from '@/lib/server-verdict';
import { StoreActionsSection } from './_components/store-actions-section';
import { StoreCatalogue } from './_components/store-catalogue';
import { StoreWalletSection } from './_components/store-wallet-section';
import {
  useApproveResellerStore,
  useCloseResellerStore,
  useInviteToResellerStore,
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

const EVENT_WORDS: Record<string, string> = {
  CREATED: 'Opened',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PAUSED: 'Paused',
  RESUMED: 'Resumed',
  CLOSED: 'Closed',
  WALLET_MANAGER_CHANGED: 'Wallet manager changed',
};

const ACTOR_WORDS: Record<string, string> = {
  STAFF: 'Skydrop',
  SELLER: 'You',
  STORE: 'The store',
  SYSTEM: 'System',
  API: 'Your systems',
};

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

function statusWords(status: ResellerStoreStatusValue): string {
  switch (status) {
    case 'ACTIVE':
      return 'Selling';
    case 'PENDING_SELLER_APPROVAL':
      return 'Awaiting you';
    case 'PAUSED':
      return 'Paused';
    case 'REJECTED':
      return 'Rejected';
    case 'CLOSED':
      return 'Closed';
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
  const { storeId } = useParams<{ storeId: string }>();
  const store = useResellerStore(storeId);
  const [tab, setTab] = useState<StoreTab>('overview');

  if (store.isPending || store.isError) {
    // The way back and the page's name stay put while it loads or fails —
    // an error with nothing around it reads as a broken app, not a store.
    return (
      <div className="rs-page">
        <div className="rs-head">
          <RsBack href="/reseller-stores">All reseller stores</RsBack>
          <PageHeader
            breadcrumbs={[
              { label: 'Seller console' },
              { label: 'Reselling' },
              { label: 'Stores', href: '/reseller-stores' },
              { label: 'Store' },
            ]}
            Link={Link}
            title="Reseller store"
          />
        </div>
        {store.isPending ? (
          <>
            <div className="rs-kpis">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="rs-kpi-skel" height={104} rounded="md" />
              ))}
            </div>
            <SkeletonRows rows={5} cols={4} label="Loading the store" />
          </>
        ) : (
          <ErrorState message={serverVerdict(store.error)} retry={() => void store.refetch()} />
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
        <RsBack href="/reseller-stores">All reseller stores</RsBack>
        <PageHeader
          breadcrumbs={[
            { label: 'Seller console' },
            { label: 'Reselling' },
            { label: 'Stores', href: '/reseller-stores' },
            { label: s.name },
          ]}
          Link={Link}
          title={s.name}
          subtitle={
            s.displayName === null
              ? 'Customers see this name on their parcel and on the tracking page.'
              : `Customers see “${s.displayName}”.`
          }
          meta={
            <RsFacts>
              <RsFact tone={s.origin === 'ADMIN' ? 'accent' : undefined}>
                Opened by {s.origin === 'ADMIN' ? 'Skydrop' : 'you'}
              </RsFact>
              <RsFact>Wallet run by {s.walletManagedBy === 'SKYDROP' ? 'Skydrop' : 'you'}</RsFact>
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
              <RsLink href={`/orders?storeId=${encodeURIComponent(s.id)}`}>Its orders</RsLink>
              <RsLink href="/reseller-stores/reports">Reports</RsLink>
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
          label="Status"
          icon={<CircleDot size={14} />}
          figure={statusWords(s.status)}
          tone={statusTone(s.status)}
          hint={
            s.statusChangedAt === null ? 'Since it was opened.' : `Since ${day(s.statusChangedAt)}.`
          }
        />
        <KpiCard
          label="Team"
          icon={<Users size={14} />}
          value={s.memberCount}
          unit={s.memberCount === 1 ? 'person' : 'people'}
          tone="neutral"
          hint={
            invited === 0
              ? 'Everyone who can sign in to this store.'
              : `${invited} more invited and not yet signed in.`
          }
        />
        <KpiCard
          label="Wallet managed by"
          icon={<Wallet size={14} />}
          figure={s.walletManagedBy === 'SKYDROP' ? 'Skydrop' : 'You'}
          tone="neutral"
          hint={
            s.walletManagedBy === 'SKYDROP'
              ? 'It tops up to us and withdraws through us.'
              : 'You top it up from your wallet and pay it yourself.'
          }
        />
        <KpiCard
          label="Opened"
          icon={<CalendarClock size={14} />}
          figure={day(s.createdAt)}
          tone="neutral"
          hint={`${s.events.length} ${s.events.length === 1 ? 'entry' : 'entries'} in its history.`}
        />
      </div>

      {/* A real tablist now: the primitive provides what the old chips
          only claimed — roving focus, arrow keys, and a `tabpanel`
          labelled by its tab. Only the chosen panel is mounted, exactly
          as before, so a tab's data is asked for when it is opened. */}
      <Tabs
        label="Store sections"
        panelClassName="rs-panel"
        value={tab}
        onChange={(id) => {
          if (isStoreTab(id)) setTab(id);
        }}
        items={[
          {
            id: 'overview',
            label: 'Overview',
            panel: <OverviewTab store={s} open={open} final={final} />,
          },
          {
            id: 'catalogue',
            label: 'Catalogue & stock',
            panel: <StoreCatalogue storeId={s.id} storeName={s.name} final={final} />,
          },
          {
            id: 'terms',
            label: 'Terms',
            panel: <TermsSection storeId={s.id} final={final} />,
          },
          {
            id: 'actions',
            label: 'What they can do',
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
  const details: ReadonlyArray<{ label: string; value: string }> = [
    { label: 'Customers see', value: s.displayName ?? s.name },
    { label: 'Opened by', value: s.origin === 'ADMIN' ? 'Skydrop' : 'You' },
    { label: 'Contact email', value: s.contactEmail ?? '—' },
    { label: 'Contact phone', value: s.contactPhone ?? '—' },
    { label: 'Note', value: s.note ?? '—' },
    { label: 'Status since', value: when(s.statusChangedAt) },
  ];
  return (
    <>
      {s.status === 'PENDING_SELLER_APPROVAL' ? <DecisionCard store={s} /> : null}
      {open ? <LifecycleCard store={s} /> : null}

      <RsSection title="Details" note="How we hold this store.">
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
        title="History"
        note="Every change to this store, oldest last. Never edited."
        flush
      >
        {s.events.length === 0 ? (
          <EmptyState bare title="No history yet" />
        ) : (
          <Table caption="Store history">
            <THead>
              <Tr>
                <Th>When</Th>
                <Th>What</Th>
                <Th>By</Th>
                <Th>Note</Th>
              </Tr>
            </THead>
            <TBody>
              {s.events.map((e) => (
                <Tr key={e.id}>
                  <Td className="rs-when sk-figure">{when(e.createdAt)}</Td>
                  <Td className="rs-strong">{EVENT_WORDS[e.kind] ?? e.kind}</Td>
                  <Td className="rs-small">{ACTOR_WORDS[e.actorType] ?? e.actorType}</Td>
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
      roleKey: 'owner',
    };
    try {
      await approve.mutateAsync({ storeId: store.id, body: { invite } });
      toast.success(`“${store.name}” is approved and open.`);
      setApproving(false);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  async function doReject(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      await reject.mutateAsync({ storeId: store.id, body: { reason: reason.trim() } });
      toast.success(`“${store.name}” is rejected.`);
      setRejecting(false);
    } catch (err) {
      setError(serverVerdict(err));
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
            <h2 className="rs-decision__title">Skydrop opened this store for you</h2>
            <p className="rs-decision__body">
              Nothing can be ordered through it until you approve it. Rejecting it is final.
            </p>
          </div>
        </div>
        <div className="rs-actions">
          <Button variant="primary" size="md" onClick={() => setApproving(true)}>
            Approve
          </Button>
          <Button variant="destructive" size="md" onClick={() => setRejecting(true)}>
            Reject
          </Button>
        </div>
      </div>
      <Dialog
        open={approving}
        onOpenChange={setApproving}
        title={`Approve “${store.name}”?`}
        description="It opens at once, with its first user invited — they get the email that gives the store a login."
        icon={<UserPlus size={18} />}
        footer={
          <DialogFooter>
            <Button variant="secondary" size="md" onClick={() => setApproving(false)}>
              Cancel
            </Button>
            <AsyncButton
              type="submit"
              form="rs-approve-form"
              variant="primary"
              size="md"
              state={pendingPhase(approve.isPending)}
              labels={{ idle: 'Approve', busy: 'Approving…' }}
            />
          </DialogFooter>
        }
      >
        <form id="rs-approve-form" onSubmit={doApprove} className="rs-form">
          <TextField
            id="ap-email"
            label="First user’s email"
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <TextField
            id="ap-name"
            label="Their name"
            hint="They become the store’s owner."
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
        title={`Reject “${store.name}”?`}
        description="This is final. Say why — Skydrop reads it."
        tone="critical"
        footer={
          <DialogFooter>
            <Button variant="secondary" size="md" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
            <AsyncButton
              type="submit"
              form="rs-reject-form"
              variant="destructive"
              size="md"
              state={pendingPhase(reject.isPending)}
              labels={{ idle: 'Reject for good', busy: 'Rejecting…' }}
            />
          </DialogFooter>
        }
      >
        <form id="rs-reject-form" onSubmit={doReject} className="rs-form">
          <TextArea
            id="rj-reason"
            label="Why"
            hint="At least 10 characters."
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
      toast.success(`“${store.name}” is closed.`);
      setClosing(false);
    } catch (err) {
      // STORE_HAS_ORDERS_IN_FLIGHT / STORE_HAS_CREDITS_TO_RUN /
      // STORE_WALLET_NOT_SETTLED each say what to do instead (FE-2).
      setError(serverVerdict(err));
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
            <h2 className="rs-decision__title">{paused ? 'Paused' : 'Open'}</h2>
            <p className="rs-decision__body">
              {paused
                ? 'It takes no new orders; anything already placed carries on. Close it for good once every parcel is delivered or back with us, every credit has run and its wallet is ₹0.'
                : 'Pausing stops new orders. To close it for good, pause it first.'}
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
              Pause
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              icon={<CirclePlay size={15} />}
              disabled={resume.isPending}
              onClick={() => setResuming(true)}
            >
              Resume
            </Button>
          )}
          {paused ? (
            <Button variant="destructive" size="md" onClick={() => setClosing(true)}>
              Close for good
            </Button>
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        open={pausing}
        onOpenChange={setPausing}
        title={`Pause “${store.name}”?`}
        entity={store.name}
        consequence="It stops taking new orders until you resume it."
        confirmLabel="Pause"
        closeOnSuccess={false}
        onConfirm={async () => {
          try {
            await pause.mutateAsync({ storeId: store.id, body: {} });
            toast.success(`“${store.name}” is paused.`);
            setPausing(false);
          } catch (err) {
            toast.error(serverVerdict(err));
          }
        }}
      />
      {/* Resume asks first (owner's decision): it puts the store back in
          front of customers. The SAME request as before fires on confirm. */}
      <ConfirmDialog
        open={resuming}
        onOpenChange={setResuming}
        title={`Resume “${store.name}”?`}
        entity={store.name}
        consequence="It takes new orders again straight away."
        confirmLabel="Resume"
        closeOnSuccess={false}
        onConfirm={async () => {
          try {
            await resume.mutateAsync({ storeId: store.id });
            toast.success(`“${store.name}” takes orders again.`);
            setResuming(false);
          } catch (err) {
            toast.error(serverVerdict(err));
          }
        }}
      />
      <Dialog
        open={closing}
        onOpenChange={setClosing}
        title={`Close “${store.name}” for good?`}
        description="Its team loses access, and it can never reopen."
        tone="critical"
        footer={
          <DialogFooter>
            <Button variant="secondary" size="md" onClick={() => setClosing(false)}>
              Cancel
            </Button>
            <AsyncButton
              type="submit"
              form="rs-close-form"
              variant="destructive"
              size="md"
              state={pendingPhase(close.isPending)}
              labels={{ idle: 'Close for good', busy: 'Closing…' }}
            />
          </DialogFooter>
        }
      >
        <form id="rs-close-form" onSubmit={doClose} className="rs-form">
          <TextArea
            id="cl-reason"
            label="Why"
            hint="At least 10 characters."
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
  const toast = useToast();
  const set = useSetWalletManager();
  const [value, setValue] = useState<WalletManager>(store.walletManagedBy);
  const [confirming, setConfirming] = useState(false);
  return (
    <RsSection
      title="Who manages the store’s wallet"
      note="It cannot change while a top-up or withdrawal is waiting on Skydrop."
    >
      <ul className="rs-who">
        <li>
          <span>
            <b>You:</b> you top the store up from your wallet and pay it yourself.
          </span>
        </li>
        <li>
          <span>
            <b>Skydrop:</b> the store tops up to Skydrop’s bank and withdraws through Skydrop.
          </span>
        </li>
      </ul>
      <div className="rs-row rs-row--end">
        <div className="rs-inline-field">
          <Select
            id="wallet-manager"
            label="Managed by"
            value={value}
            disabled={disabled}
            onChange={(e) => setValue(e.target.value as WalletManager)}
          >
            <option value="SELLER">You</option>
            <option value="SKYDROP">Skydrop</option>
          </Select>
        </div>
        <Button
          variant="secondary"
          size="md"
          disabled={disabled || set.isPending || value === store.walletManagedBy}
          onClick={() => setConfirming(true)}
        >
          Save
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={
          value === 'SKYDROP'
            ? `Let Skydrop manage “${store.name}”’s wallet?`
            : `Manage “${store.name}”’s wallet yourself?`
        }
        entity={store.name}
        consequence={
          value === 'SKYDROP'
            ? 'From now on the store tops up to Skydrop’s bank and withdraws through Skydrop. You stop topping it up and paying it yourself.'
            : 'From now on you top the store up from your own wallet and pay it yourself. It stops topping up to Skydrop’s bank and withdrawing through Skydrop.'
        }
        confirmLabel="Change who manages it"
        closeOnSuccess={false}
        onConfirm={async () => {
          try {
            await set.mutateAsync({ storeId: store.id, body: { walletManagedBy: value } });
            toast.success('Saved.');
          } catch (err) {
            toast.error(serverVerdict(err));
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
  const toast = useToast();
  const invite = useInviteToResellerStore();
  const revoke = useRevokeResellerInvitation();
  const [withdrawing, setWithdrawing] = useState<{ id: string; email: string } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [roleKey, setRoleKey] = useState<StoreRoleKey>('owner');
  const [error, setError] = useState<string | null>(null);

  async function doInvite(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      await invite.mutateAsync({
        storeId: store.id,
        body: { email: email.trim(), fullName: fullName.trim(), roleKey },
      });
      toast.success(`Invitation sent to ${email.trim()}.`);
      setInviting(false);
      setEmail('');
      setFullName('');
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <RsSection
      title="The store’s team"
      note="People with a login for this store on the reseller portal."
      action={
        canInvite ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<UserPlus size={14} />}
            onClick={() => setInviting(true)}
          >
            Invite someone
          </Button>
        ) : undefined
      }
      flush
    >
      {store.team.members.length === 0 && store.team.invitations.length === 0 ? (
        <EmptyState
          bare
          title="Nobody on the team yet"
          description={
            canInvite ? 'Invite the store’s first user — they become its owner.' : undefined
          }
        />
      ) : (
        <Table caption="The store’s team">
          <THead>
            <Tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>State</Th>
              {/* Only an invitation can be acted on here: there is no seller
                  endpoint to change a store member's role or remove them —
                  the store's own admins do that on the reseller portal. */}
              {store.team.invitations.length > 0 ? <Th>Actions</Th> : null}
            </Tr>
          </THead>
          <TBody>
            {store.team.members.map((m) => (
              <Tr key={m.id}>
                <Td className="rs-strong">{m.fullName}</Td>
                <Td className="rs-small">{m.email}</Td>
                <Td className="rs-small">{m.roleName}</Td>
                <Td className="rs-small">Last signed in {when(m.lastLoginAt)}</Td>
                {store.team.invitations.length > 0 ? <Td /> : null}
              </Tr>
            ))}
            {store.team.invitations.map((i) => (
              <Tr key={i.id}>
                <Td className="rs-strong">{i.fullName}</Td>
                <Td className="rs-small">{i.email}</Td>
                <Td className="rs-small">{i.roleName}</Td>
                <Td className="rs-small">
                  <span className="rs-row">
                    <Mail size={13} aria-hidden />
                    Invited — expires {when(i.expiresAt)}
                  </span>
                </Td>
                <Td>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => setWithdrawing({ id: i.id, email: i.email })}
                  >
                    Withdraw
                  </Button>
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
        title={`Withdraw the invitation to ${withdrawing?.email ?? ''}?`}
        entity={withdrawing?.email ?? ''}
        consequence="The link in their email stops working. You can invite them again later."
        confirmLabel="Withdraw it"
        destructive
        closeOnSuccess={false}
        onConfirm={async () => {
          if (withdrawing === null) return;
          try {
            await revoke.mutateAsync({ storeId: store.id, invitationId: withdrawing.id });
            toast.success('Invitation withdrawn.');
          } catch (err) {
            toast.error(serverVerdict(err));
          }
          setWithdrawing(null);
        }}
      />
      <Dialog
        open={inviting}
        onOpenChange={setInviting}
        title="Invite someone to the store"
        description="They get an email with a link to set up their login. It works for 7 days."
        icon={<UserPlus size={18} />}
        footer={
          <DialogFooter>
            <Button variant="secondary" size="md" onClick={() => setInviting(false)}>
              Cancel
            </Button>
            <AsyncButton
              type="submit"
              form="rs-invite-form"
              variant="primary"
              size="md"
              state={pendingPhase(invite.isPending)}
              labels={{ idle: 'Send invitation', busy: 'Sending…' }}
            />
          </DialogFooter>
        }
      >
        <form id="rs-invite-form" onSubmit={doInvite} className="rs-form">
          <TextField
            id="ti-name"
            label="Name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <TextField
            id="ti-email"
            label="Email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Select
            id="ti-role"
            label="Role"
            value={roleKey}
            onChange={(e) => setRoleKey(e.target.value as StoreRoleKey)}
          >
            {store.team.roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </Select>
          {error !== null ? <RsError>{error}</RsError> : null}
        </form>
      </Dialog>
    </RsSection>
  );
}
