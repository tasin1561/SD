'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { PackageCheck, Star, Store as StoreIcon } from 'lucide-react';
import { useSellerIdentity } from '@skydrop/auth/client';
import {
  BandBody,
  Button,
  Crumbs,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  MetaChip,
  Modal,
  ModalFooter,
  PageHeader,
  SectionBand,
  Stat,
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
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useCreateStore,
  useMakeStoreDefault,
  useSetStoreActive,
  useStores,
  useUpdateStore,
  type StoreView,
} from '@/lib/store-hooks';

const CRUMBS = [
  { label: 'Seller console' },
  { label: 'Account' },
  { label: 'Settings', href: '/settings' },
  { label: 'Stores' },
];

/**
 * Your shopfronts.
 *
 * ── WHAT A STORE CHANGES, AND WHAT IT DOES NOT ───────────────────────
 * It decides which brand an ORDER was placed under, and nothing else.
 * Products, stock, your wallet and your courier accounts are shared —
 * the goods are the same goods on the same shelf, and splitting them
 * per store would leave one brand unable to sell while another has
 * stock sitting idle.
 *
 * Said plainly on the page, because "store" is a word that invites the
 * opposite assumption.
 */
export function StoresIndex(): ReactElement {
  const identity = useSellerIdentity();
  const canManage = can(identity, 'profile.manage');
  const stores = useStores();
  const toast = useToast();

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StoreView | null>(null);

  const makeDefault = useMakeStoreDefault();
  const setActive = useSetStoreActive();

  async function run(fn: () => Promise<unknown>, done: string): Promise<void> {
    try {
      await fn();
      toast.success(done);
    } catch (err) {
      // FE-2: the server's verdict, verbatim. It is the half that knows
      // why — "this is the default store" is a sentence the UI must not
      // try to guess at.
      toast.error(serverVerdict(err));
    }
  }

  const rows = stores.data ?? [];
  const open = rows.filter((s) => s.isActive);
  const defaultStore = rows.find((s) => s.isDefault);
  const totalOrders = rows.reduce((sum, s) => sum + s.orderCount, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={<Crumbs items={CRUMBS} Link={Link} />}
        title="Stores"
        subtitle="The shopfronts you sell under. A store decides which brand an order belongs to — your products, stock, wallet and couriers are shared across all of them."
        meta={
          stores.data === undefined ? undefined : (
            <>
              <MetaChip tone="accent">
                {rows.length} {rows.length === 1 ? 'store' : 'stores'}
              </MetaChip>
              <MetaChip tone={open.length === 0 ? 'warn' : 'good'} dot>
                {open.length} open
              </MetaChip>
              {defaultStore !== undefined && <MetaChip>Default · {defaultStore.name}</MetaChip>}
            </>
          )
        }
        action={
          canManage ? (
            <Button size="md" onClick={() => setAdding(true)}>
              <StoreIcon size={14} aria-hidden /> Add a store
            </Button>
          ) : undefined
        }
      />

      {stores.isLoading ? (
        <LoadingState label="Loading your stores…" />
      ) : stores.isError || stores.data === undefined ? (
        <ErrorState
          message={stores.error?.message ?? 'Could not load your stores.'}
          retry={() => void stores.refetch()}
        />
      ) : (
        <>
          {/* ── The shopfronts at a glance ───────────────────────────
                Three standing facts, all read off the same list below.
                The comps put a per-store conversion rate and a channel
                mix here; neither exists — `orderCount` is what the API
                returns, so it is what these say. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat
              label="Shopfronts"
              icon={<StoreIcon size={13} aria-hidden />}
              value={rows.length}
              unit={rows.length === 1 ? 'store' : 'stores'}
              tone="neutral"
              hint={`${open.length} open, ${rows.length - open.length} closed.`}
            />
            <Stat
              label="Filed under a store"
              icon={<PackageCheck size={13} aria-hidden />}
              value={totalOrders}
              unit={totalOrders === 1 ? 'order' : 'orders'}
              tone="neutral"
              hint="Every order you have placed, across all of them."
            />
            <Stat
              label="New orders go to"
              icon={<Star size={13} aria-hidden />}
              value={
                defaultStore === undefined ? (
                  <span className="text-text-faint text-base">None set</span>
                ) : (
                  <span className="text-base">{defaultStore.name}</span>
                )
              }
              tone={defaultStore === undefined ? 'warn' : 'neutral'}
              hint="Including every CSV row that names no store."
            />
          </div>

          <div>
            <SectionBand
              index="01"
              title="Shopfront register"
              note={`${rows.length} ${rows.length === 1 ? 'store' : 'stores'}`}
            />
            <BandBody flush>
              <p className="border-border text-text-muted border-b px-3 py-2.5 text-xs leading-relaxed">
                New orders are filed under the <strong className="text-text-body">default</strong>{' '}
                store unless you pick another — including every row of a CSV upload that names no
                store. Closing a store stops new orders being filed under it; the orders already
                there are untouched.
              </p>
              <Table wrapperClassName="rounded-none border-0 bg-transparent">
                <THead>
                  <Tr>
                    <Th>Store</Th>
                    <Th align="right">Orders</Th>
                    <Th>State</Th>
                    <Th align="right">Actions</Th>
                  </Tr>
                </THead>
                <TBody>
                  {rows.length === 0 ? (
                    <TableEmpty colSpan={4}>No stores yet.</TableEmpty>
                  ) : (
                    rows.map((s) => (
                      <Tr key={s.id}>
                        <Td>
                          <div className="text-text-bright font-medium">{s.name}</div>
                          {s.note !== null && (
                            <div className="text-text-faint mt-0.5 text-xs">{s.note}</div>
                          )}
                        </Td>
                        <Td align="right" className="tabular-nums">
                          {/* Shown because it is what makes closing one a
                              decision rather than a tidy-up. */}
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
                              <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                                Rename
                              </Button>
                              {!s.isDefault && s.isActive && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={makeDefault.isPending}
                                  onClick={() =>
                                    void run(
                                      () => makeDefault.mutateAsync({ storeId: s.id }),
                                      `New orders will be filed under “${s.name}”.`,
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
            </BandBody>
          </div>
        </>
      )}

      {adding && <StoreModal onClose={() => setAdding(false)} />}
      {editing !== null && <StoreModal store={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function StoreModal({
  store,
  onClose,
}: {
  readonly store?: StoreView;
  readonly onClose: () => void;
}): ReactElement {
  const create = useCreateStore();
  const update = useUpdateStore();
  const [name, setName] = useState(store?.name ?? '');
  const [note, setNote] = useState(store?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const editing = store !== undefined;
  const busy = create.isPending || update.isPending;

  async function save(): Promise<void> {
    setError(null);
    if (name.trim() === '') {
      setError('Give the store a name');
      return;
    }
    try {
      if (editing) {
        await update.mutateAsync({ storeId: store.id, name: name.trim(), note: note.trim() });
      } else {
        await create.mutateAsync({ name: name.trim(), note: note.trim() });
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
      title={editing ? 'Rename this store' : 'Add a store'}
      description={
        editing
          ? 'Orders already placed keep the name they were placed under — renaming will not rewrite what a past customer was told.'
          : 'A new store never becomes the default, so adding one cannot move where your orders are filed. Make it the default afterwards if that is what you want.'
      }
    >
      <div className="space-y-4">
        <FormField label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
        </FormField>
        <FormField label="Note" hint="A reminder to yourself about which channel this is">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
        {error !== null && (
          <p className="text-critical bg-[var(--color-critical-tint)] border-[var(--color-critical-ring)] rounded-[var(--radius-2)] border px-3 py-2 text-xs">
            {error}
          </p>
        )}
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
