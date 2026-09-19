'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { TicketType } from '@skydrop/db';
import { Button, FormField, Input, Select, Textarea } from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { storeTicketKind } from '@/lib/ticket-kind';

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
          {offerSkydrop ? (
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
                  {heldForSeller
                    ? 'Skydrop reads it — something damaged in our hands, lost, or sitting in our warehouse. Your seller approves these first: it reaches Skydrop only once Seller staff say yes.'
                    : withSkydrop.blurb}
                </span>
              </span>
            </label>
          ) : null}
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
      {audience === 'seller' ? (
        <div className="border-border space-y-3 rounded-[var(--radius-2)] border px-3 py-2.5">
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={correction}
              onChange={(e) => setCorrection(e.target.checked)}
            />
            <span>
              <span className="text-text-strong block text-sm">
                This is about the money worked out on the order
              </span>
              <span className="text-text-muted block text-xs leading-relaxed">
                Say what you think is owed and who owes it. Skydrop checks it against the figures
                that were on the order when you raised this, and settles it between your wallet and
                your seller&rsquo;s.
              </span>
            </span>
          </label>
          {correction ? (
            <div className="flex flex-wrap items-end gap-2.5">
              <FormField
                label="How much"
                htmlFor="ticket-claim-amount"
                hint="₹, up to 2 decimals"
                className="w-[160px]"
              >
                <Input
                  id="ticket-claim-amount"
                  inputMode="decimal"
                  value={claimAmount}
                  onChange={(e) => setClaimAmount(e.target.value)}
                  placeholder="120.00"
                  required
                />
              </FormField>
              <FormField label="Who owes it" htmlFor="ticket-claim-payer" className="w-[180px]">
                <Select
                  id="ticket-claim-payer"
                  value={claimPayer}
                  onChange={(e) => setClaimPayer(e.target.value === 'STORE' ? 'STORE' : 'SELLER')}
                >
                  <option value="SELLER">The seller owes us</option>
                  <option value="STORE">We owe the seller</option>
                </Select>
              </FormField>
            </div>
          ) : null}
        </div>
      ) : null}

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
        {audience === 'skydrop'
          ? heldForSeller
            ? 'Send it to your seller to approve'
            : 'Raise it with Skydrop'
          : 'Raise it with your seller'}
      </Button>
    </form>
  );
}
