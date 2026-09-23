'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { CircleAlert, FileText, Link2, Tag, Webhook } from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import { serverVerdict } from '@/lib/server-verdict';
import { useStoreWebhookEvents, useUpdateStoreWebhook, type StoreWebhook } from '@/lib/order-hooks';
import { RdCallout, phaseOf } from '../../settings/_components/rd-parts';

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
  if (events.isPending) return <SkeletonRows label="Loading the events" rows={2} cols={2} />;
  if (events.isError) {
    return <ErrorState message={serverVerdict(events.error)} retry={() => void events.refetch()} />;
  }
  const chosen = new Set(value);
  return (
    <fieldset className="rd-events">
      <legend>Events</legend>
      <div className="rd-events__grid">
        {events.data.map((e) => (
          <Checkbox
            key={e.code}
            checked={chosen.has(e.code)}
            label={<span className="sk-ident">{e.code}</span>}
            description={e.description}
            onChange={(ev) => {
              const next = new Set(chosen);
              if (ev.target.checked) next.add(e.code);
              else next.delete(e.code);
              // Keep the API's order, so the list reads the same everywhere.
              onChange(events.data.map((x) => x.code).filter((c) => next.has(c)));
            }}
          />
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
    <Dialog
      open
      size="lg"
      icon={<Webhook size={18} />}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Edit webhook"
      description="The signing secret does not change — use New secret for that."
    >
      <form onSubmit={(e) => void submit(e)} className="rd-form">
        <TextField
          id="wh-edit-url"
          label="Your https URL"
          icon={<Link2 size={15} />}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          inputMode="url"
          inputClassName="sk-ident"
          required
        />
        <TextField
          id="wh-edit-name"
          label="Name"
          icon={<Tag size={15} />}
          value={name}
          maxLength={160}
          showCount
          onChange={(e) => setName(e.target.value)}
        />
        <TextArea
          id="wh-edit-description"
          label="Description"
          icon={<FileText size={15} />}
          value={description}
          maxLength={2000}
          showCount
          onChange={(e) => setDescription(e.target.value)}
        />
        <EventPicker value={events} onChange={setEvents} />
        {error !== null ? (
          <RdCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
            <p>{error}</p>
          </RdCallout>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <AsyncButton
            type="submit"
            variant="primary"
            size="md"
            labels={{ idle: 'Save', busy: 'Saving…', error: 'Not saved' }}
            state={phaseOf(update.isPending, error)}
            disabled={update.isPending || url.trim() === '' || events.length === 0}
          />
        </DialogFooter>
      </form>
    </Dialog>
  );
}
