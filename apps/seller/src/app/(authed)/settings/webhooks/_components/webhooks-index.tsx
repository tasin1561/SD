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
import { serverVerdict } from '@/lib/server-verdict';
import { SetCallout, SetFact, SetPageHeader } from '../../_components/settings-parts';

const CRUMBS = [
  { label: 'Seller console' },
  { label: 'Account' },
  { label: 'Settings', href: '/settings' },
  { label: 'Webhooks' },
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
  const list = useWebhookEndpointsList();
  const del = useDeleteWebhookEndpoint();
  const toast = useToast();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<WebhookEndpointView | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WebhookEndpointView | null>(null);
  const [newlyRevealed, setNewlyRevealed] = useState<WebhookEndpointWithSecret | null>(null);
  const [error, setError] = useState<string | null>(null);

  function fmtError(e: unknown): string {
    return serverVerdict(e, 'Action failed');
  }

  async function onDelete(id: string): Promise<void> {
    setError(null);
    try {
      await del.mutateAsync(id);
      toast.success('Endpoint deleted.');
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
        crumbs={CRUMBS}
        title="Outbound webhooks"
        subtitle="Wire Skydrop events into your own systems via HMAC-signed HTTPS POSTs. Configure here; the delivery worker will fire once it ships in Phase 1B."
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
            New endpoint
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
          title="Your endpoints"
          note={rows.length === 0 ? undefined : `${rows.length} configured`}
        />
        {list.isLoading ? (
          <div className="set-card" aria-busy="true">
            <span className="set-sr">Loading endpoints…</span>
            <Skeleton width="40%" height={16} />
            <Skeleton width="70%" height={12} />
            <Skeleton width="100%" height={48} />
          </div>
        ) : list.isError ? (
          <ErrorState
            message={list.error?.message ?? 'Failed to load.'}
            retry={() => void list.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Webhook size={22} />}
            title="No endpoints yet"
            description="Add an HTTPS URL we should POST events to. Each endpoint gets a unique HMAC secret you verify on receipt."
            action={
              <Button
                variant="primary"
                size="sm"
                icon={<Plus size={14} />}
                onClick={() => setCreating(true)}
              >
                New endpoint
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
        title="Delete this endpoint?"
        entity={pendingDelete === null ? '' : (pendingDelete.name ?? pendingDelete.url)}
        consequence={`We stop sending events to ${pendingDelete?.url ?? 'this URL'}, and its signing secret stops working. This cannot be undone — you would add the endpoint again and get a new secret.`}
        confirmLabel="Delete endpoint"
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
  const rotate = useRotateWebhookSecret(endpoint.id);
  const update = useUpdateWebhookEndpoint(endpoint.id);
  const [busy, setBusy] = useState<'rotate' | 'toggle' | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const toast = useToast();

  function fmtError(e: unknown): string {
    return serverVerdict(e, 'Action failed');
  }

  async function onRotate(): Promise<void> {
    setBusy('rotate');
    try {
      const reveal = await rotate.mutateAsync();
      onRevealSecret(reveal);
      toast.success('Secret rotated. The previous one stays valid for 24h.');
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
      toast.success(endpoint.isActive ? 'Endpoint disabled.' : 'Endpoint enabled.');
    } catch (e) {
      onError(fmtError(e));
    } finally {
      setBusy(null);
    }
  }

  const displayName = endpoint.name ?? 'Untitled endpoint';

  return (
    <li className="set-endpoint">
      <div className="set-endpoint__head">
        <div className="set-endpoint__main">
          <div className="set-endpoint__name">
            <span>{displayName}</span>
            {endpoint.autoDisabledAt !== null ? (
              <StatusChip kind="failed" label="Auto-disabled" size="sm" />
            ) : endpoint.isActive ? (
              <StatusChip kind="delivered" label="Active" size="sm" />
            ) : (
              <StatusChip kind="cancelled" label="Disabled" size="sm" />
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
            aria-label={`${endpoint.isActive ? 'Disable' : 'Enable'} ${displayName}`}
            onCheckedChange={() => void onToggle()}
          />
          <Button variant="ghost" size="sm" icon={<Pencil size={13} />} onClick={onEdit}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<KeyRound size={13} />}
            loading={busy === 'rotate'}
            disabled={busy !== null}
            onClick={() => setConfirmRotate(true)}
          >
            {busy === 'rotate' ? 'Rotating…' : 'Rotate secret'}
          </Button>
          <Button variant="ghost" size="sm" icon={<Trash2 size={13} />} onClick={onDeleteIntent}>
            Delete
          </Button>
        </div>
      </div>

      <dl className="set-endpoint__facts">
        <div>
          <dt>Subscribed events</dt>
          <dd className="sk-ident">
            {endpoint.subscribedEvents.length === 0 ? (
              <span className="set-faint">none</span>
            ) : (
              endpoint.subscribedEvents.join(', ')
            )}
          </dd>
        </div>
        <div>
          <dt>Last success</dt>
          <dd className="sk-figure">
            {endpoint.lastSuccessAt !== null ? (
              new Date(endpoint.lastSuccessAt).toLocaleString()
            ) : (
              <span className="set-faint">—</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Last failure</dt>
          <dd className="sk-figure">
            {endpoint.lastFailureAt !== null ? (
              new Date(endpoint.lastFailureAt).toLocaleString()
            ) : (
              <span className="set-faint">—</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Failures (consec.)</dt>
          <dd
            className="sk-figure"
            data-tone={endpoint.consecutiveFailureCount > 0 ? 'bad' : undefined}
          >
            {endpoint.consecutiveFailureCount}
          </dd>
        </div>
      </dl>

      {endpoint.autoDisabledReason !== null && endpoint.autoDisabledReason !== '' && (
        <p className="set-endpoint__warn">Auto-disabled: {endpoint.autoDisabledReason}</p>
      )}

      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
        title="Rotate this signing secret?"
        entity={endpoint.url}
        entityIsIdentifier
        consequence={`We issue a new HMAC secret for ${displayName} and show it once. The current secret keeps working for 24 hours, so switch your integration over before then.`}
        confirmLabel="Rotate secret"
        onConfirm={onRotate}
      />
    </li>
  );
}
