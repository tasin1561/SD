'use client';

import { useState, type ReactElement } from 'react';
import { CircleAlert, PackageCheck, Star, Store as StoreIcon } from 'lucide-react';
import { useSellerIdentity } from '@skydrop/auth/client';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Table, TBody, THead, Td, Th, Tr, TableEmpty } from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter, ConfirmDialog } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
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
import { SetCallout, SetFact, SetPageHeader, phaseOf } from '../../_components/settings-parts';

const CRUMBS = [
  { label: 'Seller console' },
  { label: 'Account' },
  { label: 'Settings', href: '/settings' },
  { label: 'Stores' },
];

/** A store action waiting on its confirmation. */
type PendingStoreAction =
  | { readonly kind: 'default'; readonly store: StoreView }
  | { readonly kind: 'active'; readonly store: StoreView };

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
 *
 * Close, reopen and make-default each ask first, restating the store and
 * what changes, then send exactly the request the row used to send.
 */
export function StoresIndex(): ReactElement {
  const identity = useSellerIdentity();
  const canManage = can(identity, 'profile.manage');
  const stores = useStores();
  const toast = useToast();

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StoreView | null>(null);
  const [pending, setPending] = useState<PendingStoreAction | null>(null);

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

  function confirmPending(): Promise<void> {
    if (pending === null) return Promise.resolve();
    const s = pending.store;
    if (pending.kind === 'default') {
      return run(
        () => makeDefault.mutateAsync({ storeId: s.id }),
        `New orders will be filed under “${s.name}”.`,
      );
    }
    return run(
      () =>
        setActive.mutateAsync({
          storeId: s.id,
          isActive: !s.isActive,
        }),
      s.isActive ? `“${s.name}” is closed.` : `“${s.name}” is open.`,
    );
  }

  const rows = stores.data ?? [];
  const open = rows.filter((s) => s.isActive);
  const defaultStore = rows.find((s) => s.isDefault);
  const totalOrders = rows.reduce((sum, s) => sum + s.orderCount, 0);

  const confirmCopy =
    pending === null
      ? null
      : pending.kind === 'default'
        ? {
            title: 'Make this the default store?',
            consequence: `New orders — including every CSV row that names no store — will be filed under “${pending.store.name}”${defaultStore === undefined ? '' : ` instead of “${defaultStore.name}”`}. Orders already placed stay where they are.`,
            confirm: 'Make default',
            destructive: false,
          }
        : pending.store.isActive
          ? {
              title: 'Close this store?',
              consequence: `New orders stop being filed under “${pending.store.name}”. The ${pending.store.orderCount} ${pending.store.orderCount === 1 ? 'order' : 'orders'} already there are untouched, and you can reopen it later.`,
              confirm: 'Close store',
              destructive: true,
            }
          : {
              title: 'Reopen this store?',
              consequence: `New orders can be filed under “${pending.store.name}” again. It does not become the default.`,
              confirm: 'Reopen store',
              destructive: false,
            };

  return (
    <div className="set-page">
      <SetPageHeader
        crumbs={CRUMBS}
        title="Stores"
        subtitle="The shopfronts you sell under. A store decides which brand an order belongs to — your products, stock, wallet and couriers are shared across all of them."
        meta={
          stores.data === undefined ? undefined : (
            <span className="set-meta">
              <SetFact tone="accent">
                {rows.length} {rows.length === 1 ? 'store' : 'stores'}
              </SetFact>
              <SetFact tone={open.length === 0 ? 'warn' : 'good'} dot>
                {open.length} open
              </SetFact>
              {defaultStore !== undefined && <SetFact>Default · {defaultStore.name}</SetFact>}
            </span>
          )
        }
        action={
          canManage ? (
            <Button size="md" icon={<StoreIcon size={15} />} onClick={() => setAdding(true)}>
              Add a store
            </Button>
          ) : undefined
        }
      />

      {stores.isLoading ? (
        <div className="set-card" data-flush>
          <SkeletonRows rows={3} cols={4} label="Loading your stores…" />
        </div>
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
          <div className="set-kpis">
            <KpiCard
              label="Shopfronts"
              icon={<StoreIcon size={14} />}
              value={rows.length}
              format={String}
              unit={rows.length === 1 ? 'store' : 'stores'}
              tone="neutral"
              hint={`${open.length} open, ${rows.length - open.length} closed.`}
            />
            <KpiCard
              label="Filed under a store"
              icon={<PackageCheck size={14} />}
              value={totalOrders}
              format={String}
              unit={totalOrders === 1 ? 'order' : 'orders'}
              tone="neutral"
              hint="Every order you have placed, across all of them."
            />
            <KpiCard
              label="New orders go to"
              icon={<Star size={14} />}
              figure={
                defaultStore === undefined ? (
                  <span className="set-kpi-text set-kpi-faint">None set</span>
                ) : (
                  <span className="set-kpi-text">{defaultStore.name}</span>
                )
              }
              tone={defaultStore === undefined ? 'pending' : 'neutral'}
              hint="Including every CSV row that names no store."
            />
          </div>

          <section className="set-section">
            <SectionHeading
              title="Your shopfronts"
              note={`${rows.length} ${rows.length === 1 ? 'store' : 'stores'}`}
            />
            <div className="set-card" data-flush>
              <p className="set-card__lead">
                New orders are filed under the <strong className="set-strong">default</strong> store
                unless you pick another — including every row of a CSV upload that names no store.
                Closing a store stops new orders being filed under it; the orders already there are
                untouched.
              </p>
              <Table caption="Your stores">
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
                          <span className="set-cell-strong">{s.name}</span>
                          {s.note !== null && <span className="set-cell-sub">{s.note}</span>}
                        </Td>
                        <Td align="right" className="sk-figure">
                          {/* Shown because it is what makes closing one a
                              decision rather than a tidy-up. */}
                          {s.orderCount}
                        </Td>
                        <Td>
                          <span className="set-chips">
                            {s.isDefault && (
                              <StatusChip kind="confirmed" label="Default" size="sm" />
                            )}
                            <StatusChip
                              kind={s.isActive ? 'delivered' : 'cancelled'}
                              label={s.isActive ? 'Open' : 'Closed'}
                              size="sm"
                            />
                          </span>
                        </Td>
                        <Td align="right">
                          {canManage ? (
                            <div className="set-row-actions">
                              <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                                Rename
                              </Button>
                              {!s.isDefault && s.isActive && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={makeDefault.isPending}
                                  onClick={() => setPending({ kind: 'default', store: s })}
                                >
                                  Make default
                                </Button>
                              )}
                              {!s.isDefault && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={setActive.isPending}
                                  onClick={() => setPending({ kind: 'active', store: s })}
                                >
                                  {s.isActive ? 'Close' : 'Reopen'}
                                </Button>
                              )}
                            </div>
                          ) : (
                            <span className="set-faint">—</span>
                          )}
                        </Td>
                      </Tr>
                    ))
                  )}
                </TBody>
              </Table>
            </div>
          </section>
        </>
      )}

      {adding && <StoreModal onClose={() => setAdding(false)} />}
      {editing !== null && <StoreModal store={editing} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) setPending(null);
        }}
        title={confirmCopy?.title ?? ''}
        entity={pending?.store.name ?? ''}
        consequence={confirmCopy?.consequence ?? ''}
        confirmLabel={confirmCopy?.confirm ?? 'Confirm'}
        destructive={confirmCopy?.destructive ?? false}
        onConfirm={confirmPending}
      />
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
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      icon={<StoreIcon size={18} />}
      title={editing ? 'Rename this store' : 'Add a store'}
      description={
        editing
          ? 'Orders already placed keep the name they were placed under — renaming will not rewrite what a past customer was told.'
          : 'A new store never becomes the default, so adding one cannot move where your orders are filed. Make it the default afterwards if that is what you want.'
      }
      footer={
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <AsyncButton
            labels={{
              idle: editing ? 'Save' : 'Add store',
              busy: 'Saving…',
              error: 'Not saved',
            }}
            state={phaseOf(busy, error)}
            disabled={busy}
            onClick={() => void save()}
          />
        </DialogFooter>
      }
    >
      <div className="set-form-grid">
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          showCount
          autoFocus
          requiredMark
        />
        <TextArea
          label="Note"
          hint="A reminder to yourself about which channel this is"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {error !== null && (
          <SetCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
            <p>{error}</p>
          </SetCallout>
        )}
      </div>
    </Dialog>
  );
}
