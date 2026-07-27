'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  ErrorState,
  LoadingState,
  PageHeader,
  useToast,
} from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import type { WebhookEndpointView, WebhookEndpointWithSecret } from '@skydrop/api-client';
import {
  useDeleteWebhookEndpoint,
  useRotateWebhookSecret,
  useUpdateWebhookEndpoint,
  useWebhookEndpointsList,
} from '@/lib/api-hooks';
import { WebhookFormModal } from './webhook-form-modal';
import { SecretRevealCard } from './secret-reveal-card';

/**
 * Seller webhook endpoint list. Inline status (active / disabled /
 * auto-disabled), failure-count badge, last success / failure time.
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
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [newlyRevealed, setNewlyRevealed] = useState<WebhookEndpointWithSecret | null>(null);
  const [error, setError] = useState<string | null>(null);

  function fmtError(e: unknown): string {
    if (e instanceof ApiError) {
      const b = e.body as { code?: unknown; message?: unknown } | null;
      const code = typeof b?.code === 'string' ? b.code : null;
      const msg = typeof b?.message === 'string' ? b.message : e.message;
      return code ? `[${code}] ${msg}` : msg;
    }
    return e instanceof Error ? e.message : 'Action failed';
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

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Outbound webhooks"
        subtitle="Wire Skydrop events into your own systems via HMAC-signed HTTPS POSTs. Configure here; the delivery worker will fire once it ships in Phase 1B."
        action={
          <Button variant="primary" size="md" onClick={() => setCreating(true)}>
            New endpoint
          </Button>
        }
      />

      {newlyRevealed && (
        <SecretRevealCard endpoint={newlyRevealed} onDismiss={() => setNewlyRevealed(null)} />
      )}

      {error && (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px] mb-3">
          {error}
        </div>
      )}

      {list.isLoading ? (
        <LoadingState label="Loading endpoints…" />
      ) : list.isError ? (
        <ErrorState
          message={list.error?.message ?? 'Failed to load.'}
          retry={() => void list.refetch()}
        />
      ) : !list.data || list.data.length === 0 ? (
        <Card>
          <CardBody>
            <div className="text-text-bright text-sm mb-1">No endpoints yet.</div>
            <p className="text-text-muted text-xs mb-3">
              Add an HTTPS URL we should POST events to. Each endpoint gets a unique HMAC secret you
              verify on receipt.
            </p>
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              New endpoint
            </Button>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {list.data.map((ep) => (
            <EndpointRow
              key={ep.id}
              endpoint={ep}
              onEdit={() => setEditing(ep)}
              onRevealSecret={(reveal) => setNewlyRevealed(reveal)}
              pendingDelete={pendingDelete === ep.id}
              onDeleteIntent={() => setPendingDelete(ep.id)}
              onDeleteConfirm={() => void onDelete(ep.id)}
              onDeleteCancel={() => setPendingDelete(null)}
              onError={setError}
            />
          ))}
        </div>
      )}

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
    </div>
  );
}

function EndpointRow({
  endpoint,
  onEdit,
  onRevealSecret,
  pendingDelete,
  onDeleteIntent,
  onDeleteConfirm,
  onDeleteCancel,
  onError,
}: {
  readonly endpoint: WebhookEndpointView;
  readonly onEdit: () => void;
  readonly onRevealSecret: (r: WebhookEndpointWithSecret) => void;
  readonly pendingDelete: boolean;
  readonly onDeleteIntent: () => void;
  readonly onDeleteConfirm: () => void;
  readonly onDeleteCancel: () => void;
  readonly onError: (s: string) => void;
}): ReactElement {
  const rotate = useRotateWebhookSecret(endpoint.id);
  const update = useUpdateWebhookEndpoint(endpoint.id);
  const [busy, setBusy] = useState<'rotate' | 'toggle' | null>(null);
  const toast = useToast();

  function fmtError(e: unknown): string {
    if (e instanceof ApiError) {
      const b = e.body as { code?: unknown; message?: unknown } | null;
      const code = typeof b?.code === 'string' ? b.code : null;
      const msg = typeof b?.message === 'string' ? b.message : e.message;
      return code ? `[${code}] ${msg}` : msg;
    }
    return e instanceof Error ? e.message : 'Action failed';
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

  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0 flex-1">
            <div className="text-text-bright font-medium text-sm">
              {endpoint.name ?? 'Untitled endpoint'}{' '}
              {endpoint.autoDisabledAt ? (
                <span className="text-critical text-[10px] uppercase ml-2">Auto-disabled</span>
              ) : endpoint.isActive ? (
                <span className="text-accent text-[10px] uppercase ml-2">Active</span>
              ) : (
                <span className="text-text-muted text-[10px] uppercase ml-2">Disabled</span>
              )}
            </div>
            <div className="text-text-muted font-mono text-xs mt-0.5 truncate">{endpoint.url}</div>
            {endpoint.description && (
              <div className="text-text-muted text-xs mt-1">{endpoint.description}</div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => void onToggle()}
            >
              {endpoint.isActive ? 'Disable' : 'Enable'}
            </Button>
            <Button variant="ghost" size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => void onRotate()}
            >
              {busy === 'rotate' ? 'Rotating…' : 'Rotate secret'}
            </Button>
            {pendingDelete ? (
              <>
                <Button variant="destructive" size="sm" onClick={onDeleteConfirm}>
                  Confirm
                </Button>
                <Button variant="ghost" size="sm" onClick={onDeleteCancel}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={onDeleteIntent}>
                Delete
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-border text-xs">
          <div>
            <div className="text-text-faint uppercase tracking-wide mb-1">Subscribed events</div>
            <div className="text-text-body font-mono">
              {endpoint.subscribedEvents.length === 0 ? (
                <span className="text-text-faint">none</span>
              ) : (
                endpoint.subscribedEvents.join(', ')
              )}
            </div>
          </div>
          <div>
            <div className="text-text-faint uppercase tracking-wide mb-1">Last success</div>
            <div className="text-text-body">
              {endpoint.lastSuccessAt ? new Date(endpoint.lastSuccessAt).toLocaleString() : '—'}
            </div>
          </div>
          <div>
            <div className="text-text-faint uppercase tracking-wide mb-1">Failures (consec.)</div>
            <div
              className={
                endpoint.consecutiveFailureCount > 0
                  ? 'text-critical font-mono'
                  : 'text-text-body font-mono'
              }
            >
              {endpoint.consecutiveFailureCount}
            </div>
          </div>
        </div>

        {endpoint.autoDisabledReason && (
          <div className="mt-3 pt-3 border-t border-border text-critical text-xs">
            Auto-disabled: {endpoint.autoDisabledReason}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
