'use client';

import Link from 'next/link';
import { useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { Pause, Plus, Store, UserCheck, Users } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton, SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { resellerStoreStatusKind, resellerStoreStatusLabel } from '@skydrop/ui/status';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useCreateResellerStore,
  useResellerStores,
  type ResellerStoreView,
  type WalletManager,
} from '@/lib/reseller-store-hooks';
import {
  RsError,
  RsFact,
  RsFacts,
  RsLink,
  RsSection,
  RsStrip,
  RsStripFact,
  pendingPhase,
} from './_components/rs-parts';

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' });
}

/**
 * Reseller stores (RS-1) — separate businesses that sell YOUR stock under
 * their own name, each with its own login on reseller.skydrop.online.
 * Stores Skydrop opened for you wait here for your approval.
 *
 * ── WHAT THE CONSOLE COMPS SHOW THAT IS NOT HERE ────────────────────
 *   REVENUE / ORDERS PER STORE   real, but on a different endpoint and
 *       over a WINDOW the reader has to choose — that is the reports
 *       page, which this links to. Putting a figure here with no window
 *       beside it would be a number nobody could reproduce.
 *   STORE WALLET BALANCE         carried by the store's own summary
 *       (one request per store). Fetching N of them to fill a column
 *       would make this list's cost grow with the number of stores; it
 *       is on the store's page, where one request answers it.
 *   LAST ORDER / LAST SIGN-IN    the list carries neither. `memberCount`
 *       and `statusChangedAt` are what it does carry.
 */
export default function ResellerStoresPage(): ReactElement {
  const stores = useResellerStores();
  const [creating, setCreating] = useState(false);

  const all = useMemo(() => stores.data ?? [], [stores.data]);
  const pending = all.filter((s) => s.status === 'PENDING_SELLER_APPROVAL');
  const rest = all.filter((s) => s.status !== 'PENDING_SELLER_APPROVAL');
  const active = all.filter((s) => s.status === 'ACTIVE').length;
  const paused = all.filter((s) => s.status === 'PAUSED').length;
  const people = all.reduce((sum, s) => sum + s.memberCount, 0);
  const loaded = !stores.isPending && !stores.isError;

  const header = (
    <PageHeader
      breadcrumbs={[{ label: 'Seller console' }, { label: 'Reselling' }, { label: 'Stores' }]}
      Link={Link}
      title="Reseller stores"
      subtitle="Other businesses that sell your stock under their own name, with their own login."
      meta={
        !loaded ? undefined : (
          <RsFacts>
            <RsFact tone={active > 0 ? 'good' : undefined}>{active} active</RsFact>
            {pending.length > 0 && (
              <RsFact tone="warn" dot>
                {pending.length} waiting for your approval
              </RsFact>
            )}
            {paused > 0 && <RsFact>{paused} paused</RsFact>}
          </RsFacts>
        )
      }
      action={
        <Button
          variant="primary"
          size="md"
          icon={<Plus size={15} />}
          onClick={() => setCreating(true)}
        >
          Open a reseller store
        </Button>
      }
    />
  );

  if (stores.isPending) {
    return (
      <div className="rs-page">
        {header}
        <div className="rs-kpis">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="rs-kpi-skel" height={104} rounded="md" />
          ))}
        </div>
        <SkeletonRows rows={4} cols={6} label="Loading reseller stores" />
      </div>
    );
  }
  if (stores.isError) {
    return (
      <div className="rs-page">
        {header}
        <ErrorState message={serverVerdict(stores.error)} retry={() => void stores.refetch()} />
      </div>
    );
  }

  return (
    <div className="rs-page">
      {header}

      {/* ── Who is selling for you ──────────────────────────────────
             Four cards, every one counted off the list below (plain
             counts, so each rolls up once). Nothing here is money: what a
             store EARNED you needs a window, and that lives on the
             reports page. */}
      <div className="rs-kpis">
        <KpiCard
          label="Stores"
          icon={<Store size={14} />}
          value={all.length}
          unit={all.length === 1 ? 'store' : 'stores'}
          tone="neutral"
          hint="Every store on your account, whatever its state."
        />
        <KpiCard
          label="Selling now"
          icon={<UserCheck size={14} />}
          value={active}
          unit="active"
          tone={active > 0 ? 'credit' : 'neutral'}
          hint="Taking orders against your stock."
        />
        <KpiCard
          label="Waiting for you"
          icon={<Pause size={14} />}
          value={pending.length}
          unit={pending.length === 1 ? 'store' : 'stores'}
          tone={pending.length > 0 ? 'pending' : 'neutral'}
          hint={
            pending.length > 0
              ? 'Skydrop opened these. Nothing is live until you decide.'
              : 'Nothing needs approving.'
          }
        />
        <KpiCard
          label="People with a login"
          icon={<Users size={14} />}
          value={people}
          unit={people === 1 ? 'person' : 'people'}
          tone="neutral"
          hint="Across every one of your stores."
        />
      </div>

      {pending.length > 0 ? (
        <RsSection
          title="Waiting for your approval"
          note="Skydrop opened these for you. Nothing about them is live until you decide."
          flush
        >
          <StoreTable stores={pending} caption="Stores waiting for your approval" />
        </RsSection>
      ) : null}

      <RsSection
        title="Your reseller stores"
        note={`${rest.length} ${rest.length === 1 ? 'store' : 'stores'}`}
        action={<RsLink href="/reseller-stores/reports">Reports</RsLink>}
        flush
      >
        {rest.length === 0 ? (
          <EmptyState
            bare
            title="No reseller stores yet"
            description="Open one for a business that will resell your stock, and invite its first user."
            action={
              <Button
                variant="primary"
                size="md"
                icon={<Plus size={15} />}
                onClick={() => setCreating(true)}
              >
                Open a reseller store
              </Button>
            }
          />
        ) : (
          <StoreTable stores={rest} caption="Your reseller stores" />
        )}
      </RsSection>

      {all.length > 0 && (
        <RsStrip>
          <RsStripFact label="Active" value={active} tone={active > 0 ? 'good' : 'neutral'} />
          <RsStripFact
            label="Waiting on you"
            value={pending.length}
            tone={pending.length > 0 ? 'warn' : 'neutral'}
          />
          <RsStripFact label="Team" value={`${people} people`} />
        </RsStrip>
      )}

      <CreateModal open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function StoreTable({
  stores,
  caption,
}: {
  stores: readonly ResellerStoreView[];
  caption: string;
}): ReactElement {
  return (
    <Table caption={caption}>
      <THead>
        <Tr>
          <Th>Store</Th>
          <Th>Status</Th>
          <Th>Opened by</Th>
          <Th>Wallet managed by</Th>
          <Th align="right">Team</Th>
          <Th>Created</Th>
        </Tr>
      </THead>
      <TBody>
        {stores.map((s) => (
          <Tr key={s.id}>
            <Td>
              <Link href={`/reseller-stores/${s.id}`} className="rs-name-link">
                {s.name}
              </Link>
              {s.displayName !== null ? (
                <span className="rs-faint rs-block">Customers see {s.displayName}</span>
              ) : null}
            </Td>
            <Td>
              <StatusChip
                kind={resellerStoreStatusKind(s.status)}
                label={resellerStoreStatusLabel(s.status)}
                size="sm"
              />
            </Td>
            <Td className="rs-small">{s.origin === 'ADMIN' ? 'Skydrop' : 'You'}</Td>
            <Td className="rs-small">{s.walletManagedBy === 'SKYDROP' ? 'Skydrop' : 'You'}</Td>
            <Td align="right" className="sk-figure">
              {s.memberCount}
            </Td>
            <Td className="rs-when sk-figure">{day(s.createdAt)}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

function CreateModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const toast = useToast();
  const create = useCreateResellerStore();
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [walletManagedBy, setWalletManagedBy] = useState<WalletManager>('SELLER');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    const opt = (v: string): string | undefined => (v.trim() === '' ? undefined : v.trim());
    try {
      await create.mutateAsync({
        name: name.trim(),
        ...(opt(displayName) === undefined ? {} : { displayName: opt(displayName) }),
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim(),
        walletManagedBy,
        // A store with nobody able to sign in is not open, so the first
        // user — its owner — is invited as it is created.
        invite: {
          email: inviteEmail.trim(),
          fullName: inviteName.trim(),
          roleKey: 'owner' as const,
        },
      });
      toast.success(`“${name.trim()}” is open.`);
      onOpenChange(false);
      setName('');
      setDisplayName('');
      setContactEmail('');
      setContactPhone('');
      setInviteEmail('');
      setInviteName('');
    } catch (err) {
      // Verbatim (FE-2): STORE_NAME_TAKEN, EMAIL_ALREADY_REGISTERED…
      setError(serverVerdict(err));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Open a reseller store"
      description="It is active as soon as you create it."
      icon={<Store size={18} />}
      size="lg"
      footer={
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <AsyncButton
            type="submit"
            form="rs-create-form"
            variant="primary"
            size="md"
            state={pendingPhase(create.isPending)}
            labels={{ idle: 'Open the store', busy: 'Opening…' }}
          />
        </DialogFooter>
      }
    >
      {/* The submit sits in the pinned footer, tied to this form by its
          `form` attribute, so Enter in any field still submits and the
          browser's own checks (the `required` fields) still run. */}
      <form id="rs-create-form" onSubmit={submit} className="rs-form">
        <TextField
          id="rs-name"
          label="Store name"
          hint="Unique among your stores."
          required
          maxLength={80}
          showCount
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          id="rs-display"
          label="Name customers see"
          hint="Leave empty to use the store name."
          maxLength={80}
          showCount
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <TextField
          id="rs-email"
          label="Contact email"
          type="email"
          required
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
        />
        <TextField
          id="rs-phone"
          label="Contact phone"
          hint="With the country code, e.g. +919812345678."
          type="tel"
          required
          value={contactPhone}
          onChange={(e) => setContactPhone(e.target.value)}
        />
        <Select
          id="rs-wallet"
          label="Who manages the store’s wallet"
          value={walletManagedBy}
          onChange={(e) => setWalletManagedBy(e.target.value as WalletManager)}
        >
          <option value="SELLER">You — you top it up and pay it yourself</option>
          <option value="SKYDROP">Skydrop — the store tops up and withdraws through us</option>
        </Select>
        <fieldset className="rs-fieldset">
          <legend>Invite its first user</legend>
          <p className="rs-muted">
            A store opens with somebody able to sign in to it. They get the invitation by email and
            become the store’s owner.
          </p>
          <TextField
            id="rs-invite-email"
            label="Their email"
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <TextField
            id="rs-invite-name"
            label="Their name"
            hint="They become the store’s owner."
            required
            value={inviteName}
            onChange={(e) => setInviteName(e.target.value)}
          />
        </fieldset>
        {error !== null ? <RsError>{error}</RsError> : null}
      </form>
    </Dialog>
  );
}
