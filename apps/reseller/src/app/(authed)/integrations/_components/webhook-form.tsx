'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import {
  Button,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { useStoreWebhookEvents, useUpdateStoreWebhook, type StoreWebhook } from '@/lib/order-hooks';

/** The events a webhook starts with, when they exist in the offered list. */
export const DEFAULT_EVENTS: readonly string[] = [
  'order.confirmed',
  'shipment.dispatched',
  'shipment.delivered',
];

/**
 * Pick event codes from the list the API sends — never typed, because the
 * API refuses a code it does not send (UNKNOWN_WEBHOOK_EVENT), and a typo
 * would otherwise be a subscription that never fires.
 */
export function EventPicker({
  value,
  onChange,
}: {
  readonly value: readonly string[];
  readonly onChange: (next: string[]) => void;
}): ReactElement {
  const events = useStoreWebhookEvents();
  if (events.isPending) return <LoadingState label="Loading the events" rows={2} />;
  if (events.isError) {
    return <ErrorState message={serverVerdict(events.error)} retry={() => void events.refetch()} />;
  }
  const chosen = new Set(value);
  return (
    <fieldset className="border-border rounded-lg border p-3">
      <legend className="text-text-body px-1 text-sm font-medium">Events</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {events.data.map((e) => (
          <label key={e.code} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={chosen.has(e.code)}
              onChange={(ev) => {
                const next = new Set(chosen);
                if (ev.target.checked) next.add(e.code);
                else next.delete(e.code);
                // Keep the API's order, so the list reads the same everywhere.
                onChange(events.data.map((x) => x.code).filter((c) => next.has(c)));
              }}
            />
            <span>
              <span className="font-mono text-xs">{e.code}</span>
              <span className="text-text-muted block text-xs">{e.description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Change an endpoint's URL, name, description or events. */
export function EditWebhookModal({
  webhook,
  onClose,
}: {
  readonly webhook: StoreWebhook;
  readonly onClose: () => void;
}): ReactElement {
  const toast = useToast();
  const update = useUpdateStoreWebhook();
  const [url, setUrl] = useState(webhook.url);
  const [name, setName] = useState(webhook.name ?? '');
  const [description, setDescription] = useState(webhook.description ?? '');
  const [events, setEvents] = useState<string[]>([...webhook.subscribedEvents]);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      await update.mutateAsync({
        id: webhook.id,
        url: url.trim(),
        name: name.trim(),
        description: description.trim(),
        subscribedEvents: events,
      });
      toast.success('Webhook saved.');
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Modal
      open
      size="lg"
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Edit webhook"
      description="The signing secret does not change — use New secret for that."
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <FormField label="Your https URL" htmlFor="wh-edit-url" required>
          <Input
            id="wh-edit-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            inputMode="url"
            required
          />
        </FormField>
        <FormField label="Name" htmlFor="wh-edit-name">
          <Input
            id="wh-edit-name"
            value={name}
            maxLength={160}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        <FormField label="Description" htmlFor="wh-edit-description">
          <Textarea
            id="wh-edit-description"
            value={description}
            maxLength={2000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>
        <EventPicker value={events} onChange={setEvents} />
        {error !== null ? (
          <p role="alert" className="text-critical text-sm">
            {error}
          </p>
        ) : null}
        <ModalFooter>
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={update.isPending || url.trim() === '' || events.length === 0}
          >
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
