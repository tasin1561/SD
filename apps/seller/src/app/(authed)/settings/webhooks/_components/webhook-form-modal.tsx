'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { CircleAlert, Link2, ListChecks, Tag, Webhook } from 'lucide-react';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import type {
  CreateWebhookEndpointRequest,
  UpdateWebhookEndpointRequest,
  WebhookEndpointView,
  WebhookEndpointWithSecret,
} from '@skydrop/api-client';
import { useCreateWebhookEndpoint, useUpdateWebhookEndpoint } from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { SetCallout, phaseOf } from '../../_components/settings-parts';

/**
 * Create / edit form. Events entered as comma-separated; the server
 * accepts any string codes so a future M11 NOTIF-4 docs page lists
 * the canonical event codes for sellers to subscribe to (the schema
 * is intentionally `string[]`).
 *
 * FE-2 (pinned by `webhook-create-fe2.test.tsx`): a refusal is shown as
 * the server's `[code] message`, verbatim, and the submit is usable again
 * straight after. The actions sit inside the form, so Enter in a field
 * submits exactly as the button does.
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
    return serverVerdict(e, 'Action failed');
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
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) props.onClose();
      }}
      icon={<Webhook size={18} />}
      title={mode === 'create' ? 'New webhook endpoint' : 'Edit webhook endpoint'}
      description={
        mode === 'create'
          ? 'On create, we generate an HMAC secret. You will see it ONCE; copy it to your integration immediately.'
          : 'Rotate the secret from the row action if you need to change it.'
      }
      size="lg"
    >
      <form onSubmit={(e) => void onSubmit(e)} className="set-form-grid">
        <TextField
          label="URL"
          icon={<Link2 size={15} />}
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/skydrop/webhooks"
          required
          inputClassName="sk-ident"
        />
        <TextField
          label="Display name"
          icon={<Tag size={15} />}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={160}
          showCount
          placeholder="My CRM integration"
        />
        <TextArea
          label="Description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          showCount
          placeholder="What this endpoint is for, who owns it, etc."
        />
        <TextArea
          label="Subscribed events (comma-separated)"
          icon={<ListChecks size={15} />}
          rows={3}
          value={events}
          onChange={(e) => setEvents(e.target.value)}
          placeholder="order.confirmed, shipment.dispatched, shipment.delivered"
          required
        />

        {error && (
          <SetCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
            <p>{error}</p>
          </SetCallout>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" size="md" disabled={busy} onClick={props.onClose}>
            Cancel
          </Button>
          <AsyncButton
            type="submit"
            variant="primary"
            size="md"
            labels={
              mode === 'create'
                ? { idle: 'Create endpoint', busy: 'Creating…', error: 'Not created' }
                : { idle: 'Save', busy: 'Saving…', error: 'Not saved' }
            }
            state={phaseOf(busy, error)}
            disabled={busy}
          />
        </DialogFooter>
      </form>
    </Dialog>
  );
}
