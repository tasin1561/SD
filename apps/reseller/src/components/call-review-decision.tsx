'use client';

import { useState, type ReactElement } from 'react';
import { Button, FormField, Modal, ModalFooter, Textarea, useToast } from '@skydrop/ui/components';
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
}: {
  readonly review: StoreCallReview;
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
  const units = `${review.heldQty} unit${review.heldQty === 1 ? '' : 's'}`;
  const tries = `${review.attemptCount} time${review.attemptCount === 1 ? '' : 's'}`;
  // Only the destructive branch insists on one — see the note above.
  const missingReason = releasing && note.trim() === '';

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
      toast.success(
        releasing
          ? `${units} released back into stock, and the order is rejected.`
          : out.orderMoved
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

  return (
    <>
      <Button variant={triggerVariant} size="sm" onClick={start}>
        {triggerLabel}
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
        size="lg"
        tone={releasing ? 'critical' : 'default'}
        title={
          orderNumber === undefined
            ? 'Keep trying to reach the customer?'
            : `${orderNumber} — keep trying to reach the customer?`
        }
        description={`We have tried them ${tries} without an answer, and ${units} of your seller’s stock ${review.heldQty === 1 ? 'is' : 'are'} held for this order in the meantime.`}
      >
        <div className="space-y-4">
          <fieldset>
            <legend className="sr-only">What should happen</legend>
            <div className="space-y-2">
              <label className="border-border hover:bg-surface-hover flex cursor-pointer items-start gap-2 rounded-[var(--radius-2)] border px-3 py-2">
                <input
                  type="radio"
                  name="call-review-decision"
                  className="mt-1"
                  checked={!releasing}
                  onChange={() => setDecision('REQUEST_MORE_ATTEMPTS')}
                />
                <span>
                  <span className="text-text-strong block text-sm">Keep trying</span>
                  <span className="text-text-muted block text-xs leading-relaxed">
                    The order goes back into the call queue and we ring the customer again. The
                    stock stays held for it in the meantime.
                  </span>
                </span>
              </label>

              <label className="border-border hover:bg-surface-hover flex cursor-pointer items-start gap-2 rounded-[var(--radius-2)] border px-3 py-2">
                <input
                  type="radio"
                  name="call-review-decision"
                  className="mt-1"
                  checked={releasing}
                  onChange={() => setDecision('RELEASE')}
                />
                <span>
                  <span className="text-text-strong block text-sm">Give up on this order</span>
                  <span className="text-text-muted block text-xs leading-relaxed">
                    The held stock goes back so other orders can use it.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          {/* The consequence, in full, only on the branch that has one.
              It is two separate facts and people reliably read only the
              first, so the order half is said last and said plainly. */}
          {releasing ? (
            <p
              role="status"
              className="border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] text-critical rounded-[var(--radius-2)] border px-3 py-2 text-xs leading-relaxed"
            >
              This cannot be undone. {units} return to available stock,{' '}
              <strong>and the order is rejected</strong> — nobody will call the customer again and
              nothing will be sent to them. If you want to try them yourself first, choose “Keep
              trying” instead.
            </p>
          ) : null}

          <FormField
            label={releasing ? 'Why you are giving up on it' : 'Note'}
            htmlFor="call-review-note"
            hint={
              releasing
                ? 'Kept on the order. Your seller reads this when they ask why the sale was rejected.'
                : 'Optional — anything the call centre should know.'
            }
            required={releasing}
          >
            <Textarea
              id="call-review-note"
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </FormField>

          {error !== null ? (
            <p role="alert" className="text-critical text-sm">
              {error}
            </p>
          ) : null}

          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setOpen(false)}
              disabled={decide.isPending}
            >
              Never mind
            </Button>
            <Button
              type="button"
              variant={releasing ? 'destructive' : 'primary'}
              size="md"
              disabled={decide.isPending || missingReason}
              onClick={() => void send()}
            >
              {decide.isPending
                ? 'Sending…'
                : releasing
                  ? 'Release the stock and reject the order'
                  : 'Keep trying'}
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    </>
  );
}
