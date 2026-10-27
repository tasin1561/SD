'use client';

import { useState, type ReactElement } from 'react';
import { CircleAlert, KeyRound, Pencil, Plus, Trash2, Webhook } from 'lucide-react';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { Switch } from '@skydrop/ui/app/switch';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import type { WebhookEndpointView, WebhookEndpointWithSecret } from '@skydrop/api-client';
import {
  useDeleteWebhookEndpoint,
  useRotateWebhookSecret,
  useUpdateWebhookEndpoint,
  useWebhookEndpointsList,
} from '@/lib/api-hooks';
import { WebhookFormModal } from './webhook-form-modal';
import { SecretRevealCard } from './secret-reveal-card';
import { verdict } from '@/i18n/verdict';
import { SetCallout, SetFact, SetPageHeader } from '../../_components/settings-parts';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

const crumbsOf = (t: Translate<MessageKey>) => [
  { label: t('settingsWebhooks.clientConsole') },
  { label: t('settingsWebhooks.account') },
  { label: t('settingsWebhooks.settings'), href: '/settings' },
  { label: t('settingsWebhooks.webhooks') },
];

/**
 * Seller webhook endpoint list. Inline status (active / disabled /
 * auto-disabled), failure count, last success / failure time.
 *
 * Rotating a secret and deleting an endpoint both ask first, restating
 * the endpoint and what changes, then send exactly the request the row
 * used to send.
 *
 * FE-2 discipline: server rejection on rotate / delete / update
 * surfaces `[code] message` verbatim from ApiError.body.
 */
export function WebhooksIndex(): ReactElement {
  const t = useT();
  const list = useWebhookEndpointsList();
  const del = useDeleteWebhookEndpoint();
  const toast = useToast();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<WebhookEndpointView | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WebhookEndpointView | null>(null);
  const [newlyRevealed, setNewlyRevealed] = useState<WebhookEndpointWithSecret | null>(null);
  const [error, setError] = useState<string | null>(null);

  function fmtError(e: unknown): string {
    return verdict(e, t, t('settingsWebhooks.actionFailed'));
  }

  async function onDelete(id: string): Promise<void> {
    setError(null);
    try {
      await del.mutateAsync(id);
      toast.success(t('settingsWebhooks.endpointDeleted'));
      setPendingDelete(null);
    } catch (e) {
      setError(fmtError(e));
    }
  }

  const rows = list.data ?? [];
  const live = rows.filter((ep) => ep.isActive && ep.autoDisabledAt === null);
  const failing = rows.filter((ep) => ep.consecutiveFailureCount > 0);

  return (
    <div className="set-page">
      <SetPageHeader
        crumbs={crumbsOf(t)}
        title={t('settingsWebhooks.outboundWebhooks')}
        subtitle={t('settingsWebhooks.wireSkydropEventsInto')}
        /*
          The comps show a delivery success rate and a p95 latency. We
          store neither — `consecutiveFailureCount` and the two last-*
          timestamps are the whole record, so these facts say that and
          the list below says the rest.
        */
        meta={
          list.data === undefined ? undefined : (
            <span className="set-meta">
              <SetFact tone="accent">
                {rows.length} {rows.length === 1 ? 'endpoint' : 'endpoints'}
              </SetFact>
              <SetFact tone={live.length === 0 ? undefined : 'good'} dot>
                {live.length} receiving
              </SetFact>
              {failing.length > 0 && <SetFact tone="bad">{failing.length} failing</SetFact>}
            </span>
          )
        }
        action={
          <Button
            variant="primary"
            size="md"
            icon={<Plus size={15} />}
            onClick={() => setCreating(true)}
          >
            {t('settingsWebhooks.newEndpoint')}
          </Button>
        }
      />

      {newlyRevealed && (
        <SecretRevealCard endpoint={newlyRevealed} onDismiss={() => setNewlyRevealed(null)} />
      )}

      {error && (
        <SetCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
          <p>{error}</p>
        </SetCallout>
      )}

      <section className="set-section">
        <SectionHeading
          title={t('settingsWebhooks.yourEndpoints')}
          note={
            rows.length === 0 ? undefined : t('settingsWebhooks.configured', { rows: rows.length })
          }
        />
        {list.isLoading ? (
          <div className="set-card" aria-busy="true">
            <span className="set-sr">{t('settingsWebhooks.loadingEndpoints')}</span>
            <Skeleton width="40%" height={16} />
            <Skeleton width="70%" height={12} />
            <Skeleton width="100%" height={48} />
          </div>
        ) : list.isError ? (
          <ErrorState
            message={list.error?.message ?? t('settingsWebhooks.failedToLoad')}
            retry={() => void list.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Webhook size={22} />}
            title={t('settingsWebhooks.noEndpointsYet')}
            description={t('settingsWebhooks.addAnHttpsUrl')}
            action={
              <Button
                variant="primary"
                size="sm"
                icon={<Plus size={14} />}
                onClick={() => setCreating(true)}
              >
                {t('settingsWebhooks.newEndpoint')}
              </Button>
            }
          />
        ) : (
          <ul className="set-endpoints">
            {rows.map((ep) => (
              <EndpointRow
                key={ep.id}
                endpoint={ep}
                onEdit={() => setEditing(ep)}
                onRevealSecret={(reveal) => setNewlyRevealed(reveal)}
                onDeleteIntent={() => setPendingDelete(ep)}
                onError={setError}
              />
            ))}
          </ul>
        )}
      </section>

      {creating && (
        <WebhookFormModal
          mode="create"
          onClose={() => setCreating(false)}
          onSuccess={(reveal) => {
            setCreating(false);
            setNewlyRevealed(reveal);
          }}
        />
      )}

      {editing && (
        <WebhookFormModal
          mode="edit"
          endpoint={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        title={t('settingsWebhooks.deleteThisEndpoint')}
        entity={pendingDelete === null ? '' : (pendingDelete.name ?? pendingDelete.url)}
        consequence={t('settingsWebhooks.deleteConsequence', {
          url: pendingDelete?.url ?? t('settingsWebhooks.thisUrl'),
        })}
        confirmLabel={t('settingsWebhooks.deleteEndpoint')}
        destructive
        onConfirm={() => (pendingDelete === null ? undefined : onDelete(pendingDelete.id))}
      />
    </div>
  );
}

function EndpointRow({
  endpoint,
  onEdit,
  onRevealSecret,
  onDeleteIntent,
  onError,
}: {
  readonly endpoint: WebhookEndpointView;
  readonly onEdit: () => void;
  readonly onRevealSecret: (r: WebhookEndpointWithSecret) => void;
  readonly onDeleteIntent: () => void;
  readonly onError: (s: string) => void;
}): ReactElement {
  const t = useT();
  const rotate = useRotateWebhookSecret(endpoint.id);
  const update = useUpdateWebhookEndpoint(endpoint.id);
  const [busy, setBusy] = useState<'rotate' | 'toggle' | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const toast = useToast();

  function fmtError(e: unknown): string {
    return verdict(e, t, t('settingsWebhooks.actionFailed'));
  }

  async function onRotate(): Promise<void> {
    setBusy('rotate');
    try {
      const reveal = await rotate.mutateAsync();
      onRevealSecret(reveal);
      toast.success(t('settingsWebhooks.secretRotatedThePrevious'));
    } catch (e) {
      onError(fmtError(e));
    } finally {
      setBusy(null);
    }
  }

  async function onToggle(): Promise<void> {
    setBusy('toggle');
    try {
      await update.mutateAsync({ isActive: !endpoint.isActive });
      toast.success(
        endpoint.isActive
          ? t('settingsWebhooks.endpointDisabled')
          : t('settingsWebhooks.endpointEnabled'),
      );
    } catch (e) {
      onError(fmtError(e));
    } finally {
      setBusy(null);
    }
  }

  const displayName = endpoint.name ?? t('settingsWebhooks.untitledEndpoint');

  return (
    <li className="set-endpoint">
      <div className="set-endpoint__head">
        <div className="set-endpoint__main">
          <div className="set-endpoint__name">
            <span>{displayName}</span>
            {endpoint.autoDisabledAt !== null ? (
              <StatusChip kind="failed" label={t('settingsWebhooks.autoDisabled')} size="sm" />
            ) : endpoint.isActive ? (
              <StatusChip kind="delivered" label={t('settingsWebhooks.active')} size="sm" />
            ) : (
              <StatusChip kind="cancelled" label={t('settingsWebhooks.disabled')} size="sm" />
            )}
          </div>
          <span className="set-endpoint__url sk-ident">{endpoint.url}</span>
          {endpoint.description !== null && endpoint.description !== '' && (
            <p className="set-endpoint__desc">{endpoint.description}</p>
          )}
        </div>
        <div className="set-endpoint__controls">
          <Switch
            checked={endpoint.isActive}
            disabled={busy !== null}
            aria-label={t(
              endpoint.isActive ? 'settingsWebhooks.disableName' : 'settingsWebhooks.enableName',
              { name: displayName },
            )}
            onCheckedChange={() => void onToggle()}
          />
          <Button variant="ghost" size="sm" icon={<Pencil size={13} />} onClick={onEdit}>
            {t('settingsWebhooks.edit')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<KeyRound size={13} />}
            loading={busy === 'rotate'}
            disabled={busy !== null}
            onClick={() => setConfirmRotate(true)}
          >
            {busy === 'rotate'
              ? t('settingsWebhooks.rotating')
              : t('settingsWebhooks.rotateSecret')}
          </Button>
          <Button variant="ghost" size="sm" icon={<Trash2 size={13} />} onClick={onDeleteIntent}>
            {t('settingsWebhooks.delete')}
          </Button>
        </div>
      </div>

      <dl className="set-endpoint__facts">
        <div>
          <dt>{t('settingsWebhooks.subscribedEvents')}</dt>
          {/* A LIST of event names, not one id — so it wraps. */}
          <dd className="sk-ident sk-ident--wrap">
            {endpoint.subscribedEvents.length === 0 ? (
              <span className="set-faint">none</span>
            ) : (
              endpoint.subscribedEvents.join(', ')
            )}
          </dd>
        </div>
        <div>
          <dt>{t('settingsWebhooks.lastSuccess')}</dt>
          <dd className="sk-figure">
            {endpoint.lastSuccessAt !== null ? (
              new Date(endpoint.lastSuccessAt).toLocaleString()
            ) : (
              <span className="set-faint">—</span>
            )}
          </dd>
        </div>
        <div>
          <dt>{t('settingsWebhooks.lastFailure')}</dt>
          <dd className="sk-figure">
            {endpoint.lastFailureAt !== null ? (
              new Date(endpoint.lastFailureAt).toLocaleString()
            ) : (
              <span className="set-faint">—</span>
            )}
          </dd>
        </div>
        <div>
          <dt>{t('settingsWebhooks.failuresConsec')}</dt>
          <dd
            className="sk-figure"
            data-tone={endpoint.consecutiveFailureCount > 0 ? 'bad' : undefined}
          >
            {endpoint.consecutiveFailureCount}
          </dd>
        </div>
      </dl>

      {endpoint.autoDisabledReason !== null && endpoint.autoDisabledReason !== '' && (
        <p className="set-endpoint__warn">
          {richMessage(t('settingsWebhooks.autoDisabled2'), {
            autoDisabledReason: endpoint.autoDisabledReason,
          })}
        </p>
      )}

      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
        title={t('settingsWebhooks.rotateThisSigningSecret')}
        entity={endpoint.url}
        entityIsIdentifier
        consequence={t('settingsWebhooks.weIssueANew', { displayName })}
        confirmLabel={t('settingsWebhooks.rotateSecret')}
        onConfirm={onRotate}
      />
    </li>
  );
}
