'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent, type ReactElement } from 'react';
import { Store } from 'lucide-react';
import { resellerStoreStatusKind, resellerStoreStatusLabel } from '@skydrop/ui/status';
import { useToast } from '@skydrop/ui/app/toast';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TBody, THead, Table, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { AcAlert, AcCard, AcHeader, AcPage, phaseOf } from '../settings/_components/ac-parts';
import { useSellersList } from '@/lib/api-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { useAdminCreateResellerStore, useAdminResellerStores } from '@/lib/reseller-store-hooks';
import { useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

const STATUSES = (t: Translate<MessageKey>) =>
  [
    ['', t('resellerStoresPage.everyStatus')],
    ['PENDING_SELLER_APPROVAL', t('resellerStoresPage.awaitingTheClient')],
    ['ACTIVE', t('resellerStoresPage.active')],
    ['PAUSED', t('resellerStoresPage.paused')],
    ['CLOSED', t('resellerStoresPage.closed')],
    ['REJECTED', t('resellerStoresPage.rejected')],
  ] as const;

/**
 * Reseller stores across every seller (RS-1). Opening one for a seller
 * lands it awaiting their approval and tells them; the seller drives the
 * lifecycle after that, so this screen reads it rather than steering it.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ResellerStoresPage(): ReactElement {
  const t = useT();
  // The filters live in the URL (`?status=&sellerId=`) so a link — a
  // seller's page, a store's "their other stores" — can open it pre-filled.
  return (
    <Suspense
      fallback={
        <SkeletonRows rows={5} cols={7} label={t('resellerStoresPage.loadingMemberStores')} />
      }
    >
      <ResellerStoresIndex />
    </Suspense>
  );
}

function ResellerStoresIndex(): ReactElement {
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const status = params.get('status') ?? '';
  const rawSeller = params.get('sellerId') ?? '';
  const sellerId = UUID_RE.test(rawSeller) ? rawSeller : '';
  const stores = useAdminResellerStores({ status, sellerId });
  const sellers = useSellersList({ status: 'APPROVED', search: '', pageSize: 100 });
  const mayCreate = usePermission('reseller.stores.manage');
  const [creating, setCreating] = useState(false);

  function setFilter(key: 'status' | 'sellerId', value: string): void {
    const next = new URLSearchParams(params.toString());
    if (value === '') next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.replace(qs === '' ? pathname : `${pathname}?${qs}`);
  }
  const sellerOptions = sellers.data?.items ?? [];
  const sellerKnown = sellerId === '' || sellerOptions.some((o) => o.id === sellerId);

  return (
    <AcPage>
      <AcHeader
        title={t('resellerStoresPage.memberStores')}
        subtitle={t('resellerStoresPage.businessesResellingOneClientS')}
        action={
          mayCreate ? (
            <Button
              variant="primary"
              size="md"
              icon={<Store size={15} />}
              onClick={() => setCreating(true)}
            >
              {t('resellerStoresPage.openAStoreForA')}
            </Button>
          ) : undefined
        }
      />
      <div className="ac-toolbar">
        <Select
          label={t('resellerStoresPage.status')}
          id="rs-status"
          value={status}
          onChange={(e) => setFilter('status', e.target.value)}
        >
          {STATUSES(t).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          label={t('resellerStoresPage.client')}
          id="rs-seller"
          value={sellerId}
          onChange={(e) => setFilter('sellerId', e.target.value)}
        >
          <option value="">{t('resellerStoresPage.everyClient')}</option>
          {!sellerKnown ? (
            <option value={sellerId}>{t('resellerStoresPage.theClientInTheLink')}</option>
          ) : null}
          {sellerOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.companyName}
            </option>
          ))}
        </Select>
      </div>

      {stores.isPending ? (
        <SkeletonRows rows={5} cols={7} label={t('resellerStoresPage.loadingMemberStores')} />
      ) : stores.isError ? (
        <ErrorState message={serverVerdict(stores.error)} retry={() => void stores.refetch()} />
      ) : stores.data.length === 0 ? (
        <EmptyState
          title={t('resellerStoresPage.noMemberStores')}
          description={
            status === '' && sellerId === ''
              ? t('resellerStoresPage.clientsOpenTheirOwnFrom')
              : t('resellerStoresPage.noneMatchTheseFiltersChoose')
          }
        />
      ) : (
        <AcCard flush>
          <Table caption={t('resellerStoresPage.memberStores')}>
            <THead>
              <Tr>
                <Th>{t('resellerStoresPage.store')}</Th>
                <Th>{t('resellerStoresPage.client')}</Th>
                <Th>{t('resellerStoresPage.status')}</Th>
                <Th>{t('resellerStoresPage.openedBy')}</Th>
                <Th>{t('resellerStoresPage.wallet')}</Th>
                <Th>{t('resellerStoresPage.team')}</Th>
                <Th>{t('resellerStoresPage.created')}</Th>
              </Tr>
            </THead>
            <TBody>
              {stores.data.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <Link href={`/reseller-stores/${s.id}`} className="ac-link ac-cell-main">
                      {s.name}
                    </Link>
                  </Td>
                  <Td>
                    <Link
                      href={`/reseller-stores?sellerId=${s.sellerId}`}
                      className="ac-link"
                      title={t('resellerStoresPage.onlyThisClientSStores')}
                    >
                      {s.sellerCompanyName}
                    </Link>
                  </Td>
                  <Td>
                    <StatusChip
                      kind={resellerStoreStatusKind(s.status)}
                      label={resellerStoreStatusLabel(s.status)}
                      size="sm"
                    />
                  </Td>
                  <Td>
                    {s.origin === 'ADMIN'
                      ? t('resellerStoresPage.skydrop')
                      : t('resellerStoresPage.client')}
                  </Td>
                  <Td>
                    {s.walletManagedBy === 'SKYDROP'
                      ? t('resellerStoresPage.skydrop')
                      : t('resellerStoresPage.client')}
                  </Td>
                  <Td>
                    <span className="sk-figure">{s.memberCount}</span>
                  </Td>
                  <Td>
                    <span className="sk-figure ac-faint">
                      {new Date(s.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                    </span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </AcCard>
      )}
      {mayCreate ? <CreateModal open={creating} onOpenChange={setCreating} /> : null}
    </AcPage>
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
  const create = useAdminCreateResellerStore();
  const [search, setSearch] = useState('');
  const sellers = useSellersList({ status: 'APPROVED', search, pageSize: 25 });
  const [sellerId, setSellerId] = useState('');
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    const opt = (v: string): string | undefined => (v.trim() === '' ? undefined : v.trim());
    try {
      const created = await create.mutateAsync({
        sellerId,
        name: name.trim(),
        ...(opt(displayName) === undefined ? {} : { displayName: opt(displayName) }),
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim(),
        ...(opt(note) === undefined ? {} : { note: opt(note) }),
      });
      toast.success(
        t('resellerStoresPage.isWaitingForToApprove', {
          name: created.name,
          sellerCompanyName: created.sellerCompanyName,
        }),
      );
      onOpenChange(false);
    } catch (err) {
      // Verbatim (FE-2): STORE_NAME_TAKEN, SELLER_NOT_ACTIVE…
      setError(serverVerdict(err));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('resellerStoresPage.openAMemberStoreFor')}
      description={t('resellerStoresPage.itWaitsForTheClient')}
      icon={<Store size={18} />}
      size="lg"
      locked={create.isPending}
    >
      <form onSubmit={submit} className="ac-form">
        <TextField
          label={t('resellerStoresPage.findTheClient')}
          id="cr-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          label={t('resellerStoresPage.client')}
          id="cr-seller"
          required
          value={sellerId}
          onChange={(e) => setSellerId(e.target.value)}
        >
          <option value="">
            {sellers.isPending
              ? t('resellerStoresPage.loading')
              : t('resellerStoresPage.chooseAnApprovedClient')}
          </option>
          {(sellers.data?.items ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.companyName}
            </option>
          ))}
        </Select>
        <div className="ac-form-grid" data-cols="2">
          <TextField
            label={t('resellerStoresPage.storeName')}
            id="cr-name"
            hint={t('resellerStoresPage.uniqueAmongThisClientS')}
            required
            maxLength={80}
            showCount
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            label={t('resellerStoresPage.nameCustomersSee')}
            id="cr-display"
            maxLength={80}
            showCount
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <TextField
            label={t('resellerStoresPage.contactEmail')}
            id="cr-email"
            type="email"
            required
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
          <TextField
            label={t('resellerStoresPage.contactPhone')}
            id="cr-phone"
            hint={t('resellerStoresPage.withTheCountryCode8801712345678')}
            type="tel"
            required
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />
        </div>
        <TextArea
          label={t('resellerStoresPage.noteForTheClient')}
          id="cr-note"
          maxLength={500}
          showCount
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {error !== null ? <AcAlert message={error} /> : null}
        <DialogFooter>
          <Button type="button" variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            {t('resellerStoresPage.cancel')}
          </Button>
          <AsyncButton
            type="submit"
            variant="primary"
            size="md"
            icon={<Store size={15} />}
            state={phaseOf(create.isPending, error)}
            labels={{
              idle: t('resellerStoresPage.openAndAskTheClient'),
              busy: t('resellerStoresPage.opening'),
              error: t('resellerStoresPage.notOpened'),
            }}
            disabled={create.isPending || sellerId === ''}
          />
        </DialogFooter>
      </form>
    </Dialog>
  );
}
