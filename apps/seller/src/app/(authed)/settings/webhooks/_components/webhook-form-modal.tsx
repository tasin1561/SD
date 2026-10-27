'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { CircleAlert, Link2, Tag, Webhook } from 'lucide-react';
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
import { verdict } from '@/i18n/verdict';
import { SetCallout, phaseOf } from '../../_components/settings-parts';
import { DEFAULT_EVENTS, EventPicker } from './event-picker';
import { useT } from '@/i18n/client';

/**
 * Create / edit form.
 *
 * ── EVENTS ARE PICKED, NOT TYPED (2026-10-01) ────────────────────────
 * This was a comma-separated text box over a `string[]` column with no
 * vocabulary check anywhere. A seller typing `shipment.delivery` or
 * `order.confirm` — close, and wrong — saved cleanly, showed on screen
 * as configured, and matched nothing we ever send. Silently, for ever:
 * an endpoint subscribed to nothing looks exactly like one whose events
 * have not happened yet. The reseller STORE's version of this screen
 * has picked from the catalogue since RS-5, so one concept had two
 * behaviours.
 *
 * ── WHY NOT JUST VALIDATE ON WRITE ───────────────────────────────────
 * The owner's call, and the reason constrains the shape: a row already
 * holding a value outside the catalogue would then fail its NEXT save,
 * INCLUDING a save that does not touch the events at all — somebody
 * renaming an endpoint would be blocked by a typo made months ago.
 * That punishes a seller for our omission.
 *
 * So the picker makes a typo UNREPRESENTABLE rather than detected, and
 * a stored value the catalogue does not know is kept, shown as a
 * warning chip in the seller's own words, and removable in one click.
 * Nobody's save breaks; no new bad value can be made; a bad one is
 * visible the next time somebody opens the page.
 *
 * The API is deliberately UNCHANGED — `subscribedEvents` is still
 * `string[]` with no write check, which is what lets a live row stay
 * saveable.
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
  const t = useT();
  const mode: Mode = props.mode;
  const seed = props.mode === 'edit' ? props.endpoint : null;

  const create = useCreateWebhookEndpoint();
  const update = useUpdateWebhookEndpoint(seed?.id ?? '');

  const [url, setUrl] = useState(seed?.url ?? 'https://');
  const [name, setName] = useState(seed?.name ?? '');
  const [description, setDescription] = useState(seed?.description ?? '');
  const [events, setEvents] = useState<readonly string[]>(seed?.subscribedEvents ?? DEFAULT_EVENTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fmtError(e: unknown): string {
    return verdict(e, t, t('settingsWebhooks.actionFailed'));
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Sent EXACTLY as held, unrecognised values included: a save that
      // did not touch the events must not quietly drop one.
      const parsedEvents = [...events];
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
      title={
        mode === 'create'
          ? t('settingsWebhooks.newWebhookEndpoint')
          : t('settingsWebhooks.editWebhookEndpoint')
      }
      description={
        mode === 'create'
          ? t('settingsWebhooks.onCreateWeGenerate')
          : t('settingsWebhooks.rotateTheSecretFrom')
      }
      size="lg"
    >
      <form onSubmit={(e) => void onSubmit(e)} className="set-form-grid">
        <TextField
          label={t('settingsWebhooks.url')}
          icon={<Link2 size={15} />}
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/skydrop/webhooks"
          required
          inputClassName="sk-ident"
        />
        <TextField
          label={t('settingsWebhooks.displayName')}
          icon={<Tag size={15} />}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={160}
          showCount
          placeholder={t('settingsWebhooks.myCrmIntegration')}
        />
        <TextArea
          label={t('settingsWebhooks.description')}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          showCount
          placeholder={t('settingsWebhooks.whatThisEndpointIs')}
        />
        <EventPicker value={events} onChange={setEvents} />

        {error && (
          <SetCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
            <p>{error}</p>
          </SetCallout>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" size="md" disabled={busy} onClick={props.onClose}>
            {t('settingsWebhooks.cancel')}
          </Button>
          <AsyncButton
            type="submit"
            variant="primary"
            size="md"
            labels={
              mode === 'create'
                ? {
                    idle: t('settingsWebhooks.createEndpoint'),
                    busy: t('settingsWebhooks.creating'),
                    error: t('settingsWebhooks.notCreated'),
                  }
                : {
                    idle: t('settingsWebhooks.save'),
                    busy: t('settingsWebhooks.saving'),
                    error: t('settingsWebhooks.notSaved'),
                  }
            }
            state={phaseOf(busy, error)}
            disabled={busy}
          />
        </DialogFooter>
      </form>
    </Dialog>
  );
}
