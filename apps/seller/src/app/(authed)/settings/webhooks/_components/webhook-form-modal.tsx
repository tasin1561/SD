'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import {
  Button,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Textarea,
} from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import type {
  CreateWebhookEndpointRequest,
  UpdateWebhookEndpointRequest,
  WebhookEndpointView,
  WebhookEndpointWithSecret,
} from '@skydrop/api-client';
import {
  useCreateWebhookEndpoint,
  useUpdateWebhookEndpoint,
} from '@/lib/api-hooks';

/**
 * Create / edit form. Events entered as comma-separated; the server
 * accepts any string codes so a future M11 NOTIF-4 docs page lists
 * the canonical event codes for sellers to subscribe to (the schema
 * is intentionally `string[]`).
 */

type Mode = 'create' | 'edit';

export function WebhookFormModal(
  props:
    | {
        readonly mode: 'create';
        readonly onClose: () => void;
        readonly onSuccess: (revealed: WebhookEndpointWithSecret) => void;
      }
    | {
        readonly mode: 'edit';
        readonly endpoint: WebhookEndpointView;
        readonly onClose: () => void;
        readonly onSuccess: () => void;
      },
): ReactElement {
  const mode: Mode = props.mode;
  const seed = props.mode === 'edit' ? props.endpoint : null;

  const create = useCreateWebhookEndpoint();
  const update = useUpdateWebhookEndpoint(seed?.id ?? '');

  const [url, setUrl] = useState(seed?.url ?? 'https://');
  const [name, setName] = useState(seed?.name ?? '');
  const [description, setDescription] = useState(seed?.description ?? '');
  const [events, setEvents] = useState(
    seed?.subscribedEvents.join(', ') ?? 'order.confirmed, shipment.dispatched, shipment.delivered',
  );
  const [busy, setBusy] = useState(false);
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

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const parsedEvents = events
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (props.mode === 'create') {
        const body: CreateWebhookEndpointRequest = {
          url: url.trim(),
          subscribedEvents: parsedEvents,
          ...(name.trim() ? { name: name.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
        };
        const revealed = await create.mutateAsync(body);
        props.onSuccess(revealed);
      } else {
        const body: Record<string, unknown> = {
          url: url.trim(),
          subscribedEvents: parsedEvents,
        };
        if (name.trim()) body.name = name.trim();
        if (description.trim()) body.description = description.trim();
        await update.mutateAsync(body as UpdateWebhookEndpointRequest);
        props.onSuccess();
      }
    } catch (err) {
      setError(fmtError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) props.onClose();
      }}
      title={mode === 'create' ? 'New webhook endpoint' : 'Edit webhook endpoint'}
      description={
        mode === 'create'
          ? 'On create, we generate an HMAC secret. You will see it ONCE; copy it to your integration immediately.'
          : 'Rotate the secret from the row action if you need to change it.'
      }
      size="lg"
    >
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <FormField label="URL" required>
          <Input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/skydrop/webhooks"
            required
          />
        </FormField>
        <FormField label="Display name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
            placeholder="My CRM integration"
          />
        </FormField>
        <FormField label="Description">
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            placeholder="What this endpoint is for, who owns it, etc."
          />
        </FormField>
        <FormField label="Subscribed events (comma-separated)" required>
          <Textarea
            rows={3}
            value={events}
            onChange={(e) => setEvents(e.target.value)}
            placeholder="order.confirmed, shipment.dispatched, shipment.delivered"
            required
          />
        </FormField>

        {error && (
          <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px]">
            {error}
          </div>
        )}

        <ModalFooter>
          <Button
            type="button"
            variant="ghost"
            size="md"
            disabled={busy}
            onClick={props.onClose}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={busy}>
            {busy ? (mode === 'create' ? 'Creating…' : 'Saving…') : mode === 'create' ? 'Create endpoint' : 'Save'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
