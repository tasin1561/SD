'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import {
  BandBody,
  Button,
  Crumbs,
  EmptyState,
  ErrorState,
  LoadingState,
  MetaChip,
  PageHeader,
  SectionBand,
  StatusBadge,
  useToast,
} from '@skydrop/ui/components';
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

const CRUMBS = [
  { label: 'Seller console' },
  { label: 'Account' },
  { label: 'Settings', href: '/settings' },
  { label: 'Webhooks' },
];

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
    <div className="space-y-4">
      <PageHeader
        breadcrumb={<Crumbs items={CRUMBS} Link={Link} />}
        title="Outbound webhooks"
        subtitle="Wire Skydrop events into your own systems via HMAC-signed HTTPS POSTs. Configure here; the delivery worker will fire once it ships in Phase 1B."
        /*
          The comps show a delivery success rate and a p95 latency. We
          store neither — `consecutiveFailureCount` and the two last-*
          timestamps are the whole record, so these chips say that and
          the register below says the rest.
        */
        meta={
          list.data === undefined ? undefined : (
            <>
              <MetaChip tone="accent">
                {rows.length} {rows.length === 1 ? 'endpoint' : 'endpoints'}
              </MetaChip>
              <MetaChip tone={live.length === 0 ? 'neutral' : 'good'} dot>
                {live.length} receiving
              </MetaChip>
              {failing.length > 0 && <MetaChip tone="bad">{failing.length} failing</MetaChip>}
            </>
          )
        }
        action={
          <Button variant="primary" size="md" onClick={() => setCreating(true)}>
            <Plus size={14} aria-hidden /> New endpoint
          </Button>
        }
      />

      {newlyRevealed && (
        <SecretRevealCard endpoint={newlyRevealed} onDismiss={() => setNewlyRevealed(null)} />
      )}

      {error && (
        <div className="text-critical border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] rounded-[var(--radius-2)] border px-3 py-2 text-xs">
          {error}
        </div>
      )}

      <div>
        <SectionBand
          index="01"
          title="Endpoint register"
          note={rows.length === 0 ? undefined : `${rows.length} configured`}
        />
        <BandBody flush>
          {list.isLoading ? (
            <div className="p-3">
              <LoadingState label="Loading endpoints…" />
            </div>
          ) : list.isError ? (
            <div className="p-3">
              <ErrorState
                message={list.error?.message ?? 'Failed to load.'}
                retry={() => void list.refetch()}
              />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              bare
              title="No endpoints yet"
              description="Add an HTTPS URL we should POST events to. Each endpoint gets a unique HMAC secret you verify on receipt."
              action={
                <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                  New endpoint
                </Button>
              }
            />
          ) : (
            <div className="divide-border divide-y">
              {rows.map((ep) => (
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
        </BandBody>
      </div>

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

/** A quiet caption over a fact, in the register's own mono ruler face. */
function Caption({ children }: { readonly children: string }): ReactElement {
  return (
    <div className="text-text-faint mb-1 font-mono text-[11px] tracking-[0.08em] uppercase">
      {children}
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

  return (
    <div className="px-3 py-3">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-text-bright text-sm font-medium">
              {endpoint.name ?? 'Untitled endpoint'}
            </span>
            {endpoint.autoDisabledAt !== null ? (
              <StatusBadge kind="failed" label="Auto-disabled" />
            ) : endpoint.isActive ? (
              <StatusBadge kind="delivered" label="Active" />
            ) : (
              <StatusBadge kind="cancelled" label="Disabled" />
            )}
          </div>
          <div className="text-text-muted mt-1 truncate font-mono text-xs">{endpoint.url}</div>
          {endpoint.description !== null && endpoint.description !== '' && (
            <div className="text-text-faint mt-1 text-xs">{endpoint.description}</div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
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

      <div className="border-border mt-3 grid grid-cols-1 gap-3 border-t pt-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0">
          <Caption>Subscribed events</Caption>
          <div className="text-text-body font-mono break-words">
            {endpoint.subscribedEvents.length === 0 ? (
              <span className="text-text-faint">none</span>
            ) : (
              endpoint.subscribedEvents.join(', ')
            )}
          </div>
        </div>
        <div>
          <Caption>Last success</Caption>
          <div className="text-text-body font-mono">
            {endpoint.lastSuccessAt !== null ? (
              new Date(endpoint.lastSuccessAt).toLocaleString()
            ) : (
              <span className="text-text-faint">—</span>
            )}
          </div>
        </div>
        <div>
          <Caption>Last failure</Caption>
          <div className="text-text-body font-mono">
            {endpoint.lastFailureAt !== null ? (
              new Date(endpoint.lastFailureAt).toLocaleString()
            ) : (
              <span className="text-text-faint">—</span>
            )}
          </div>
        </div>
        <div>
          <Caption>Failures (consec.)</Caption>
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

      {endpoint.autoDisabledReason !== null && endpoint.autoDisabledReason !== '' && (
        <div className="border-border text-critical mt-3 border-t pt-3 text-xs">
          Auto-disabled: {endpoint.autoDisabledReason}
        </div>
      )}
    </div>
  );
}
