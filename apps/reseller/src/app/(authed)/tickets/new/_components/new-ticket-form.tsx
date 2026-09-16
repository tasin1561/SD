'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { TicketType } from '@skydrop/db';
import { Button, FormField, Input, Textarea } from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { storeTicketKind } from '@/lib/ticket-kind';

export type TicketAudience = 'seller' | 'skydrop';

export interface NewTicketInput {
  readonly audience: TicketAudience;
  readonly orderId: string;
  readonly subject: string;
  readonly description?: string;
}

/**
 * Raising something about one of this store's orders.
 *
 * ── WHY ONE FORM WITH A CHOICE, NOT TWO FORMS ────────────────────────
 * The two acts are genuinely different — a dispute argues with the
 * SELLER and can move money between their wallet and the store's; an
 * issue tells SKYDROP we damaged, lost or are sitting on the parcel, and
 * the seller is never told. What makes them easy to confuse is that they
 * are described in separate places. Side by side, with the consequence
 * under each, the difference is the first thing read rather than
 * something to be inferred from which button was clicked.
 *
 * It checks nothing the server checks (FE-2): an order that is not this
 * store's, a subject too short, or a seller who has not enabled raising
 * issues with Skydrop, all come back in the server's own words.
 */
export function NewTicketForm({
  initialOrderId,
  initialAudience = 'seller',
  pending,
  submit,
  onDone,
}: {
  readonly initialOrderId: string;
  readonly initialAudience?: TicketAudience;
  readonly pending: boolean;
  readonly submit: (input: NewTicketInput) => Promise<{ id: string }>;
  readonly onDone: (id: string) => void;
}): ReactElement {
  const [audience, setAudience] = useState<TicketAudience>(initialAudience);
  const [orderId, setOrderId] = useState(initialOrderId);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const withSeller = storeTicketKind(TicketType.STORE_DISPUTE);
  const withSkydrop = storeTicketKind(TicketType.STORE_ISSUE);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      const t = await submit({
        audience,
        orderId: orderId.trim(),
        subject,
        ...(description.trim() === '' ? {} : { description }),
      });
      onDone(t.id);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
      <fieldset>
        <legend className="text-text-strong mb-2 text-sm font-medium">Who is this for?</legend>
        <div className="space-y-2">
          <label className="border-border hover:bg-surface-hover flex cursor-pointer items-start gap-2 rounded-[var(--radius-2)] border px-3 py-2">
            <input
              type="radio"
              name="ticket-audience"
              className="mt-1"
              checked={audience === 'seller'}
              onChange={() => setAudience('seller')}
            />
            <span>
              <span className="text-text-strong block text-sm">Your seller</span>
              <span className="text-text-muted block text-xs leading-relaxed">
                {withSeller.blurb}
              </span>
            </span>
          </label>
          <label className="border-border hover:bg-surface-hover flex cursor-pointer items-start gap-2 rounded-[var(--radius-2)] border px-3 py-2">
            <input
              type="radio"
              name="ticket-audience"
              className="mt-1"
              checked={audience === 'skydrop'}
              onChange={() => setAudience('skydrop')}
            />
            <span>
              <span className="text-text-strong block text-sm">Skydrop</span>
              <span className="text-text-muted block text-xs leading-relaxed">
                {withSkydrop.blurb}
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <FormField label="Order" htmlFor="ticket-order" hint="The order this is about.">
        <Input
          id="ticket-order"
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
          required
        />
      </FormField>
      <FormField label="What is wrong" htmlFor="ticket-subject">
        <Input
          id="ticket-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          required
        />
      </FormField>
      <FormField label="Tell us more" htmlFor="ticket-description">
        <Textarea
          id="ticket-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={4000}
        />
      </FormField>
      {error !== null ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {audience === 'skydrop' ? 'Raise it with Skydrop' : 'Raise it with your seller'}
      </Button>
    </form>
  );
}
