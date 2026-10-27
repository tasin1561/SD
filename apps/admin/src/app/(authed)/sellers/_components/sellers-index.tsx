'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { Plus, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSellersList } from '@/lib/api-hooks';
import type { SellerStatusValue } from '@skydrop/api-client';
import { Button } from '@skydrop/ui/app/button';
import { TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { Table, TBody, Td, Th, THead, Tr, TableEmpty } from '@skydrop/ui/app/data-table';
import { Pagination } from '@skydrop/ui/app/pagination';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { AcCard, AcHeader, AcPage, SellerStatusChip } from '../../settings/_components/ac-parts';
import { InvitationsPanel } from './invitations-panel';
import { CreateInvitationDialog } from './create-invitation-dialog';
import { usePermission } from '@/lib/use-permission';
import { useT } from '@/i18n/client';

const PAGE_SIZE = 20;
const STATUSES: readonly SellerStatusValue[] = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'];

export function SellersIndex(): ReactElement {
  const t = useT();
  const router = useRouter();
  const canWrite = usePermission('sellers.invite');
  const [status, setStatus] = useState<SellerStatusValue | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(false);

  const list = useSellersList({
    ...(status ? { status } : {}),
    ...(search ? { search } : {}),
    page,
    pageSize: PAGE_SIZE,
  });

  return (
    <AcPage>
      <AcHeader
        title={t('sellersSellersIndex.clients')}
        subtitle={t('sellersSellersIndex.invitationLifecycleClientStatusManagement')}
        action={
          canWrite ? (
            <Button
              variant="primary"
              size="md"
              icon={<Plus size={15} />}
              onClick={() => setInviteOpen(true)}
            >
              {t('sellersSellersIndex.inviteClient')}
            </Button>
          ) : null
        }
      />

      <InvitationsPanel />

      <div className="ac-toolbar">
        <TextField
          label={t('sellersSellersIndex.search')}
          icon={<Search size={15} />}
          placeholder={t('sellersSellersIndex.searchByNameEmailPhone')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Select
          label={t('sellersSellersIndex.status')}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as SellerStatusValue | '');
            setPage(1);
          }}
        >
          <option value="">{t('sellersSellersIndex.allStatuses')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

      {list.isLoading ? (
        <SkeletonRows rows={6} cols={7} label={t('sellersSellersIndex.loadingClients')} />
      ) : list.isError ? (
        <ErrorState
          message={list.error?.message ?? t('sellersSellersIndex.failedToLoadClients')}
          retry={() => void list.refetch()}
        />
      ) : !list.data || list.data.items.length === 0 ? (
        <EmptyState
          title={t('sellersSellersIndex.noClientsMatchTheseFilters')}
          description={t('sellersSellersIndex.tryClearingTheFiltersOr')}
        />
      ) : (
        <AcCard flush>
          <Table caption={t('sellersSellersIndex.clients')}>
            <THead>
              <Tr>
                <Th>{t('sellersSellersIndex.company')}</Th>
                <Th>{t('sellersSellersIndex.code')}</Th>
                <Th>{t('sellersSellersIndex.contact')}</Th>
                <Th>{t('sellersSellersIndex.email')}</Th>
                <Th>{t('sellersSellersIndex.status')}</Th>
                <Th>{t('sellersSellersIndex.approved')}</Th>
                <Th>{t('sellersSellersIndex.created')}</Th>
              </Tr>
            </THead>
            <TBody>
              {list.data.items.map((s) => (
                <Tr key={s.id} onActivate={() => router.push(`/sellers/${s.id}`)}>
                  <Td>
                    <Link href={`/sellers/${s.id}`} className="ac-link ac-cell-main">
                      {s.companyName}
                    </Link>
                  </Td>
                  <Td>
                    <span className="sk-ident">{s.initials ?? '—'}</span>
                  </Td>
                  <Td>{s.contactPersonName}</Td>
                  <Td>
                    <span className="ac-code">{s.email}</span>
                  </Td>
                  <Td>
                    <SellerStatusChip status={s.status} />
                  </Td>
                  <Td>
                    <span className="sk-figure ac-faint">
                      {s.approvedAt ? new Date(s.approvedAt).toISOString().slice(0, 10) : '—'}
                    </span>
                  </Td>
                  <Td>
                    <span className="sk-figure ac-faint">
                      {new Date(s.createdAt).toISOString().slice(0, 10)}
                    </span>
                  </Td>
                </Tr>
              ))}
            </TBody>
            {list.data.total === 0 && (
              <TBody>
                <TableEmpty colSpan={6}>
                  {t('sellersSellersIndex.noClientsMatchThisFilter')}
                </TableEmpty>
              </TBody>
            )}
          </Table>
          <div className="ac-pad">
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={list.data.total}
              onPageChange={setPage}
              label={t('sellersSellersIndex.clientsPages')}
            />
          </div>
        </AcCard>
      )}

      <CreateInvitationDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </AcPage>
  );
}
