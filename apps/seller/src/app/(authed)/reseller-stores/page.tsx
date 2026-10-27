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
import { verdict } from '@/i18n/verdict';
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
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' });
}

/**
 * Reseller stores (RS-1) — separate businesses that sell YOUR stock under
 * their own name, each with its own login on member.skydrop.global.
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
  const t = useT();
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
      breadcrumbs={[
        { label: t('resellerStores.clientConsole') },
        { label: t('resellerStores.reselling') },
        { label: t('resellerStores.stores') },
      ]}
      Link={Link}
      title={t('resellerStores.memberStores')}
      subtitle={t('resellerStores.otherBusinessesThatSell')}
      meta={
        !loaded ? undefined : (
          <RsFacts>
            <RsFact tone={active > 0 ? 'good' : undefined}>{active} active</RsFact>
            {pending.length > 0 && (
              <RsFact tone="warn" dot>
                {richMessage(t('resellerStores.waitingForYourApproval'), {
                  pending: pending.length,
                })}
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
          {t('resellerStores.openAMemberStore')}
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
        <SkeletonRows rows={4} cols={6} label={t('resellerStores.loadingMemberStores')} />
      </div>
    );
  }
  if (stores.isError) {
    return (
      <div className="rs-page">
        {header}
        <ErrorState message={verdict(stores.error, t)} retry={() => void stores.refetch()} />
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
          label={t('resellerStores.stores')}
          icon={<Store size={14} />}
          value={all.length}
          unit={all.length === 1 ? 'store' : 'stores'}
          tone="neutral"
          hint={t('resellerStores.everyStoreOnYour')}
        />
        <KpiCard
          label={t('resellerStores.sellingNow')}
          icon={<UserCheck size={14} />}
          value={active}
          unit="active"
          tone={active > 0 ? 'credit' : 'neutral'}
          hint={t('resellerStores.takingOrdersAgainstYour')}
        />
        <KpiCard
          label={t('resellerStores.waitingForYou')}
          icon={<Pause size={14} />}
          value={pending.length}
          unit={pending.length === 1 ? 'store' : 'stores'}
          tone={pending.length > 0 ? 'pending' : 'neutral'}
          hint={
            pending.length > 0
              ? t('resellerStores.skydropOpenedTheseNothing')
              : t('resellerStores.nothingNeedsApproving')
          }
        />
        <KpiCard
          label={t('resellerStores.peopleWithALogin')}
          icon={<Users size={14} />}
          value={people}
          unit={people === 1 ? 'person' : 'people'}
          tone="neutral"
          hint={t('resellerStores.acrossEveryOneOf')}
        />
      </div>

      {pending.length > 0 ? (
        <RsSection
          title={t('resellerStores.waitingForYourApproval2')}
          note={t('resellerStores.skydropOpenedTheseFor')}
          flush
        >
          <StoreTable stores={pending} caption={t('resellerStores.storesWaitingForYour')} />
        </RsSection>
      ) : null}

      <RsSection
        title={t('resellerStores.yourMemberStores')}
        note={`${rest.length} ${rest.length === 1 ? 'store' : 'stores'}`}
        action={<RsLink href="/reseller-stores/reports">{t('resellerStores.reports')}</RsLink>}
        flush
      >
        {rest.length === 0 ? (
          <EmptyState
            bare
            title={t('resellerStores.noMemberStoresYet')}
            description={t('resellerStores.openOneForA')}
            action={
              <Button
                variant="primary"
                size="md"
                icon={<Plus size={15} />}
                onClick={() => setCreating(true)}
              >
                {t('resellerStores.openAMemberStore')}
              </Button>
            }
          />
        ) : (
          <StoreTable stores={rest} caption={t('resellerStores.yourMemberStores')} />
        )}
      </RsSection>

      {all.length > 0 && (
        <RsStrip>
          <RsStripFact
            label={t('resellerStores.active')}
            value={active}
            tone={active > 0 ? 'good' : 'neutral'}
          />
          <RsStripFact
            label={t('resellerStores.waitingOnYou')}
            value={pending.length}
            tone={pending.length > 0 ? 'warn' : 'neutral'}
          />
          <RsStripFact label={t('resellerStores.team')} value={`${people} people`} />
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
  const t = useT();
  return (
    <Table caption={caption}>
      <THead>
        <Tr>
          <Th>{t('resellerStores.store')}</Th>
          <Th>{t('resellerStores.status')}</Th>
          <Th>{t('resellerStores.openedBy')}</Th>
          <Th>{t('resellerStores.walletManagedBy')}</Th>
          <Th align="right">{t('resellerStores.team')}</Th>
          <Th>{t('resellerStores.created')}</Th>
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
                <span className="rs-faint rs-block">
                  {richMessage(t('resellerStores.customersSee'), { displayName: s.displayName })}
                </span>
              ) : null}
            </Td>
            <Td>
              <StatusChip
                kind={resellerStoreStatusKind(s.status)}
                label={resellerStoreStatusLabel(s.status)}
                size="sm"
              />
            </Td>
            <Td className="rs-small">
              {s.origin === 'ADMIN' ? 'Skydrop' : t('resellerStores.you')}
            </Td>
            <Td className="rs-small">
              {s.walletManagedBy === 'SKYDROP' ? 'Skydrop' : t('resellerStores.you')}
            </Td>
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
  const t = useT();
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
          // The store's own owner. A list because a store user holds
          // several roles; the owner role alone covers everything, so
          // there is nothing to add to it here.
          roleKeys: ['owner' as const],
        },
      });
      toast.success(t('resellerStores.isOpen', { name: name.trim() }));
      onOpenChange(false);
      setName('');
      setDisplayName('');
      setContactEmail('');
      setContactPhone('');
      setInviteEmail('');
      setInviteName('');
    } catch (err) {
      // Verbatim (FE-2): STORE_NAME_TAKEN, EMAIL_ALREADY_REGISTERED…
      setError(verdict(err, t));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('resellerStores.openAMemberStore')}
      description={t('resellerStores.itIsActiveAs')}
      icon={<Store size={18} />}
      size="lg"
      footer={
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            {t('resellerStores.cancel')}
          </Button>
          <AsyncButton
            type="submit"
            form="rs-create-form"
            variant="primary"
            size="md"
            state={pendingPhase(create.isPending)}
            labels={{ idle: t('resellerStores.openTheStore'), busy: t('resellerStores.opening') }}
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
          label={t('resellerStores.storeName')}
          hint={t('resellerStores.uniqueAmongYourStores')}
          required
          maxLength={80}
          showCount
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          id="rs-display"
          label={t('resellerStores.nameCustomersSee')}
          hint={t('resellerStores.leaveEmptyToUse')}
          maxLength={80}
          showCount
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <TextField
          id="rs-email"
          label={t('resellerStores.contactEmail')}
          type="email"
          required
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
        />
        <TextField
          id="rs-phone"
          label={t('resellerStores.contactPhone')}
          hint={t('resellerStores.withTheCountryCode')}
          type="tel"
          required
          value={contactPhone}
          onChange={(e) => setContactPhone(e.target.value)}
        />
        <Select
          id="rs-wallet"
          label={t('resellerStores.whoManagesTheStore')}
          value={walletManagedBy}
          onChange={(e) => setWalletManagedBy(e.target.value as WalletManager)}
        >
          <option value="SELLER">{t('resellerStores.youYouTopIt')}</option>
          <option value="SKYDROP">{t('resellerStores.skydropTheStoreTops')}</option>
        </Select>
        <fieldset className="rs-fieldset">
          <legend>{t('resellerStores.inviteItsFirstUser')}</legend>
          <p className="rs-muted">{t('resellerStores.aStoreOpensWith')}</p>
          <TextField
            id="rs-invite-email"
            label={t('resellerStores.theirEmail')}
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <TextField
            id="rs-invite-name"
            label={t('resellerStores.theirName')}
            hint={t('resellerStores.theyBecomeTheStore')}
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
