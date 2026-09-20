'use client';

import Link from 'next/link';
import { useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { Pause, Store, UserCheck, Users } from 'lucide-react';
import {
  BandBody,
  Button,
  Crumbs,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  MetaChip,
  Modal,
  ModalFooter,
  PageHeader,
  ResellerStoreStatusBadge,
  SectionBand,
  Select,
  Stat,
  StripFact,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useCreateResellerStore,
  useResellerStores,
  type ResellerStoreView,
  type WalletManager,
} from '@/lib/reseller-store-hooks';

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
      breadcrumb={
        <Crumbs
          items={[{ label: 'Seller console' }, { label: 'Reselling' }, { label: 'Stores' }]}
          Link={Link}
        />
      }
      title="Reseller stores"
      subtitle="Other businesses that sell your stock under their own name, with their own login."
      meta={
        !loaded ? undefined : (
          <>
            <MetaChip tone={active > 0 ? 'good' : 'neutral'}>{active} active</MetaChip>
            {pending.length > 0 && (
              <MetaChip tone="warn" dot>
                {pending.length} waiting for your approval
              </MetaChip>
            )}
            {paused > 0 && <MetaChip>{paused} paused</MetaChip>}
          </>
        )
      }
      action={
        <Button variant="primary" size="md" onClick={() => setCreating(true)}>
          Open a reseller store
        </Button>
      }
    />
  );

  if (stores.isPending) {
    return (
      <div>
        {header}
        <LoadingState label="Loading reseller stores" rows={4} />
      </div>
    );
  }
  if (stores.isError) {
    return (
      <div>
        {header}
        <ErrorState message={serverVerdict(stores.error)} retry={() => void stores.refetch()} />
      </div>
    );
  }

  return (
    <div>
      {header}

      {/* ── Who is selling for you ──────────────────────────────────
             Four tiles, every one counted off the list below. Nothing
             here is money: what a store EARNED you needs a window, and
             that lives on the reports page. */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Stores"
          icon={<Store size={13} aria-hidden />}
          value={all.length}
          unit={all.length === 1 ? 'store' : 'stores'}
          tone="neutral"
          hint="Every store on your account, whatever its state."
        />
        <Stat
          label="Selling now"
          icon={<UserCheck size={13} aria-hidden />}
          value={active}
          unit="active"
          tone={active > 0 ? 'good' : 'neutral'}
          hint="Taking orders against your stock."
        />
        <Stat
          label="Waiting for you"
          icon={<Pause size={13} aria-hidden />}
          value={pending.length}
          unit={pending.length === 1 ? 'store' : 'stores'}
          tone={pending.length > 0 ? 'warn' : 'neutral'}
          hint={
            pending.length > 0
              ? 'Skydrop opened these. Nothing is live until you decide.'
              : 'Nothing needs approving.'
          }
        />
        <Stat
          label="People with a login"
          icon={<Users size={13} aria-hidden />}
          value={people}
          unit={people === 1 ? 'person' : 'people'}
          tone="neutral"
          hint="Across every one of your stores."
        />
      </div>

      {pending.length > 0 ? (
        <>
          <SectionBand
            index="01"
            title="Waiting for your approval"
            note="Skydrop opened these for you. Nothing about them is live until you decide."
          />
          <BandBody flush className="mb-4">
            <StoreTable stores={pending} />
          </BandBody>
        </>
      ) : null}

      <SectionBand
        index={pending.length > 0 ? '02' : '01'}
        title="Your reseller stores"
        note={`${rest.length} ${rest.length === 1 ? 'store' : 'stores'}`}
        action={
          <Link
            href="/reseller-stores/reports"
            className="text-accent hover:text-text-bright text-xs transition-colors"
          >
            Reports →
          </Link>
        }
      />
      <BandBody flush>
        {rest.length === 0 ? (
          <EmptyState
            bare
            title="No reseller stores yet"
            description="Open one for a business that will resell your stock, and invite its first user."
            action={
              <Button variant="primary" size="md" onClick={() => setCreating(true)}>
                Open a reseller store
              </Button>
            }
          />
        ) : (
          <StoreTable stores={rest} />
        )}
      </BandBody>

      {all.length > 0 && (
        <div className="text-text-faint border-border mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3 font-mono text-[11px]">
          <StripFact label="Active" value={active} tone={active > 0 ? 'good' : 'neutral'} />
          <StripFact
            label="Waiting on you"
            value={pending.length}
            tone={pending.length > 0 ? 'warn' : 'neutral'}
          />
          <StripFact label="Team" value={`${people} people`} />
        </div>
      )}

      <CreateModal open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function StoreTable({ stores }: { stores: readonly ResellerStoreView[] }): ReactElement {
  return (
    <Table>
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
              <Link
                href={`/reseller-stores/${s.id}`}
                className="text-text-bright font-medium hover:underline"
              >
                {s.name}
              </Link>
              {s.displayName !== null ? (
                <span className="text-text-faint mt-0.5 block truncate text-xs">
                  Customers see {s.displayName}
                </span>
              ) : null}
            </Td>
            <Td>
              <ResellerStoreStatusBadge status={s.status} />
            </Td>
            <Td className="text-text-muted text-xs">{s.origin === 'ADMIN' ? 'Skydrop' : 'You'}</Td>
            <Td className="text-text-muted text-xs">
              {s.walletManagedBy === 'SKYDROP' ? 'Skydrop' : 'You'}
            </Td>
            <Td align="right" className="font-mono text-xs">
              {s.memberCount}
            </Td>
            <Td className="text-text-muted font-mono text-xs whitespace-nowrap">
              {day(s.createdAt)}
            </Td>
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
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Open a reseller store"
      description="It is active as soon as you create it."
      size="lg"
    >
      <form onSubmit={submit} className="space-y-4">
        <FormField label="Store name" htmlFor="rs-name" hint="Unique among your stores." required>
          <Input
            id="rs-name"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        <FormField
          label="Name customers see"
          htmlFor="rs-display"
          hint="Leave empty to use the store name."
        >
          <Input
            id="rs-display"
            maxLength={80}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </FormField>
        <FormField label="Contact email" htmlFor="rs-email" required>
          <Input
            id="rs-email"
            type="email"
            required
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
        </FormField>
        <FormField
          label="Contact phone"
          htmlFor="rs-phone"
          hint="With the country code, e.g. +919812345678."
          required
        >
          <Input
            id="rs-phone"
            type="tel"
            required
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />
        </FormField>
        <FormField label="Who manages the store’s wallet" htmlFor="rs-wallet">
          <Select
            id="rs-wallet"
            value={walletManagedBy}
            onChange={(e) => setWalletManagedBy(e.target.value as WalletManager)}
          >
            <option value="SELLER">You — you top it up and pay it yourself</option>
            <option value="SKYDROP">Skydrop — the store tops up and withdraws through us</option>
          </Select>
        </FormField>
        <fieldset className="border-border space-y-3 rounded-[var(--radius-3)] border p-3">
          <legend className="px-1 text-sm font-medium">Invite its first user</legend>
          <p className="text-text-muted px-1 text-xs">
            A store opens with somebody able to sign in to it. They get the invitation by email and
            become the store’s owner.
          </p>
          <FormField label="Their email" htmlFor="rs-invite-email" required>
            <Input
              id="rs-invite-email"
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </FormField>
          <FormField
            label="Their name"
            htmlFor="rs-invite-name"
            hint="They become the store’s owner."
            required
          >
            <Input
              id="rs-invite-name"
              required
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
            />
          </FormField>
        </fieldset>
        {error !== null ? (
          <p role="alert" className="text-critical text-sm">
            {error}
          </p>
        ) : null}
        <ModalFooter>
          <Button type="button" variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={create.isPending}>
            {create.isPending ? 'Opening…' : 'Open the store'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
