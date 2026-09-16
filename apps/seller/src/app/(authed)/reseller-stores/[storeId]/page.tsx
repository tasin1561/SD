'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DescriptionList,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  PageHeader,
  ResellerStoreStatusBadge,
  Section,
  Select,
  TBody,
  THead,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
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

type StoreTab = 'overview' | 'catalogue' | 'terms' | 'actions';

function when(iso: string | null): string {
  return iso === null
    ? '—'
    : new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
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

/** One reseller store: its life, who manages its wallet, its team, its history. */
export default function ResellerStorePage(): ReactElement {
  const { storeId } = useParams<{ storeId: string }>();
  const store = useResellerStore(storeId);
  const [tab, setTab] = useState<StoreTab>('overview');

  if (store.isPending || store.isError) {
    // The way back and the page's name stay put while it loads or fails —
    // an error with nothing around it reads as a broken app, not a store.
    return (
      <div className="space-y-6">
        <BackLink />
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
  const open = s.status === 'ACTIVE' || s.status === 'PAUSED';
  const final = s.status === 'CLOSED' || s.status === 'REJECTED';

  return (
    <div className="space-y-6">
      <BackLink />
      <PageHeader
        title={s.name}
        subtitle={<ResellerStoreStatusBadge status={s.status} />}
        action={
          <div className="flex flex-wrap gap-3 text-sm">
            <Link
              href={`/orders?storeId=${encodeURIComponent(s.id)}`}
              className="text-accent hover:underline"
            >
              Its orders →
            </Link>
            <Link href="/reseller-stores/reports" className="text-accent hover:underline">
              Reports →
            </Link>
          </div>
        }
      />

      <div role="tablist" aria-label="Store sections" className="flex flex-wrap gap-2">
        {(
          [
            ['overview', 'Overview'],
            ['catalogue', 'Catalogue & stock'],
            ['terms', 'Terms'],
            ['actions', 'What they can do'],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            role="tab"
            aria-selected={tab === key}
            variant={tab === key ? 'primary' : 'secondary'}
            size="md"
            onClick={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {tab === 'catalogue' ? <StoreCatalogue storeId={s.id} final={final} /> : null}
      {tab === 'terms' ? <TermsSection storeId={s.id} final={final} /> : null}
      {tab === 'actions' ? <StoreActionsSection storeId={s.id} final={final} /> : null}
      {tab === 'overview' ? <OverviewTab store={s} open={open} final={final} /> : null}
    </div>
  );
}

function BackLink(): ReactElement {
  return (
    <div>
      <Link href="/reseller-stores" className="text-accent hover:text-accent-hover text-sm">
        ← All reseller stores
      </Link>
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
  return (
    <div className="space-y-6">
      {s.status === 'PENDING_SELLER_APPROVAL' ? <DecisionCard store={s} /> : null}
      {open ? <LifecycleCard store={s} /> : null}

      <Card>
        <CardHeader title="Details" />
        <CardBody>
          <DescriptionList
            columns={2}
            items={[
              { label: 'Customers see', value: s.displayName ?? s.name },
              { label: 'Opened by', value: s.origin === 'ADMIN' ? 'Skydrop' : 'You' },
              { label: 'Contact email', value: s.contactEmail ?? '—' },
              { label: 'Contact phone', value: s.contactPhone ?? '—' },
              { label: 'Note', value: s.note ?? '—' },
              { label: 'Status since', value: when(s.statusChangedAt) },
            ]}
          />
        </CardBody>
      </Card>

      <WalletCard store={s} disabled={final} />
      <StoreWalletSection store={s} />
      <TeamSection store={s} canInvite={open} />

      <Section title="History">
        {s.events.length === 0 ? (
          <EmptyState title="No history yet" />
        ) : (
          <Table>
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
                  <Td>{when(e.createdAt)}</Td>
                  <Td>{EVENT_WORDS[e.kind] ?? e.kind}</Td>
                  <Td>{ACTOR_WORDS[e.actorType] ?? e.actorType}</Td>
                  <Td>{e.note ?? '—'}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </div>
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
    <Card>
      <CardHeader
        title="Skydrop opened this store for you"
        subtitle="Nothing can be ordered through it until you approve it. Rejecting it is final."
      />
      <CardBody>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="md" onClick={() => setApproving(true)}>
            Approve
          </Button>
          <Button variant="destructive" size="md" onClick={() => setRejecting(true)}>
            Reject
          </Button>
        </div>
      </CardBody>
      <Modal
        open={approving}
        onOpenChange={setApproving}
        title={`Approve “${store.name}”?`}
        description="It opens at once, with its first user invited — they get the email that gives the store a login."
      >
        <form onSubmit={doApprove} className="space-y-4">
          <FormField label="First user’s email" htmlFor="ap-email" required>
            <Input
              id="ap-email"
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </FormField>
          <FormField
            label="Their name"
            htmlFor="ap-name"
            hint="They become the store’s owner."
            required
          >
            <Input
              id="ap-name"
              required
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
            />
          </FormField>
          {error !== null ? (
            <p role="alert" className="text-critical text-sm">
              {error}
            </p>
          ) : null}
          <ModalFooter>
            <Button type="button" variant="secondary" size="md" onClick={() => setApproving(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={approve.isPending}>
              {approve.isPending ? 'Approving…' : 'Approve'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
      <Modal
        open={rejecting}
        onOpenChange={setRejecting}
        title={`Reject “${store.name}”?`}
        description="This is final. Say why — Skydrop reads it."
        tone="critical"
      >
        <form onSubmit={doReject} className="space-y-4">
          <FormField label="Why" htmlFor="rj-reason" hint="At least 10 characters." required>
            <Textarea
              id="rj-reason"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
          {error !== null ? (
            <p role="alert" className="text-critical text-sm">
              {error}
            </p>
          ) : null}
          <ModalFooter>
            <Button type="button" variant="secondary" size="md" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" size="md" disabled={reject.isPending}>
              {reject.isPending ? 'Rejecting…' : 'Reject for good'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </Card>
  );
}

function LifecycleCard({ store }: { store: ResellerStoreDetail }): ReactElement {
  const toast = useToast();
  const pause = usePauseResellerStore();
  const resume = useResumeResellerStore();
  const close = useCloseResellerStore();
  const [pausing, setPausing] = useState(false);
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

  return (
    <Card>
      <CardHeader
        title={store.status === 'PAUSED' ? 'Paused' : 'Open'}
        subtitle={
          store.status === 'PAUSED'
            ? 'It takes no new orders; anything already placed carries on. Close it for good once every parcel is delivered or back with us, every credit has run and its wallet is ₹0.'
            : 'Pausing stops new orders. To close it for good, pause it first.'
        }
      />
      <CardBody>
        <div className="flex flex-wrap gap-2">
          {store.status === 'ACTIVE' ? (
            <Button variant="secondary" size="md" onClick={() => setPausing(true)}>
              Pause
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              disabled={resume.isPending}
              onClick={() =>
                resume.mutate(
                  { storeId: store.id },
                  {
                    onSuccess: () => toast.success(`“${store.name}” takes orders again.`),
                    onError: (err) => toast.error(serverVerdict(err)),
                  },
                )
              }
            >
              Resume
            </Button>
          )}
          {store.status === 'PAUSED' ? (
            <Button variant="destructive" size="md" onClick={() => setClosing(true)}>
              Close for good
            </Button>
          ) : null}
        </div>
      </CardBody>
      <ConfirmDialog
        open={pausing}
        onOpenChange={setPausing}
        title={`Pause “${store.name}”?`}
        description="It stops taking new orders until you resume it."
        confirmLabel="Pause"
        disabled={pause.isPending}
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
      <Modal
        open={closing}
        onOpenChange={setClosing}
        title={`Close “${store.name}” for good?`}
        description="Its team loses access, and it can never reopen."
        tone="critical"
      >
        <form onSubmit={doClose} className="space-y-4">
          <FormField label="Why" htmlFor="cl-reason" hint="At least 10 characters." required>
            <Textarea
              id="cl-reason"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
          {error !== null ? (
            <p role="alert" className="text-critical text-sm">
              {error}
            </p>
          ) : null}
          <ModalFooter>
            <Button type="button" variant="secondary" size="md" onClick={() => setClosing(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" size="md" disabled={close.isPending}>
              {close.isPending ? 'Closing…' : 'Close for good'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </Card>
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
    <Card>
      <CardHeader
        title="Who manages the store’s wallet"
        subtitle="You: you top the store up from your wallet and pay it yourself. Skydrop: the store tops up to Skydrop’s bank and withdraws through Skydrop. It cannot change while the store has a top-up or withdrawal waiting on Skydrop."
      />
      <CardBody>
        <div className="flex flex-wrap items-end gap-2">
          <FormField label="Managed by" htmlFor="wallet-manager">
            <Select
              id="wallet-manager"
              value={value}
              disabled={disabled}
              onChange={(e) => setValue(e.target.value as WalletManager)}
            >
              <option value="SELLER">You</option>
              <option value="SKYDROP">Skydrop</option>
            </Select>
          </FormField>
          <Button
            variant="secondary"
            size="md"
            disabled={disabled || set.isPending || value === store.walletManagedBy}
            onClick={() => setConfirming(true)}
          >
            Save
          </Button>
        </div>
      </CardBody>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={
          value === 'SKYDROP'
            ? `Let Skydrop manage “${store.name}”’s wallet?`
            : `Manage “${store.name}”’s wallet yourself?`
        }
        description={
          value === 'SKYDROP'
            ? 'From now on the store tops up to Skydrop’s bank and withdraws through Skydrop. You stop topping it up and paying it yourself.'
            : 'From now on you top the store up from your own wallet and pay it yourself. It stops topping up to Skydrop’s bank and withdrawing through Skydrop.'
        }
        confirmLabel="Change who manages it"
        disabled={set.isPending}
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
    </Card>
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
    <Section
      title="The store’s team"
      subtitle="People with a login for this store on the reseller portal."
      action={
        canInvite ? (
          <Button variant="secondary" size="md" onClick={() => setInviting(true)}>
            Invite someone
          </Button>
        ) : undefined
      }
    >
      {store.team.members.length === 0 && store.team.invitations.length === 0 ? (
        <EmptyState
          title="Nobody on the team yet"
          description={
            canInvite ? 'Invite the store’s first user — they become its owner.' : undefined
          }
        />
      ) : (
        <Table>
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
                <Td>{m.fullName}</Td>
                <Td>{m.email}</Td>
                <Td>{m.roleName}</Td>
                <Td>Last signed in {when(m.lastLoginAt)}</Td>
                {store.team.invitations.length > 0 ? <Td /> : null}
              </Tr>
            ))}
            {store.team.invitations.map((i) => (
              <Tr key={i.id}>
                <Td>{i.fullName}</Td>
                <Td>{i.email}</Td>
                <Td>{i.roleName}</Td>
                <Td>Invited — expires {when(i.expiresAt)}</Td>
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
        description="The link in their email stops working. You can invite them again later."
        confirmLabel="Withdraw it"
        confirmVariant="destructive"
        disabled={revoke.isPending}
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
      <Modal
        open={inviting}
        onOpenChange={setInviting}
        title="Invite someone to the store"
        description="They get an email with a link to set up their login. It works for 7 days."
      >
        <form onSubmit={doInvite} className="space-y-4">
          <FormField label="Name" htmlFor="ti-name" required>
            <Input
              id="ti-name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </FormField>
          <FormField label="Email" htmlFor="ti-email" required>
            <Input
              id="ti-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>
          <FormField label="Role" htmlFor="ti-role">
            <Select
              id="ti-role"
              value={roleKey}
              onChange={(e) => setRoleKey(e.target.value as StoreRoleKey)}
            >
              {store.team.roles.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </Select>
          </FormField>
          {error !== null ? (
            <p role="alert" className="text-critical text-sm">
              {error}
            </p>
          ) : null}
          <ModalFooter>
            <Button type="button" variant="secondary" size="md" onClick={() => setInviting(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={invite.isPending}>
              {invite.isPending ? 'Sending…' : 'Send invitation'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </Section>
  );
}
