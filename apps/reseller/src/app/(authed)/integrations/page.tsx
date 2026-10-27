'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import {
  CircleAlert,
  Clock,
  FileText,
  KeyRound,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
} from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { TBody, THead, Table, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Select } from '@skydrop/ui/app/select';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Switch } from '@skydrop/ui/app/switch';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import type { MessageKey } from '@/i18n/catalog';
import { useLocale, useT } from '@/i18n/client';
import { formatDateTime } from '@/i18n/format';
import { verdict } from '@/i18n/verdict';
import {
  useCreateStoreApiKey,
  useCreateStoreWebhook,
  useDeleteStoreWebhook,
  useRevokeStoreApiKey,
  useRotateStoreWebhook,
  useStoreApiKeys,
  useStoreWebhooks,
  useUpdateStoreWebhook,
  type StoreWebhook,
} from '@/lib/order-hooks';
import {
  RdCallout,
  RdCard,
  RdOneTimeSecret,
  RdSection,
  phaseOf,
} from '../settings/_components/rd-parts';
import { DEFAULT_EVENTS, EditWebhookModal, EventPicker } from './_components/webhook-form';

/** Choices for how long a new key works. `''` = until revoked. */
const EXPIRY_CHOICES: ReadonlyArray<{ value: string; label: MessageKey }> = [
  { value: '', label: 'intg.expiry.never' },
  { value: '30', label: 'intg.expiry.30' },
  { value: '90', label: 'intg.expiry.90' },
  { value: '180', label: 'intg.expiry.180' },
  { value: '365', label: 'intg.expiry.365' },
  { value: '730', label: 'intg.expiry.730' },
];

/**
 * RS-5 — connect the store's own systems: API keys that place and read
 * this store's orders (`/store-api/v1/orders`), and webhooks that tell
 * those systems when an order moves. Both reach THIS store only, never
 * the seller's account.
 */
export default function IntegrationsPage(): ReactElement {
  const t = useT();
  return (
    <div className="rd-page">
      <PageHeader title={t('intg.title')} subtitle={t('intg.subtitle')} />
      <ApiKeysSection />
      <WebhooksSection />
    </div>
  );
}

function ApiKeysSection(): ReactElement {
  const t = useT();
  const locale = useLocale();
  const when = (iso: string | null): string =>
    iso === null ? t('intg.never') : formatDateTime(iso, locale);
  const keys = useStoreApiKeys();
  const create = useCreateStoreApiKey();
  const revoke = useRevokeStoreApiKey();
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [shown, setShown] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  // What the confirmation restates, fixed when it opens.
  const [asked, setAsked] = useState({ name: '', works: '' });
  const [error, setError] = useState<string | null>(null);
  const expiryChoice = EXPIRY_CHOICES.find((c) => c.value === expiry);
  const expiryLabel = expiryChoice === undefined ? '' : t(expiryChoice.label);

  // The form submit only ASKS; the key is made from the confirmation.
  function add(e: FormEvent): void {
    e.preventDefault();
    setError(null);
    setAsked({
      name: name.trim(),
      works: expiry === '' ? t('intg.works.forever') : t('intg.works.for', { label: expiryLabel }),
    });
    setCreating(true);
  }

  async function createKey(): Promise<void> {
    try {
      const created = await create.mutateAsync({
        name: name.trim(),
        ...(expiry === '' ? {} : { expiresInDays: Number(expiry) }),
      });
      setShown(created.plaintext);
      setName('');
    } catch (err) {
      setError(verdict(err, t));
    }
  }

  return (
    <RdSection title={t('intg.keys.title')} note={t('intg.keys.note')}>
      <RdCard>
        <form onSubmit={add} className="rd-form-grid" data-cols="key">
          <TextField
            id="key-name"
            label={t('intg.keys.name')}
            icon={<Tag size={15} />}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('intg.keys.namePlaceholder')}
            maxLength={80}
            showCount
          />
          <Select
            id="key-expiry"
            label={t('intg.keys.worksFor')}
            icon={<Clock size={15} />}
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
          >
            {EXPIRY_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {t(c.label)}
              </option>
            ))}
          </Select>
          <AsyncButton
            type="submit"
            variant="primary"
            size="md"
            icon={<KeyRound size={15} />}
            labels={{
              idle: t('intg.keys.create'),
              busy: t('intg.keys.creating'),
              error: t('intg.keys.notCreated'),
            }}
            state={phaseOf(create.isPending, create.isError ? error : null)}
            disabled={create.isPending || name.trim() === ''}
          />
        </form>
        {shown !== null ? <RdOneTimeSecret label={t('intg.keys.newKey')} value={shown} /> : null}
        {error !== null ? (
          <RdCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
            <p>{error}</p>
          </RdCallout>
        ) : null}
      </RdCard>
      {keys.isPending ? (
        <SkeletonRows label={t('intg.keys.loading')} rows={2} cols={6} />
      ) : keys.isError ? (
        <ErrorState message={verdict(keys.error, t)} retry={() => void keys.refetch()} />
      ) : keys.data.length === 0 ? (
        <EmptyState title={t('intg.keys.none')} description={t('intg.keys.noneBody')} />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>{t('intg.keys.col.name')}</Th>
              <Th>{t('intg.keys.col.key')}</Th>
              <Th>{t('intg.keys.col.lastUsed')}</Th>
              <Th>{t('intg.keys.col.expires')}</Th>
              <Th>{t('intg.keys.col.state')}</Th>
              <Th align="right">
                <span className="rd-sr">{t('intg.keys.col.actions')}</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {keys.data.map((k) => {
              const expired = k.expiresAt !== null && new Date(k.expiresAt).getTime() < Date.now();
              return (
                <Tr key={k.id}>
                  <Td>
                    <span className="rd-cell-strong">{k.name}</span>
                  </Td>
                  <Td className="rd-cell-ident sk-ident">{k.keyPrefix}…</Td>
                  <Td className="rd-cell-muted">{when(k.lastUsedAt)}</Td>
                  <Td className="rd-cell-muted">
                    {k.expiresAt === null ? t('intg.neverCap') : when(k.expiresAt)}
                  </Td>
                  <Td>
                    {k.revokedAt !== null ? (
                      <>
                        <StatusChip kind="cancelled" size="sm" label={t('intg.keys.revoked')} />{' '}
                        <span className="rd-cell-sub">{when(k.revokedAt)}</span>
                      </>
                    ) : expired ? (
                      <StatusChip kind="failed" size="sm" label={t('intg.keys.expired')} />
                    ) : (
                      <StatusChip kind="delivered" size="sm" label={t('intg.keys.live')} />
                    )}
                  </Td>
                  <Td align="right">
                    {k.revokedAt === null ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 size={14} />}
                        onClick={() => {
                          setRevoking({ id: k.id, name: k.name });
                          setRevokeOpen(true);
                        }}
                      >
                        {t('intg.keys.revoke')}
                      </Button>
                    ) : null}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
      <ConfirmDialog
        open={creating}
        onOpenChange={setCreating}
        title={t('intg.keys.confirmTitle')}
        entity={asked.name}
        consequence={t('intg.keys.confirmBody', { works: asked.works })}
        confirmLabel={t('intg.keys.create')}
        onConfirm={async () => {
          await createKey();
          setCreating(false);
        }}
      />
      <ConfirmDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title={t('intg.keys.revokeTitle', { name: revoking?.name ?? '' })}
        entity={revoking?.name ?? ''}
        consequence={t('intg.keys.revokeBody')}
        confirmLabel={t('intg.keys.revoke')}
        destructive
        onConfirm={async () => {
          if (revoking === null) return;
          try {
            await revoke.mutateAsync({ id: revoking.id });
          } catch (err) {
            setError(verdict(err, t));
          }
          setRevokeOpen(false);
        }}
      />
    </RdSection>
  );
}

function WebhooksSection(): ReactElement {
  const t = useT();
  const locale = useLocale();
  const when = (iso: string | null): string =>
    iso === null ? t('intg.never') : formatDateTime(iso, locale);
  const toast = useToast();
  const hooks = useStoreWebhooks();
  const create = useCreateStoreWebhook();
  const update = useUpdateStoreWebhook();
  const rotate = useRotateStoreWebhook();
  const remove = useDeleteStoreWebhook();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<string[]>([...DEFAULT_EVENTS]);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StoreWebhook | null>(null);
  // Each confirmation keeps the endpoint it names after closing, so its
  // words do not blank while it animates out; `open` is separate.
  const [rotating, setRotating] = useState<StoreWebhook | null>(null);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [removing, setRemoving] = useState<StoreWebhook | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [switching, setSwitching] = useState<{ hook: StoreWebhook; next: boolean } | null>(null);
  const [switchOpen, setSwitchOpen] = useState(false);

  async function add(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      const created = await create.mutateAsync({
        url: url.trim(),
        ...(name.trim() === '' ? {} : { name: name.trim() }),
        ...(description.trim() === '' ? {} : { description: description.trim() }),
        subscribedEvents: events,
      });
      setSecret(created.secretKey);
      setUrl('');
      setName('');
      setDescription('');
    } catch (err) {
      setError(verdict(err, t));
    }
  }

  // The switch only ASKS; the change is sent from the confirmation.
  function toggle(h: StoreWebhook, next: boolean): void {
    setSwitching({ hook: h, next });
    setSwitchOpen(true);
  }

  async function applyToggle(h: StoreWebhook, next: boolean): Promise<void> {
    setError(null);
    try {
      await update.mutateAsync({ id: h.id, isActive: next });
      toast.success(next ? t('intg.hooks.toastOn') : t('intg.hooks.toastOff'));
    } catch (err) {
      setError(verdict(err, t));
    }
  }

  const label = (h: StoreWebhook): string => h.name ?? h.url;

  return (
    <RdSection title={t('intg.hooks.title')} note={t('intg.hooks.note')}>
      <RdCard>
        <form onSubmit={(e) => void add(e)} className="rd-form">
          <div className="rd-form-grid" data-cols="2">
            <TextField
              id="wh-url"
              label={t('intg.hooks.url')}
              icon={<Link2 size={15} />}
              requiredMark
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/skydrop"
              inputMode="url"
              inputClassName="sk-ident"
            />
            <TextField
              id="wh-name"
              label={t('intg.hooks.name')}
              icon={<Tag size={15} />}
              value={name}
              maxLength={160}
              showCount
              onChange={(e) => setName(e.target.value)}
              placeholder={t('intg.hooks.namePlaceholder')}
            />
          </div>
          <TextArea
            id="wh-description"
            label={t('intg.hooks.description')}
            icon={<FileText size={15} />}
            value={description}
            maxLength={2000}
            showCount
            onChange={(e) => setDescription(e.target.value)}
          />
          <EventPicker value={events} onChange={setEvents} />
          <div className="rd-buttons" data-align="start">
            <AsyncButton
              type="submit"
              variant="primary"
              size="md"
              icon={<Plus size={15} />}
              labels={{
                idle: t('intg.hooks.add'),
                busy: t('intg.hooks.adding'),
                error: t('intg.hooks.notAdded'),
              }}
              state={phaseOf(create.isPending, create.isError ? error : null)}
              disabled={create.isPending || url.trim() === '' || events.length === 0}
            />
          </div>
        </form>
        {secret !== null ? <RdOneTimeSecret label={t('intg.hooks.secret')} value={secret} /> : null}
        {error !== null ? (
          <RdCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
            <p>{error}</p>
          </RdCallout>
        ) : null}
      </RdCard>
      {hooks.isPending ? (
        <SkeletonRows label={t('intg.hooks.loading')} rows={2} cols={5} />
      ) : hooks.isError ? (
        <ErrorState message={verdict(hooks.error, t)} retry={() => void hooks.refetch()} />
      ) : hooks.data.length === 0 ? (
        <EmptyState title={t('intg.hooks.none')} description={t('intg.hooks.noneBody')} />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>{t('intg.hooks.col.endpoint')}</Th>
              <Th>{t('intg.hooks.col.events')}</Th>
              <Th>{t('intg.hooks.col.lastDelivered')}</Th>
              <Th>{t('intg.hooks.col.on')}</Th>
              <Th align="right">
                <span className="rd-sr">{t('intg.keys.col.actions')}</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {hooks.data.map((h) => (
              <Tr key={h.id}>
                <Td>
                  {h.name !== null && h.name !== '' ? (
                    <span className="rd-cell-strong">{h.name}</span>
                  ) : null}
                  <span className="rd-cell-sub rd-cell-ident sk-ident">{h.url}</span>
                </Td>
                <Td className="rd-cell-ident sk-ident sk-ident--wrap">
                  {h.subscribedEvents.join(', ')}
                </Td>
                <Td className="rd-cell-muted">
                  {h.autoDisabledAt !== null ? (
                    <span className="rd-cell-warn">
                      {t('intg.hooks.autoOff', {
                        reason:
                          h.autoDisabledReason !== null
                            ? t('intg.hooks.autoOffReason', { reason: h.autoDisabledReason })
                            : '',
                      })}
                    </span>
                  ) : (
                    when(h.lastSuccessAt)
                  )}
                </Td>
                <Td>
                  <Switch
                    checked={h.isActive && h.autoDisabledAt === null}
                    onCheckedChange={(next) => toggle(h, next)}
                    aria-label={t('intg.hooks.deliverAria', { target: h.name ?? h.url })}
                    disabled={update.isPending}
                  />
                </Td>
                <Td align="right">
                  <div className="rd-row-actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Pencil size={14} />}
                      onClick={() => setEditing(h)}
                    >
                      {t('intg.hooks.edit')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<RefreshCw size={14} />}
                      onClick={() => {
                        setRotating(h);
                        setRotateOpen(true);
                      }}
                    >
                      {t('intg.hooks.newSecret')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 size={14} />}
                      onClick={() => {
                        setRemoving(h);
                        setRemoveOpen(true);
                      }}
                    >
                      {t('intg.hooks.remove')}
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      {editing !== null ? (
        <EditWebhookModal webhook={editing} onClose={() => setEditing(null)} />
      ) : null}
      <ConfirmDialog
        open={switchOpen}
        onOpenChange={setSwitchOpen}
        title={
          switching?.next === true ? t('intg.hooks.switchOnTitle') : t('intg.hooks.switchOffTitle')
        }
        entity={switching === null ? '' : label(switching.hook)}
        entityIsIdentifier={switching !== null && switching.hook.name === null}
        consequence={
          switching?.next === true
            ? t('intg.hooks.switchOnBody', { url: switching.hook.url })
            : t('intg.hooks.switchOffBody', { url: switching?.hook.url ?? '' })
        }
        confirmLabel={
          switching?.next === true ? t('intg.hooks.switchOn') : t('intg.hooks.switchOff')
        }
        destructive={switching?.next === false}
        onConfirm={async () => {
          if (switching === null) return;
          await applyToggle(switching.hook, switching.next);
          setSwitchOpen(false);
        }}
      />
      <ConfirmDialog
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        title={t('intg.hooks.rotateTitle')}
        entity={rotating === null ? '' : label(rotating)}
        entityIsIdentifier={rotating !== null && rotating.name === null}
        consequence={t('intg.hooks.rotateBody')}
        confirmLabel={t('intg.hooks.rotateConfirm')}
        onConfirm={async () => {
          if (rotating === null) return;
          setError(null);
          try {
            const r = await rotate.mutateAsync({ id: rotating.id });
            setSecret(r.secretKey);
          } catch (err) {
            setError(verdict(err, t));
          }
          setRotateOpen(false);
        }}
      />
      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={t('intg.hooks.removeTitle')}
        entity={removing === null ? '' : label(removing)}
        entityIsIdentifier={removing !== null && removing.name === null}
        consequence={t('intg.hooks.removeBody', { url: removing?.url ?? '' })}
        confirmLabel={t('intg.hooks.remove')}
        destructive
        onConfirm={async () => {
          if (removing === null) return;
          setError(null);
          try {
            await remove.mutateAsync({ id: removing.id });
          } catch (err) {
            setError(verdict(err, t));
          }
          setRemoveOpen(false);
        }}
      />
    </RdSection>
  );
}
