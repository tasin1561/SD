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
import { richMessage, useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
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
  triggerLabel,
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
  const t = useT();
  const toast = useToast();
  const decide = useDecideStoreCallReview();
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<Decision>('REQUEST_MORE_ATTEMPTS');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const releasing = decision === 'RELEASE';
  const heldForSeller = mode === 'ASK_SELLER';
  const units = t(review.heldQty === 1 ? 'callrev.units.one' : 'callrev.units.other', {
    n: review.heldQty,
  });
  const tries = t(review.attemptCount === 1 ? 'callrev.tries.one' : 'callrev.tries.other', {
    n: review.attemptCount,
  });
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
        toast.success(t('callrev.toast.sentToSeller'));
        setOpen(false);
        return;
      }
      toast.success(
        releasing
          ? t('callrev.toast.released', { units })
          : out.result.orderMoved
            ? t('callrev.toast.keepTrying')
            : // Honest rather than cheerful: the answer is recorded and the
              // stock is still held, but the order had already moved on and
              // nobody is going to ring anyone.
              t('callrev.toast.movedOn'),
      );
      setOpen(false);
    } catch (err) {
      // Verbatim (FE-2): STORE_ACTION_NOT_ALLOWED when the seller keeps
      // this question, REVIEW_ALREADY_RESOLVED when somebody at the store
      // answered it first, EARLY_RESERVATION_REVIEW_NOT_FOUND.
      setError(verdict(err, t));
    }
  }

  const commitLabel = heldForSeller
    ? t('callrev.commit.seller')
    : releasing
      ? t('callrev.commit.release')
      : t('callrev.commit.keep');

  return (
    <>
      <Button variant={triggerVariant} size="sm" onClick={start}>
        {triggerLabel ?? t('callrev.answer')}
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
            ? t('callrev.title')
            : t('callrev.titleOrder', { order: orderNumber })
        }
        description={`${t('callrev.desc', {
          tries,
          units,
          verb: t(review.heldQty === 1 ? 'callrev.verb.one' : 'callrev.verb.other'),
        })}${heldForSeller ? t('callrev.desc.seller') : ''}`}
        footer={
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={decide.isPending}
            >
              {t('callrev.neverMind')}
            </Button>
            <AsyncButton
              type="button"
              variant={releasing ? 'destructive' : 'primary'}
              state={decide.isPending ? 'busy' : undefined}
              labels={{ idle: commitLabel, busy: t('callrev.sending') }}
              disabled={decide.isPending || missingReason}
              onClick={() => void send()}
            />
          </DialogFooter>
        }
      >
        <div className="ro-decide">
          <ChoiceCards
            label={t('callrev.choose')}
            hideLegend
            name="call-review-decision"
            columns={1}
            value={releasing ? 'RELEASE' : 'REQUEST_MORE_ATTEMPTS'}
            onChange={(v) => setDecision(v === 'RELEASE' ? 'RELEASE' : 'REQUEST_MORE_ATTEMPTS')}
            options={[
              {
                value: 'REQUEST_MORE_ATTEMPTS',
                icon: <PhoneCall size={16} />,
                title: t('callrev.keep.title'),
                description: t('callrev.keep.desc'),
              },
              {
                value: 'RELEASE',
                icon: <PhoneOff size={16} />,
                title: t('callrev.release.title'),
                description: t('callrev.release.desc'),
              },
            ]}
          />

          {/* The consequence, in full, only on the branch that has one.
              It is two separate facts and people reliably read only the
              first, so the order half is said last and said plainly. */}
          {releasing ? (
            <Notice tone="bad" role="status" icon={<TriangleAlert size={16} />}>
              <span>
                {richMessage(t('callrev.release.note', { units }), {
                  rejected: <strong>{t('callrev.release.noteBold')}</strong>,
                })}
              </span>
            </Notice>
          ) : null}

          <TextArea
            id="call-review-note"
            label={
              releasing
                ? t('callrev.note.release')
                : heldForSeller
                  ? t('callrev.note.seller')
                  : t('callrev.note.plain')
            }
            hint={
              heldForSeller
                ? t('callrev.hint.seller')
                : releasing
                  ? t('callrev.hint.release')
                  : t('callrev.hint.plain')
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
