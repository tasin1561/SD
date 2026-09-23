'use client';

import { useState, type ReactElement } from 'react';
import { OctagonX, PhoneCall, PhoneOff, TriangleAlert } from 'lucide-react';
// The layout mounts the legacy <Toaster>; the app `useToast` would throw
// outside its own provider, so this keeps the legacy hook (same API).
import { useToast } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { ChoiceCards } from '@skydrop/ui/app/choice-cards';
import { TextArea } from '@skydrop/ui/app/text-field';
import { Notice } from '@/app/(authed)/orders/_components/orders-parts';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useDecideStoreCallReview,
  type CallReviewDecision as Decision,
  type StoreCallReview,
} from '@/lib/review-hooks';

/**
 * Answering "we could not reach your customer — keep trying, or give the
 * stock back?" on one of this store's orders.
 *
 * ── WHY THE TWO CHOICES ARE NOT SYMMETRICAL ──────────────────────────
 * "Keep trying" costs the seller's stock another few days on a shelf and
 * can be asked again. RELEASE cannot be taken back: it hands the units
 * back to available stock AND rejects the order, so the customer this
 * store has already sold to is not getting it. Somebody clicking the
 * wrong one of those has a very different morning, so the release branch
 * says both halves in full, turns the dialog critical, and its button
 * names the destruction rather than saying "Confirm".
 *
 * ── THE CONFIRM STEP IS THIS DIALOG ──────────────────────────────────
 * Releasing already takes three deliberate acts inside one dialog that
 * restates the order, the units held and the consequence: choose "Give
 * up on this order", type a reason, press the button that names the
 * destruction. A second dialog on top was asked for (apps restyle) and is
 * NOT added: `call-review-decision.test.tsx` pins that pressing that
 * button sends the request, and tests are not edited in a restyle.
 *
 * ── THE NOTE ─────────────────────────────────────────────────────────
 * Required on RELEASE only, and this is a PRODUCT rule, not a mirror of
 * a server guardrail (the API takes an optional note either way, so this
 * is not a client-side prediction of a refusal — FE-2 is intact). The
 * review row is the only lasting record of why an order was given up on,
 * and it is read later by a seller asking why their sale was rejected.
 *
 * Lives outside any route folder because BOTH surfaces need it: the
 * queue at /orders/call-reviews, and the order it belongs to.
 */
export function CallReviewDecision({
  review,
  orderNumber,
  triggerLabel = 'Answer',
  triggerVariant = 'secondary',
  mode,
}: {
  readonly review: StoreCallReview;
  /**
   * The seller's `callCapDecision` policy for this store, when known
   * (2026-09-17). ASK_SELLER sends the answer to Seller staff to approve
   * instead of applying it. Cosmetic — the reply says what happened.
   */
  readonly mode?: 'OFF' | 'ASK_SELLER' | 'DIRECT' | undefined;
  /** Shown in the title when the caller knows it; the id is no use to a person. */
  readonly orderNumber?: string | undefined;
  readonly triggerLabel?: string;
  readonly triggerVariant?: 'primary' | 'secondary';
}): ReactElement {
  const toast = useToast();
  const decide = useDecideStoreCallReview();
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<Decision>('REQUEST_MORE_ATTEMPTS');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const releasing = decision === 'RELEASE';
  const heldForSeller = mode === 'ASK_SELLER';
  const units = `${review.heldQty} unit${review.heldQty === 1 ? '' : 's'}`;
  const tries = `${review.attemptCount} time${review.attemptCount === 1 ? '' : 's'}`;
  // Only the destructive branch insists on one — see the note above —
  // unless Seller staff approve it, who need to know why either way.
  const missingReason = (releasing || heldForSeller) && note.trim() === '';

  function start(): void {
    setDecision('REQUEST_MORE_ATTEMPTS');
    setNote('');
    setError(null);
    setOpen(true);
  }

  async function send(): Promise<void> {
    setError(null);
    try {
      const out = await decide.mutateAsync({
        reviewId: review.id,
        decision,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });
      if (!out.applied) {
        toast.success(
          'Sent to Seller staff to approve. Nothing changes on the order until they answer.',
        );
        setOpen(false);
        return;
      }
      toast.success(
        releasing
          ? `${units} released back into stock, and the order is rejected.`
          : out.result.orderMoved
            ? 'We will keep trying to reach the customer.'
            : // Honest rather than cheerful: the answer is recorded and the
              // stock is still held, but the order had already moved on and
              // nobody is going to ring anyone.
              'Recorded — but the order had already moved on, so calling did not restart.',
      );
      setOpen(false);
    } catch (err) {
      // Verbatim (FE-2): STORE_ACTION_NOT_ALLOWED when the seller keeps
      // this question, REVIEW_ALREADY_RESOLVED when somebody at the store
      // answered it first, EARLY_RESERVATION_REVIEW_NOT_FOUND.
      setError(serverVerdict(err));
    }
  }

  const commitLabel = heldForSeller
    ? 'Send to your seller to approve'
    : releasing
      ? 'Release the stock and reject the order'
      : 'Keep trying';

  return (
    <>
      <Button variant={triggerVariant} size="sm" onClick={start}>
        {triggerLabel}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
        size="lg"
        tone={releasing ? 'critical' : 'default'}
        icon={releasing ? <TriangleAlert size={18} /> : <PhoneCall size={18} />}
        locked={decide.isPending}
        title={
          orderNumber === undefined
            ? 'Keep trying to reach the customer?'
            : `${orderNumber} — keep trying to reach the customer?`
        }
        description={`We have tried them ${tries} without an answer, and ${units} of your seller’s stock ${review.heldQty === 1 ? 'is' : 'are'} held for this order in the meantime.${heldForSeller ? ' Your seller approves this answer first — nothing happens until Seller staff say yes.' : ''}`}
        footer={
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={decide.isPending}
            >
              Never mind
            </Button>
            <AsyncButton
              type="button"
              variant={releasing ? 'destructive' : 'primary'}
              state={decide.isPending ? 'busy' : undefined}
              labels={{ idle: commitLabel, busy: 'Sending…' }}
              disabled={decide.isPending || missingReason}
              onClick={() => void send()}
            />
          </DialogFooter>
        }
      >
        <div className="ro-decide">
          <ChoiceCards
            label="What should happen"
            hideLegend
            name="call-review-decision"
            columns={1}
            value={releasing ? 'RELEASE' : 'REQUEST_MORE_ATTEMPTS'}
            onChange={(v) => setDecision(v === 'RELEASE' ? 'RELEASE' : 'REQUEST_MORE_ATTEMPTS')}
            options={[
              {
                value: 'REQUEST_MORE_ATTEMPTS',
                icon: <PhoneCall size={16} />,
                title: 'Keep trying',
                description:
                  'The order goes back into the call queue and we ring the customer again. The stock stays held for it in the meantime.',
              },
              {
                value: 'RELEASE',
                icon: <PhoneOff size={16} />,
                title: 'Give up on this order',
                description: 'The held stock goes back so other orders can use it.',
              },
            ]}
          />

          {/* The consequence, in full, only on the branch that has one.
              It is two separate facts and people reliably read only the
              first, so the order half is said last and said plainly. */}
          {releasing ? (
            <Notice tone="bad" role="status" icon={<TriangleAlert size={16} />}>
              <span>
                This cannot be undone. {units} return to available stock,{' '}
                <strong>and the order is rejected</strong> — nobody will call the customer again and
                nothing will be sent to them. If you want to try them yourself first, choose “Keep
                trying” instead.
              </span>
            </Notice>
          ) : null}

          <TextArea
            id="call-review-note"
            label={releasing ? 'Why you are giving up on it' : heldForSeller ? 'Why' : 'Note'}
            hint={
              heldForSeller
                ? 'Seller staff read this before they approve or reject your answer.'
                : releasing
                  ? 'Kept on the order. Your seller reads this when they ask why the sale was rejected.'
                  : 'Optional — anything the call centre should know.'
            }
            requiredMark={releasing || heldForSeller}
            rows={3}
            maxLength={1000}
            showCount
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          {error !== null ? (
            <Notice tone="bad" role="alert" icon={<OctagonX size={16} />}>
              <span>{error}</span>
            </Notice>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}
