'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { TicketType } from '@skydrop/db';
import { LifeBuoy, Send, Store } from 'lucide-react';
import { AsyncButton, type AsyncPhase } from '@skydrop/ui/app/async-button';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { ChoiceCards } from '@skydrop/ui/app/choice-cards';
import { Select } from '@skydrop/ui/app/select';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { serverVerdict } from '@/lib/server-verdict';
import { storeTicketKind } from '@/lib/ticket-kind';
import '../../_components/tickets.css';

export type TicketAudience = 'seller' | 'skydrop';

/**
 * What came of it: a ticket, or (for Skydrop, when the seller approves
 * this store's issues first) a request waiting on Seller staff.
 */
export type NewTicketResult =
  | { readonly kind: 'ticket'; readonly id: string }
  | { readonly kind: 'held'; readonly orderId: string };

export interface NewTicketInput {
  readonly audience: TicketAudience;
  readonly orderId: string;
  readonly subject: string;
  readonly description?: string;
  /** RS-7 (2026-09-19) — the "correct the figures" case, seller only. */
  readonly disputeKind?: 'GENERAL' | 'FIGURE_CORRECTION';
  readonly claimAmountInr?: string;
  readonly claimPayer?: 'STORE' | 'SELLER';
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
  skydropMode,
}: {
  readonly initialOrderId: string;
  readonly initialAudience?: TicketAudience;
  readonly pending: boolean;
  readonly submit: (input: NewTicketInput) => Promise<NewTicketResult>;
  readonly onDone: (result: NewTicketResult) => void;
  /**
   * The seller's `chaseSkydrop` policy for this store, when known
   * (2026-09-17). OFF hides the Skydrop choice; ASK_SELLER says the issue
   * goes to Seller staff first. Cosmetic — the server decides (FE-2).
   */
  readonly skydropMode?: 'OFF' | 'ASK_SELLER' | 'DIRECT' | undefined;
}): ReactElement {
  const offerSkydrop = skydropMode !== 'OFF';
  const heldForSeller = skydropMode === 'ASK_SELLER';
  const [audience, setAudience] = useState<TicketAudience>(
    initialAudience === 'skydrop' && !offerSkydrop ? 'seller' : initialAudience,
  );
  const [orderId, setOrderId] = useState(initialOrderId);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  // RS-7 (2026-09-19) — the correction case. Only ever offered for a
  // dispute with the SELLER: an issue with Skydrop is about a parcel in
  // our hands, and money between you and your seller is not ours to move
  // on that thread.
  const [correction, setCorrection] = useState(false);
  const [claimAmount, setClaimAmount] = useState('');
  const [claimPayer, setClaimPayer] = useState<'STORE' | 'SELLER'>('SELLER');
  const correcting = audience === 'seller' && correction;

  const withSeller = storeTicketKind(TicketType.STORE_DISPUTE);
  const withSkydrop = storeTicketKind(TicketType.STORE_ISSUE);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      const result = await submit({
        audience,
        orderId: orderId.trim(),
        subject,
        ...(description.trim() === '' ? {} : { description }),
        ...(correcting
          ? {
              disputeKind: 'FIGURE_CORRECTION' as const,
              claimAmountInr: claimAmount.trim(),
              claimPayer,
            }
          : {}),
      });
      onDone(result);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  // The button shows the REAL request's state: busy while the caller's
  // mutation runs, the refusal once the server has answered with one.
  const phase: AsyncPhase = pending ? 'busy' : error !== null ? 'error' : 'idle';
  const submitLabel =
    audience === 'skydrop'
      ? heldForSeller
        ? 'Send it to your seller to approve'
        : 'Raise it with Skydrop'
      : 'Raise it with your seller';

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="rc-tkt-form">
      <ChoiceCards
        label="Who is this for?"
        name="ticket-audience"
        columns={offerSkydrop ? 2 : 1}
        value={audience}
        onChange={(v) => setAudience(v === 'skydrop' ? 'skydrop' : 'seller')}
        options={[
          {
            value: 'seller',
            icon: <Store size={16} />,
            title: 'Your seller',
            description: withSeller.blurb,
          },
          ...(offerSkydrop
            ? [
                {
                  value: 'skydrop',
                  icon: <LifeBuoy size={16} />,
                  title: 'Skydrop',
                  description: heldForSeller
                    ? 'Skydrop reads it — something damaged in our hands, lost, or sitting in our warehouse. Your seller approves these first: it reaches Skydrop only once Seller staff say yes.'
                    : withSkydrop.blurb,
                },
              ]
            : []),
        ]}
      />

      <TextField
        id="ticket-order"
        label="Order"
        hint="The order this is about."
        value={orderId}
        onChange={(e) => setOrderId(e.target.value)}
        required
      />
      {audience === 'seller' ? (
        <div className="rc-tkt-correction">
          <Checkbox
            checked={correction}
            onChange={(e) => setCorrection(e.target.checked)}
            label="This is about the money worked out on the order"
            description={
              <>
                Say what you think is owed and who owes it. Skydrop checks it against the figures
                that were on the order when you raised this, and settles it between your wallet and
                your seller&rsquo;s.
              </>
            }
          />
          {correction ? (
            <div className="rc-tkt-claim">
              <TextField
                id="ticket-claim-amount"
                label="How much"
                hint="₹, up to 2 decimals"
                inputMode="decimal"
                value={claimAmount}
                onChange={(e) => setClaimAmount(e.target.value)}
                placeholder="120.00"
                required
              />
              <Select
                id="ticket-claim-payer"
                label="Who owes it"
                value={claimPayer}
                onChange={(e) => setClaimPayer(e.target.value === 'STORE' ? 'STORE' : 'SELLER')}
              >
                <option value="SELLER">The seller owes us</option>
                <option value="STORE">We owe the seller</option>
              </Select>
            </div>
          ) : null}
        </div>
      ) : null}

      <TextField
        id="ticket-subject"
        label="What is wrong"
        // The accessible name without the required mark the field draws
        // beside its label — the same words the old label carried.
        aria-label="What is wrong"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        maxLength={200}
        showCount
        required
      />
      <TextArea
        id="ticket-description"
        label="Tell us more"
        rows={4}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={4000}
        showCount
      />
      {error !== null ? (
        <p role="alert" className="rc-tkt-error">
          {error}
        </p>
      ) : null}
      <div className="rc-tkt-actions">
        <AsyncButton
          type="submit"
          variant="primary"
          size="md"
          icon={<Send size={15} />}
          state={phase}
          disabled={pending}
          labels={{
            idle: submitLabel,
            busy: audience === 'skydrop' && heldForSeller ? 'Sending…' : 'Raising…',
            done: 'Raised',
            error: 'Not raised',
          }}
        />
      </div>
    </form>
  );
}
