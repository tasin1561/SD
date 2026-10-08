'use client';

import { useState, type ReactElement } from 'react';
import { Clock, OctagonX, Truck, Zap } from 'lucide-react';
import { deliveryActionStatusKind, deliveryActionStatusLabel } from '@skydrop/ui/status';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea } from '@skydrop/ui/app/text-field';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
// The shell mounts the legacy <Toaster>; the app `useToast` would throw
// outside its own provider, so this keeps the legacy hook (same API).
import { useToast } from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { useMyOrderActions, useRequestReattempt } from '@/lib/order-hooks';
import { Notice, Section } from '../../../_components/parts';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/** How the history names the other two, which the store may also have asked for. */
function actionLabel(action: MyAction): string {
  switch (action) {
    case 'REATTEMPT':
      return 'Try delivering again';
    case 'RECALL':
      return 'Call the customer again';
    case 'RTO':
      return 'Send it back';
    default: {
      const exhaustive: never = action;
      throw new Error(`Unhandled action: ${String(exhaustive)}`);
    }
  }
}

type MyAction = 'RECALL' | 'REATTEMPT' | 'RTO';

/**
 * ASSOC-1 — "can cancel and ask for a reattempt" (the owner's words).
 *
 * ── WHY THIS IS NOT "RAISE AN ISSUE" ────────────────────────────────
 * Raising an issue starts a conversation with Skydrop. This DISPATCHES A
 * VAN. A customer who says "I was out, try tomorrow" needs the second,
 * and offering only the first would make an associate wait on a thread
 * for something a courier could do that afternoon.
 *
 * ── WHAT THE PORTAL DOES NOT DECIDE ─────────────────────────────────
 * Whether the ask is carried out now or held for Seller staff is the
 * seller's `reattempt` policy, and the SERVER answers it twice: in
 * `allowed.reattempt` (so the note beside the button is honest before
 * anybody clicks) and again in the reply's `awaitingSeller` (which is
 * the one that counts, because Seller staff may have changed the policy
 * since this page loaded). The page never predicts the refusal — OFF is
 * simply not rendered, and everything else arrives verbatim (FE-2).
 *
 * "We have asked them" rather than "done" on a held request is the
 * load-bearing sentence here: an associate who believes a van is coming
 * will say so to a customer.
 *
 * Only RE-ATTEMPT. A send-back turns a parcel round at somebody's cost
 * on one click and a recall spends the call centre's time; both stay the
 * store's own to ask for. The HISTORY still names all three, because the
 * store may have asked for one on this parcel and an associate reading
 * "nothing asked" when something was is worse than an unfamiliar word.
 */
export function Reattempt({
  orderId,
  orderNumber,
  stageOpen,
}: {
  readonly orderId: string;
  /** Restated in the confirm; display only. */
  readonly orderNumber: string;
  /** The parcel is out for delivery or has just failed — the only time this applies. */
  readonly stageOpen: boolean;
}): ReactElement {
  const actions = useMyOrderActions(orderId);
  const submit = useRequestReattempt();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (actions.isPending) {
    return <SkeletonRows rows={2} cols={3} label="Loading what you can ask for" />;
  }
  if (actions.isError) {
    return (
      <ErrorState message={serverVerdict(actions.error)} retry={() => void actions.refetch()} />
    );
  }

  const mode = actions.data.allowed.reattempt ?? 'OFF';
  const history = actions.data.items;
  // Nothing to offer and nothing to show: the section does not exist.
  if (mode === 'OFF' && history.length === 0) return <></>;
  const waits = mode === 'ASK_SELLER';
  const words = waits
    ? 'Your store has to approve this. Nothing happens to the parcel until they answer, so do not tell your customer a van is coming yet.'
    : 'The courier is asked to attempt the delivery again, as soon as you send this.';

  async function send(): Promise<void> {
    setError(null);
    try {
      const out = await submit.mutateAsync({ orderId, reason: reason.trim() });
      // The courier can turn it down; that comes back FAILED with why.
      if (out.request.status === 'FAILED') {
        setError(out.request.executionError ?? 'It could not be carried out.');
        return;
      }
      toast.success(
        out.awaitingSeller
          ? 'Your store has to approve this — we have asked them. Nothing happens until they answer.'
          : 'The courier has been asked to try again.',
      );
      setAsking(false);
      setReason('');
    } catch (err) {
      // Verbatim (FE-2): DELIVERY_ACTION_REASON_TOO_SHORT,
      // DELIVERY_ACTION_ALREADY_OPEN, STORE_ACTION_NOT_ALLOWED…
      setError(serverVerdict(err));
    }
  }

  return (
    <Section
      title="The delivery did not work?"
      note="Ask the courier to try again. What you can ask for is set by your store."
    >
      <div className="as-stack as-stack--tight">
        {mode === 'OFF' ? (
          <p className="as-p">Your store has not enabled this for you.</p>
        ) : !stageOpen ? (
          <p className="as-p">
            Another delivery attempt can be asked for only while the parcel is out for delivery or
            has just failed to deliver.
          </p>
        ) : (
          <div className="as-offer">
            <Button
              variant="secondary"
              icon={<Truck size={15} />}
              onClick={() => {
                setError(null);
                setReason('');
                setAsking(true);
              }}
            >
              Try delivering again
            </Button>
            <span className="as-offer__note">
              {waits ? <Clock size={13} aria-hidden /> : <Zap size={13} aria-hidden />}
              {waits
                ? 'Your store approves this before anything happens'
                : 'Happens as soon as you ask'}
            </span>
          </div>
        )}

        {history.length > 0 ? (
          <Table caption="What has been asked for on this parcel">
            <THead>
              <Tr>
                <Th>What was asked</Th>
                <Th>When</Th>
                <Th>Where it got to</Th>
              </Tr>
            </THead>
            <TBody>
              {history.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <div>{actionLabel(r.action)}</div>
                    <span className="as-sub">{r.reason}</span>
                  </Td>
                  <Td>
                    <span className="as-muted sk-figure">{when(r.createdAt)}</span>
                  </Td>
                  <Td>
                    <StatusChip
                      kind={deliveryActionStatusKind(r.status)}
                      label={deliveryActionStatusLabel(r.status)}
                      size="sm"
                    />
                    {r.decisionNote !== null ? (
                      <p className="as-quote">They said: “{r.decisionNote}”</p>
                    ) : null}
                    {r.executionError !== null ? (
                      <span className="as-sub as-tone-bad">{r.executionError}</span>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : null}
      </div>

      <Dialog
        open={asking}
        onOpenChange={setAsking}
        title="Try delivering again"
        description={words}
        icon={<Truck size={18} />}
        locked={submit.isPending}
        footer={
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAsking(false)}
              disabled={submit.isPending}
            >
              Never mind
            </Button>
            <AsyncButton
              type="button"
              variant="primary"
              state={submit.isPending ? 'busy' : undefined}
              labels={{ idle: 'Send it', busy: 'Sending…' }}
              onClick={() => setConfirming(true)}
              disabled={submit.isPending}
            />
          </DialogFooter>
        }
      >
        <div className="as-stack as-stack--tight">
          <TextArea
            id="reattempt-reason"
            label="What happened"
            hint="At least a sentence — a person reads this before a van is sent."
            requiredMark
            rows={4}
            maxLength={2000}
            showCount
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Say what changed — a corrected landmark, a time they will be in."
          />
          {error !== null ? (
            <Notice tone="bad" role="alert" icon={<OctagonX size={16} />}>
              <span>{error}</span>
            </Notice>
          ) : null}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirming && asking}
        onOpenChange={setConfirming}
        title="Ask for another delivery attempt?"
        entity={orderNumber}
        entityIsIdentifier
        consequence={words}
        confirmLabel="Send it"
        cancelLabel="Back"
        // Resolves whatever the answer: a refusal is shown in the dialog
        // behind, which stays open where the words being sent still are.
        onConfirm={() => send()}
      >
        {reason.trim() !== '' ? <p className="as-quote">“{reason.trim()}”</p> : null}
      </ConfirmDialog>
    </Section>
  );
}
