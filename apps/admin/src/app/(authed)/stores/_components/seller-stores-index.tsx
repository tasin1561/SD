'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Store as StoreIcon } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  PageHeader,
  Section,
  StatusBadge,
  TBody,
  THead,
  Table,
  TableEmpty,
  Td,
  Textarea,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
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
      // FE-2 — the server's own words. "This is the default store" is a
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
    <div className="space-y-4">
      <PageHeader
        title="Seller stores"
        subtitle="The shopfronts each seller sells under. A store decides which brand an order belongs to — their products, stock, wallet and couriers are shared across all of them."
      />

      {groups.isLoading ? (
        <LoadingState />
      ) : groups.isError || groups.data === undefined ? (
        <ErrorState
          message={groups.error?.message ?? 'Could not load the stores.'}
          retry={() => void groups.refetch()}
        />
      ) : (
        <>
          <Card>
            <CardBody>
              <Input
                className="w-full sm:w-80"
                placeholder="Filter by seller or store name…"
                aria-label="Filter"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
            </CardBody>
          </Card>

          {shown.length === 0 ? (
            <Card>
              <CardBody className="text-text-muted text-sm">No seller matches that.</CardBody>
            </Card>
          ) : (
            shown.map((g) => (
              <Section
                key={g.sellerId}
                title={
                  <Link href={`/sellers/${g.sellerId}`} className="hover:underline">
                    {g.companyName}
                  </Link>
                }
                subtitle={g.email}
                action={
                  canManage ? (
                    <Button variant="secondary" size="sm" onClick={() => setAdding(g)}>
                      <StoreIcon className="size-3.5" /> Add a store
                    </Button>
                  ) : undefined
                }
              >
                <Table>
                  <THead>
                    <Tr>
                      <Th>Store</Th>
                      <Th align="right">Orders</Th>
                      <Th>State</Th>
                      <Th align="right">Actions</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {g.stores.length === 0 ? (
                      // Not a blank. A seller with no store has nowhere
                      // for their orders to be filed, which cannot
                      // happen for a company created after stores
                      // shipped — so seeing it is a finding.
                      <TableEmpty colSpan={4}>
                        No stores. Their orders have nowhere to be filed — add one.
                      </TableEmpty>
                    ) : (
                      g.stores.map((s) => (
                        <Tr key={s.id}>
                          <Td>
                            <div className="font-medium">{s.name}</div>
                            {s.note !== null && (
                              <div className="text-text-muted mt-0.5 text-xs">{s.note}</div>
                            )}
                          </Td>
                          <Td align="right" className="tabular-nums">
                            {s.orderCount}
                          </Td>
                          <Td>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {s.isDefault && <StatusBadge kind="confirmed" label="Default" />}
                              <StatusBadge
                                kind={s.isActive ? 'delivered' : 'cancelled'}
                                label={s.isActive ? 'Open' : 'Closed'}
                              />
                            </div>
                          </Td>
                          <Td align="right">
                            {canManage ? (
                              <div className="flex flex-wrap justify-end gap-1.5">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditing({ seller: g, store: s })}
                                >
                                  Rename
                                </Button>
                                {!s.isDefault && s.isActive && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={makeDefault.isPending}
                                    onClick={() =>
                                      void run(
                                        () =>
                                          makeDefault.mutateAsync({
                                            sellerId: g.sellerId,
                                            storeId: s.id,
                                          }),
                                        `New orders for ${g.companyName} will be filed under “${s.name}”.`,
                                      )
                                    }
                                  >
                                    Make default
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
                                          ? `“${s.name}” is closed.`
                                          : `“${s.name}” is open.`,
                                      )
                                    }
                                  >
                                    {s.isActive ? 'Close' : 'Reopen'}
                                  </Button>
                                )}
                              </div>
                            ) : (
                              <span className="text-text-faint">—</span>
                            )}
                          </Td>
                        </Tr>
                      ))
                    )}
                  </TBody>
                </Table>
              </Section>
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
    </div>
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
      setError('Give the store a name');
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
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={
        editing
          ? `Rename a store for ${seller.companyName}`
          : `Add a store for ${seller.companyName}`
      }
      description={
        editing
          ? 'Orders already placed keep the name they were placed under. This is recorded against the seller as a change WE made.'
          : 'It never becomes the default, so adding one cannot move where their orders are filed. Recorded against the seller as a change WE made.'
      }
    >
      <div className="space-y-4">
        <FormField label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
        </FormField>
        <FormField label="Note">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
        {error !== null && <p className="text-danger text-sm">{error}</p>}
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : editing ? 'Save' : 'Add store'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
