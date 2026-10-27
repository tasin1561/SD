'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { PencilLine, Search, Star, Store as StoreIcon } from 'lucide-react';
import { useToast } from '@skydrop/ui/app/toast';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TBody, THead, Table, TableEmpty, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { AcAlert, AcHeader, AcPage, AcSection, phaseOf } from '../../settings/_components/ac-parts';
import {
  useAdminCreateStore,
  useAdminMakeStoreDefault,
  useAdminRenameStore,
  useAdminSetStoreActive,
  useSellerStores,
  type AdminStoreView,
  type SellerStoresGroupView,
} from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { useT } from '@/i18n/client';

/**
 * Every seller's shopfronts, and the ability to fix one.
 *
 * ── WHY WE CAN WRITE HERE AT ALL ─────────────────────────────────────
 * The seller manages their own, so this is not the primary path. It is
 * the SUPPORT path: somebody rings because orders are landing under the
 * wrong brand, or they closed the store they meant to keep, and the
 * alternative is talking them through a screen while they are already
 * frustrated.
 *
 * Every write is audited as STAFF against that seller, so their history
 * says "we changed it" rather than "they did" — which is the question
 * asked when they ring back about a store they do not remember closing.
 */
export function SellerStoresIndex(): ReactElement {
  const t = useT();
  const canManage = usePermission('sellers.settings.manage');
  const [term, setTerm] = useState('');
  const groups = useSellerStores('');
  const toast = useToast();

  const [adding, setAdding] = useState<SellerStoresGroupView | null>(null);
  const [editing, setEditing] = useState<{
    seller: SellerStoresGroupView;
    store: AdminStoreView;
  } | null>(null);

  const makeDefault = useAdminMakeStoreDefault();
  const setActive = useAdminSetStoreActive();

  async function run(fn: () => Promise<unknown>, done: string): Promise<void> {
    try {
      await fn();
      toast.success(done);
    } catch (err) {
      // FE-2 — the server's own words. "This is the default shop" is a
      // sentence the UI must not try to guess at.
      toast.error(serverVerdict(err));
    }
  }

  const shown = (groups.data ?? []).filter((g) => {
    const q = term.trim().toLowerCase();
    return (
      q === '' ||
      g.companyName.toLowerCase().includes(q) ||
      g.email.toLowerCase().includes(q) ||
      g.stores.some((s) => s.name.toLowerCase().includes(q))
    );
  });

  return (
    <AcPage>
      <AcHeader
        title={t('storesSellerStoresIndex.shops')}
        subtitle={t('storesSellerStoresIndex.theShopsEachClientSells')}
      />

      {groups.isLoading ? (
        <SkeletonRows rows={6} cols={4} />
      ) : groups.isError || groups.data === undefined ? (
        <ErrorState
          message={groups.error?.message ?? t('storesSellerStoresIndex.couldNotLoadTheShops')}
          retry={() => void groups.refetch()}
        />
      ) : (
        <>
          <div className="ac-toolbar">
            <TextField
              icon={<Search size={15} />}
              placeholder={t('storesSellerStoresIndex.filterByClientOrShop')}
              aria-label={t('storesSellerStoresIndex.filter')}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
          </div>

          {shown.length === 0 ? (
            <EmptyState title={t('storesSellerStoresIndex.noClientMatchesThat')} />
          ) : (
            shown.map((g) => (
              <AcSection
                key={g.sellerId}
                title={
                  <Link href={`/sellers/${g.sellerId}`} className="ac-link">
                    {g.companyName}
                  </Link>
                }
                note={g.email}
                action={
                  canManage ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<StoreIcon size={14} />}
                      onClick={() => setAdding(g)}
                    >
                      {t('storesSellerStoresIndex.addAStore')}
                    </Button>
                  ) : undefined
                }
                flush
              >
                <Table
                  caption={t('storesSellerStoresIndex.storesFor', { companyName: g.companyName })}
                >
                  <THead>
                    <Tr>
                      <Th>{t('storesSellerStoresIndex.shop')}</Th>
                      <Th align="right">{t('storesSellerStoresIndex.orders')}</Th>
                      <Th>{t('storesSellerStoresIndex.state')}</Th>
                      <Th align="right">{t('storesSellerStoresIndex.actions')}</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {g.stores.length === 0 ? (
                      // Not a blank. A seller with no store has nowhere
                      // for their orders to be filed, which cannot
                      // happen for a company created after stores
                      // shipped — so seeing it is a finding.
                      <TableEmpty colSpan={4}>
                        {t('storesSellerStoresIndex.noStoresTheirOrdersHave')}
                      </TableEmpty>
                    ) : (
                      g.stores.map((s) => (
                        <Tr key={s.id}>
                          <Td>
                            <span className="ac-cell-main">{s.name}</span>
                            {s.note !== null && <span className="ac-cell-sub">{s.note}</span>}
                          </Td>
                          <Td align="right">
                            <span className="sk-figure">{s.orderCount}</span>
                          </Td>
                          <Td>
                            <span className="ac-inline">
                              {s.isDefault && (
                                <StatusChip
                                  kind="confirmed"
                                  label={t('storesSellerStoresIndex.default')}
                                  size="sm"
                                />
                              )}
                              <StatusChip
                                kind={s.isActive ? 'delivered' : 'cancelled'}
                                label={
                                  s.isActive
                                    ? t('storesSellerStoresIndex.open')
                                    : t('storesSellerStoresIndex.closed')
                                }
                                size="sm"
                              />
                            </span>
                          </Td>
                          <Td align="right">
                            {canManage ? (
                              <div className="ac-buttons">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  icon={<PencilLine size={14} />}
                                  onClick={() => setEditing({ seller: g, store: s })}
                                >
                                  {t('storesSellerStoresIndex.rename')}
                                </Button>
                                {!s.isDefault && s.isActive && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    icon={<Star size={14} />}
                                    disabled={makeDefault.isPending}
                                    onClick={() =>
                                      void run(
                                        () =>
                                          makeDefault.mutateAsync({
                                            sellerId: g.sellerId,
                                            storeId: s.id,
                                          }),
                                        t('storesSellerStoresIndex.newOrdersForWillBe', {
                                          companyName: g.companyName,
                                          name: s.name,
                                        }),
                                      )
                                    }
                                  >
                                    {t('storesSellerStoresIndex.makeDefault')}
                                  </Button>
                                )}
                                {!s.isDefault && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={setActive.isPending}
                                    onClick={() =>
                                      void run(
                                        () =>
                                          setActive.mutateAsync({
                                            sellerId: g.sellerId,
                                            storeId: s.id,
                                            isActive: !s.isActive,
                                          }),
                                        s.isActive
                                          ? t('storesSellerStoresIndex.isClosed', { name: s.name })
                                          : t('storesSellerStoresIndex.isOpen', { name: s.name }),
                                      )
                                    }
                                  >
                                    {s.isActive
                                      ? t('storesSellerStoresIndex.close')
                                      : t('storesSellerStoresIndex.reopen')}
                                  </Button>
                                )}
                              </div>
                            ) : (
                              <span className="ac-faint">—</span>
                            )}
                          </Td>
                        </Tr>
                      ))
                    )}
                  </TBody>
                </Table>
              </AcSection>
            ))
          )}
        </>
      )}

      {adding !== null && <StoreModal seller={adding} onClose={() => setAdding(null)} />}
      {editing !== null && (
        <StoreModal
          seller={editing.seller}
          store={editing.store}
          onClose={() => setEditing(null)}
        />
      )}
    </AcPage>
  );
}

function StoreModal({
  seller,
  store,
  onClose,
}: {
  readonly seller: SellerStoresGroupView;
  readonly store?: AdminStoreView;
  readonly onClose: () => void;
}): ReactElement {
  const t = useT();
  const create = useAdminCreateStore();
  const rename = useAdminRenameStore();
  const [name, setName] = useState(store?.name ?? '');
  const [note, setNote] = useState(store?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const editing = store !== undefined;
  const busy = create.isPending || rename.isPending;

  async function save(): Promise<void> {
    setError(null);
    if (name.trim() === '') {
      setError(t('storesSellerStoresIndex.giveTheShopAName'));
      return;
    }
    try {
      if (editing) {
        await rename.mutateAsync({
          sellerId: seller.sellerId,
          storeId: store.id,
          name: name.trim(),
          note: note.trim(),
        });
      } else {
        await create.mutateAsync({
          sellerId: seller.sellerId,
          name: name.trim(),
          note: note.trim(),
        });
      }
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={
        editing
          ? t('storesSellerStoresIndex.renameAStoreFor', { companyName: seller.companyName })
          : t('storesSellerStoresIndex.addAStoreFor', { companyName: seller.companyName })
      }
      description={
        editing
          ? t('storesSellerStoresIndex.ordersAlreadyPlacedKeepThe')
          : t('storesSellerStoresIndex.itNeverBecomesTheDefault')
      }
      icon={<StoreIcon size={18} />}
      locked={busy}
      footer={
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('storesSellerStoresIndex.cancel')}
          </Button>
          <AsyncButton
            state={phaseOf(busy, error)}
            labels={{
              idle: editing
                ? t('storesSellerStoresIndex.save')
                : t('storesSellerStoresIndex.addShop'),
              busy: t('storesSellerStoresIndex.saving'),
              error: t('storesSellerStoresIndex.notSaved'),
            }}
            disabled={busy}
            onClick={() => void save()}
          />
        </DialogFooter>
      }
    >
      <div className="ac-form">
        <TextField
          label={t('storesSellerStoresIndex.name')}
          requiredMark
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          showCount
          autoFocus
        />
        <TextArea
          label={t('storesSellerStoresIndex.note')}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {error !== null && <AcAlert message={error} />}
      </div>
    </Dialog>
  );
}
