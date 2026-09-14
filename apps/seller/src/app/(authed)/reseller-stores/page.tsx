'use client';

import Link from 'next/link';
import { useState, type FormEvent, type ReactElement } from 'react';
import {
  Button,
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
 */
export default function ResellerStoresPage(): ReactElement {
  const stores = useResellerStores();
  const [creating, setCreating] = useState(false);

  const header = (
    <PageHeader
      title="Reseller stores"
      subtitle="Other businesses that sell your stock under their own name, with their own login."
      action={
        <Button variant="primary" size="md" onClick={() => setCreating(true)}>
          Open a reseller store
        </Button>
      }
    />
  );

  if (stores.isPending) {
    return (
      <div className="space-y-6">
        {header}
        <LoadingState label="Loading reseller stores" rows={4} />
      </div>
    );
  }
  if (stores.isError) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState message={serverVerdict(stores.error)} retry={() => void stores.refetch()} />
      </div>
    );
  }

  const pending = stores.data.filter((s) => s.status === 'PENDING_SELLER_APPROVAL');
  const rest = stores.data.filter((s) => s.status !== 'PENDING_SELLER_APPROVAL');

  return (
    <div className="space-y-6">
      {header}
      {pending.length > 0 ? (
        <Section
          title="Waiting for your approval"
          subtitle="Skydrop opened these for you. Nothing about them is live until you decide."
        >
          <StoreTable stores={pending} />
        </Section>
      ) : null}
      <Section title="Your reseller stores">
        {rest.length === 0 ? (
          <EmptyState
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
      </Section>
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
          <Th>Team</Th>
          <Th>Created</Th>
        </Tr>
      </THead>
      <TBody>
        {stores.map((s) => (
          <Tr key={s.id}>
            <Td>
              <Link
                href={`/reseller-stores/${s.id}`}
                className="text-accent hover:text-accent-hover"
              >
                {s.name}
              </Link>
              {s.displayName !== null ? (
                <div className="text-text-muted text-xs">{s.displayName}</div>
              ) : null}
            </Td>
            <Td>
              <ResellerStoreStatusBadge status={s.status} />
            </Td>
            <Td>{s.origin === 'ADMIN' ? 'Skydrop' : 'You'}</Td>
            <Td>{s.walletManagedBy === 'SKYDROP' ? 'Skydrop' : 'You'}</Td>
            <Td>{s.memberCount}</Td>
            <Td>{day(s.createdAt)}</Td>
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
      const inviteMail = opt(inviteEmail);
      await create.mutateAsync({
        name: name.trim(),
        ...(opt(displayName) === undefined ? {} : { displayName: opt(displayName) }),
        ...(opt(contactEmail) === undefined ? {} : { contactEmail: opt(contactEmail) }),
        ...(opt(contactPhone) === undefined ? {} : { contactPhone: opt(contactPhone) }),
        walletManagedBy,
        // The store's first user is its owner.
        ...(inviteMail === undefined
          ? {}
          : {
              invite: { email: inviteMail, fullName: inviteName.trim(), roleKey: 'owner' as const },
            }),
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
        <FormField label="Contact email" htmlFor="rs-email">
          <Input
            id="rs-email"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
        </FormField>
        <FormField
          label="Contact phone"
          htmlFor="rs-phone"
          hint="With the country code, e.g. +919812345678."
        >
          <Input
            id="rs-phone"
            type="tel"
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
        <fieldset className="border-border space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">Invite its first user (optional)</legend>
          <FormField label="Their email" htmlFor="rs-invite-email">
            <Input
              id="rs-invite-email"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </FormField>
          <FormField
            label="Their name"
            htmlFor="rs-invite-name"
            hint="They become the store’s owner."
          >
            <Input
              id="rs-invite-name"
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
