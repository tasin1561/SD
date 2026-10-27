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
import { verdict } from '@/i18n/verdict';
import {
  useCreateStore,
  useMakeStoreDefault,
  useSetStoreActive,
  useStores,
  useUpdateStore,
  type StoreView,
} from '@/lib/store-hooks';
import { SetCallout, SetFact, SetPageHeader, phaseOf } from '../../_components/settings-parts';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

const crumbsOf = (t: Translate<MessageKey>) => [
  { label: t('settingsStores.clientConsole') },
  { label: t('settingsStores.account') },
  { label: t('settingsStores.settings'), href: '/settings' },
  { label: t('settingsStores.stores') },
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
  const t = useT();
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
      toast.error(verdict(err, t));
    }
  }

  function confirmPending(): Promise<void> {
    if (pending === null) return Promise.resolve();
    const s = pending.store;
    if (pending.kind === 'default') {
      return run(
        () => makeDefault.mutateAsync({ storeId: s.id }),
        t('settingsStores.filedUnder', { name: s.name }),
      );
    }
    return run(
      () =>
        setActive.mutateAsync({
          storeId: s.id,
          isActive: !s.isActive,
        }),
      s.isActive
        ? t('settingsStores.isClosed', { name: s.name })
        : t('settingsStores.isOpen', { name: s.name }),
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
            title: t('settingsStores.makeThisTheDefault'),
            consequence:
              defaultStore === undefined
                ? t('settingsStores.makeDefaultConsequence', { name: pending.store.name })
                : t('settingsStores.makeDefaultConsequenceInstead', {
                    name: pending.store.name,
                    old: defaultStore.name,
                  }),
            confirm: t('settingsStores.makeDefault'),
            destructive: false,
          }
        : pending.store.isActive
          ? {
              title: t('settingsStores.closeThisStore'),
              consequence: t(
                pending.store.orderCount === 1
                  ? 'settingsStores.closeConsequenceOne'
                  : 'settingsStores.closeConsequenceMany',
                { name: pending.store.name, count: pending.store.orderCount },
              ),
              confirm: t('settingsStores.closeStore'),
              destructive: true,
            }
          : {
              title: t('settingsStores.reopenThisStore'),
              consequence: t('settingsStores.newOrdersCanBe', { store: pending.store.name }),
              confirm: t('settingsStores.reopenStore'),
              destructive: false,
            };

  return (
    <div className="set-page">
      <SetPageHeader
        crumbs={crumbsOf(t)}
        title={t('settingsStores.stores')}
        subtitle={t('settingsStores.theShopsYouSell')}
        meta={
          stores.data === undefined ? undefined : (
            <span className="set-meta">
              <SetFact tone="accent">
                {rows.length} {rows.length === 1 ? 'store' : 'stores'}
              </SetFact>
              <SetFact tone={open.length === 0 ? 'warn' : 'good'} dot>
                {open.length} open
              </SetFact>
              {defaultStore !== undefined && (
                <SetFact>
                  {richMessage(t('settingsStores.default'), { defaultStore: defaultStore.name })}
                </SetFact>
              )}
            </span>
          )
        }
        action={
          canManage ? (
            <Button size="md" icon={<StoreIcon size={15} />} onClick={() => setAdding(true)}>
              {t('settingsStores.addAStore')}
            </Button>
          ) : undefined
        }
      />

      {stores.isLoading ? (
        <div className="set-card" data-flush>
          <SkeletonRows rows={3} cols={4} label={t('settingsStores.loadingYourStores')} />
        </div>
      ) : stores.isError || stores.data === undefined ? (
        <ErrorState
          message={stores.error?.message ?? t('settingsStores.couldNotLoadYour')}
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
              label={t('settingsStores.shops')}
              icon={<StoreIcon size={14} />}
              value={rows.length}
              format={String}
              unit={rows.length === 1 ? 'store' : 'stores'}
              tone="neutral"
              hint={t('settingsStores.openClosed', {
                open: open.length,
                open2: rows.length - open.length,
              })}
            />
            <KpiCard
              label={t('settingsStores.filedUnderAStore')}
              icon={<PackageCheck size={14} />}
              value={totalOrders}
              format={String}
              unit={totalOrders === 1 ? 'order' : 'orders'}
              tone="neutral"
              hint={t('settingsStores.everyOrderYouHave')}
            />
            <KpiCard
              label={t('settingsStores.newOrdersGoTo')}
              icon={<Star size={14} />}
              figure={
                defaultStore === undefined ? (
                  <span className="set-kpi-text set-kpi-faint">{t('settingsStores.noneSet')}</span>
                ) : (
                  <span className="set-kpi-text">{defaultStore.name}</span>
                )
              }
              tone={defaultStore === undefined ? 'pending' : 'neutral'}
              hint={t('settingsStores.includingEveryCsvRow')}
            />
          </div>

          <section className="set-section">
            <SectionHeading
              title={t('settingsStores.yourShops')}
              note={`${rows.length} ${rows.length === 1 ? 'store' : 'stores'}`}
            />
            <div className="set-card" data-flush>
              <p className="set-card__lead">
                {richMessage(t('settingsStores.newOrdersAreFiled'), {
                  strong: <strong className="set-strong">default</strong>,
                })}
              </p>
              <Table caption={t('settingsStores.yourStores')}>
                <THead>
                  <Tr>
                    <Th>{t('settingsStores.store')}</Th>
                    <Th align="right">{t('settingsStores.orders')}</Th>
                    <Th>{t('settingsStores.state')}</Th>
                    <Th align="right">{t('settingsStores.actions')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {rows.length === 0 ? (
                    <TableEmpty colSpan={4}>{t('settingsStores.noStoresYet')}</TableEmpty>
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
                              <StatusChip
                                kind="confirmed"
                                label={t('settingsStores.default2')}
                                size="sm"
                              />
                            )}
                            <StatusChip
                              kind={s.isActive ? 'delivered' : 'cancelled'}
                              label={
                                s.isActive ? t('settingsStores.open') : t('settingsStores.closed')
                              }
                              size="sm"
                            />
                          </span>
                        </Td>
                        <Td align="right">
                          {canManage ? (
                            <div className="set-row-actions">
                              <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                                {t('settingsStores.rename')}
                              </Button>
                              {!s.isDefault && s.isActive && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={makeDefault.isPending}
                                  onClick={() => setPending({ kind: 'default', store: s })}
                                >
                                  {t('settingsStores.makeDefault')}
                                </Button>
                              )}
                              {!s.isDefault && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={setActive.isPending}
                                  onClick={() => setPending({ kind: 'active', store: s })}
                                >
                                  {s.isActive
                                    ? t('settingsStores.close')
                                    : t('settingsStores.reopen')}
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
        confirmLabel={confirmCopy?.confirm ?? t('settingsStores.confirm')}
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
  const t = useT();
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
      setError(t('settingsStores.giveTheStoreA'));
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
      setError(verdict(err, t));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      icon={<StoreIcon size={18} />}
      title={editing ? t('settingsStores.renameThisStore') : t('settingsStores.addAStore')}
      description={
        editing ? t('settingsStores.ordersAlreadyPlacedKeep') : t('settingsStores.aNewStoreNever')
      }
      footer={
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('settingsStores.cancel')}
          </Button>
          <AsyncButton
            labels={{
              idle: editing ? t('settingsStores.save') : t('settingsStores.addStore'),
              busy: t('settingsStores.saving'),
              error: t('settingsStores.notSaved'),
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
          label={t('settingsStores.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          showCount
          autoFocus
          requiredMark
        />
        <TextArea
          label={t('settingsStores.note')}
          hint={t('settingsStores.aReminderToYourself')}
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
