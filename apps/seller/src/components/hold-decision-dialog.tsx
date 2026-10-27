'use client';

import { useState, type ReactElement } from 'react';
import { Ident, Num } from '@skydrop/ui/components';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { ChoiceCards } from '@skydrop/ui/app/choice-cards';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import { PhoneOff, RotateCw, Unlock } from 'lucide-react';
import { InlineError, mutationPhase } from '@/app/(authed)/inventory/_components/stock-ui';
import { useDecideHoldReview, type ReviewView } from '@/lib/ops-hooks';
import { verdict } from '@/i18n/verdict';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';

/**
 * "We rang your customer and nobody answered. Keep trying, or let it go?"
 *
 * ── ONE COPY, TWO PLACES (2026-09-27) ────────────────────────────────
 * This used to live inside the held-stock page and nowhere else, which
 * is why the decision was unreachable from the order it is about — the
 * order page offered Cancel and nothing else, while `/needs-attention`
 * told sellers to open the order and decide there. It is now rendered
 * from BOTH the register and the order page, from this one file: a
 * money-and-stock decision with two implementations is how the two come
 * to disagree about what "let it go" does.
 *
 * ── WHY THE UNITS ARE CONDITIONAL ────────────────────────────────────
 * `heldQty` is ZERO for most sellers, and that is correct rather than
 * missing data: an at-placement hold is opt-in
 * (`inventory.early_reservation_enabled`), and the review is raised
 * whatever the answer — the question is about CALLING, not only about
 * stock. So every sentence about units is written twice, and the
 * zero-held version does not mention them at all. Leading with
 * "0 units held" made the one thing waiting on the seller read as an
 * empty screen.
 *
 * ── WHAT EACH CHOICE ACTUALLY DOES ───────────────────────────────────
 * RELEASE rejects the order (REJECTED_NDR) and gives back any hold.
 * REQUEST_MORE_ATTEMPTS puts it back in the call queue
 * (PENDING_CONFIRMATION) and keeps the hold. Both are the server's
 * doing, through the one PATCH this dialog sends; the copy names the
 * outcome rather than describing a UI state.
 */
export function HoldDecisionDialog({
  review,
  orderNumber,
  onClose,
}: {
  readonly review: ReviewView | null;
  /** Shown instead of a truncated uuid when the caller knows it. */
  readonly orderNumber?: string | undefined;
  readonly onClose: () => void;
}): ReactElement {
  const t = useT();
  const toast = useToast();
  const decide = useDecideHoldReview();
  // KEEP TRYING is the default, not RELEASE (2026-09-27). The register
  // page opened on the destructive choice because it was framed as
  // "release the stock". Letting the order go is terminal — the seller
  // can let it go tomorrow, and cannot un-reject it — so the reversible
  // choice is the one to land on. Neither is performed until it is
  // picked and submitted; this only decides what is highlighted.
  const [decision, setDecision] = useState<'RELEASE' | 'REQUEST_MORE_ATTEMPTS'>(
    'REQUEST_MORE_ATTEMPTS',
  );
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Letting the order go is a terminal reject, so it is confirmed once
  // more, naming the order — the same shape the send-back on the
  // delivery-trouble panel uses.
  const [confirmRelease, setConfirmRelease] = useState(false);
  const held = review?.heldQty ?? 0;
  const label = orderNumber ?? (review === null ? '' : `${review.orderId.slice(0, 8)}…`);

  async function submit(): Promise<void> {
    if (review === null) return;
    setError(null);
    try {
      const result = await decide.mutateAsync({
        reviewId: review.id,
        decision,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });
      toast.success(
        decision === 'RELEASE'
          ? review.heldQty > 0
            ? t('holdDecision.orderLetGoUnit', {
                heldQty: review.heldQty,
                plural: review.heldQty === 1 ? '' : 's',
              })
            : t('holdDecision.orderLetGoNo')
          : result.orderMoved
            ? t('holdDecision.weWillKeepTrying')
            : t('holdDecision.recordedTheOrderHad'),
      );
      setNote('');
      setConfirmRelease(false);
      onClose();
    } catch (err) {
      setError(verdict(err, t));
      setConfirmRelease(false);
      // Rethrown so ConfirmDialog stops being busy; the message is
      // already on the dialog behind it.
      throw err;
    }
  }

  return (
    <>
      <Dialog
        open={review !== null}
        onOpenChange={(next) => {
          if (!next) {
            setError(null);
            onClose();
          }
        }}
        size="md"
        icon={<PhoneOff size={18} />}
        locked={decide.isPending}
        title={t('holdDecision.weCouldNotReach')}
        description={
          review === null ? undefined : held > 0 ? (
            <>
              {richMessage(t('holdDecision.weHaveTriedTime'), {
                attemptCount: review.attemptCount,
                plural: review.attemptCount === 1 ? '' : 's',
                held,
                plural2: held === 1 ? '' : 's',
              })}
            </>
          ) : (
            <>
              {richMessage(t('holdDecision.weHaveTriedTime2'), {
                attemptCount: review.attemptCount,
                plural: review.attemptCount === 1 ? '' : 's',
              })}
            </>
          )
        }
        footer={
          <DialogFooter>
            <Button variant="ghost" size="md" onClick={onClose} disabled={decide.isPending}>
              {t('holdDecision.cancel')}
            </Button>
            <AsyncButton
              variant={decision === 'RELEASE' ? 'destructive' : 'primary'}
              size="md"
              icon={decision === 'RELEASE' ? <Unlock size={16} /> : <RotateCw size={16} />}
              labels={{
                idle:
                  decision === 'RELEASE' ? t('holdDecision.letItGo') : t('holdDecision.keepTrying'),
                busy: t('holdDecision.saving'),
              }}
              state={mutationPhase(decide)}
              disabled={decide.isPending}
              onClick={() => {
                if (decision === 'RELEASE') setConfirmRelease(true);
                else void submit();
              }}
            />
          </DialogFooter>
        }
      >
        <div className="inv-stack">
          {review !== null && (
            <div className="inv-callout" data-tone="warn">
              <span>
                {t('holdDecision.order')} <Ident value={label} /> ·{' '}
                <Num value={review.attemptCount} /> {review.attemptCount === 1 ? 'call' : 'calls'}{' '}
                made
                {held > 0 && (
                  <>
                    {' · '}
                    <Num value={held} /> {held === 1 ? 'unit' : 'units'} held
                  </>
                )}
              </span>
            </div>
          )}

          <ChoiceCards
            label={t('holdDecision.decision')}
            hideLegend
            name="hold-decision"
            columns={1}
            value={decision}
            onChange={(v) => setDecision(v as 'RELEASE' | 'REQUEST_MORE_ATTEMPTS')}
            options={[
              {
                value: 'RELEASE',
                title: t('holdDecision.letItGo'),
                description:
                  held > 0
                    ? t('holdDecision.theOrderIsRejected')
                    : t('holdDecision.theOrderIsRejected2'),
                icon: <Unlock size={16} />,
              },
              {
                value: 'REQUEST_MORE_ATTEMPTS',
                title: t('holdDecision.keepTrying'),
                description:
                  held > 0
                    ? t('holdDecision.theOrderGoesBack')
                    : t('holdDecision.theOrderGoesBack2'),
                icon: <RotateCw size={16} />,
              },
            ]}
          />

          <TextArea
            label={t('holdDecision.note')}
            id="hold-note"
            hint={t('holdDecision.optionalAnythingYouKnow')}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          {error !== null && <InlineError message={error} />}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmRelease}
        onOpenChange={setConfirmRelease}
        title={t('holdDecision.letThisOrderGo')}
        entity={label === '' ? t('holdDecision.thisOrder') : label}
        entityIsIdentifier={label !== ''}
        consequence={
          held > 0 ? t('holdDecision.theOrderIsRejected3') : t('holdDecision.theOrderIsRejected4')
        }
        confirmLabel={t('holdDecision.letItGo')}
        destructive
        closeOnSuccess={false}
        onConfirm={() => submit()}
      />
    </>
  );
}
