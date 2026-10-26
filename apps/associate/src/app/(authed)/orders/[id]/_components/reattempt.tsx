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
import { useLocale, useT } from '@/i18n/client';
import { formatDateTime } from '@/i18n/format';
import { verdict } from '@/i18n/verdict';
import { useMyOrderActions, useRequestReattempt } from '@/lib/order-hooks';
import { Notice, Section } from '../../../_components/parts';

// The history names all three actions (`reattempt.action.*`): the key is built from
// the action itself, so a new action fails to compile here until it has both words.

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
  const t = useT();
  const locale = useLocale();
  const actions = useMyOrderActions(orderId);
  const submit = useRequestReattempt();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (actions.isPending) {
    return <SkeletonRows rows={2} cols={3} label={t('reattempt.loading')} />;
  }
  if (actions.isError) {
    return <ErrorState message={verdict(actions.error, t)} retry={() => void actions.refetch()} />;
  }

  const mode = actions.data.allowed.reattempt ?? 'OFF';
  const history = actions.data.items;
  // Nothing to offer and nothing to show: the section does not exist.
  if (mode === 'OFF' && history.length === 0) return <></>;
  const waits = mode === 'ASK_SELLER';
  const words = waits ? t('reattempt.words.waits') : t('reattempt.words.direct');

  async function send(): Promise<void> {
    setError(null);
    try {
      const out = await submit.mutateAsync({ orderId, reason: reason.trim() });
      // The courier can turn it down; that comes back FAILED with why.
      if (out.request.status === 'FAILED') {
        setError(out.request.executionError ?? t('reattempt.couldNot'));
        return;
      }
      toast.success(out.awaitingSeller ? t('reattempt.toast.waits') : t('reattempt.toast.sent'));
      setAsking(false);
      setReason('');
    } catch (err) {
      // Verbatim (FE-2): DELIVERY_ACTION_REASON_TOO_SHORT,
      // DELIVERY_ACTION_ALREADY_OPEN, STORE_ACTION_NOT_ALLOWED…
      setError(verdict(err, t));
    }
  }

  return (
    <Section title={t('reattempt.title')} note={t('reattempt.note')}>
      <div className="as-stack as-stack--tight">
        {mode === 'OFF' ? (
          <p className="as-p">{t('reattempt.off')}</p>
        ) : !stageOpen ? (
          <p className="as-p">{t('reattempt.closedStage')}</p>
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
              {t('reattempt.try')}
            </Button>
            <span className="as-offer__note">
              {waits ? <Clock size={13} aria-hidden /> : <Zap size={13} aria-hidden />}
              {waits ? t('reattempt.offer.waits') : t('reattempt.offer.direct')}
            </span>
          </div>
        )}

        {history.length > 0 ? (
          <Table caption={t('reattempt.table.caption')}>
            <THead>
              <Tr>
                <Th>{t('reattempt.col.asked')}</Th>
                <Th>{t('reattempt.col.when')}</Th>
                <Th>{t('reattempt.col.status')}</Th>
              </Tr>
            </THead>
            <TBody>
              {history.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <div>{t(`reattempt.action.${r.action}`)}</div>
                    <span className="as-sub">{r.reason}</span>
                  </Td>
                  <Td>
                    <span className="as-muted sk-figure">
                      {formatDateTime(r.createdAt, locale)}
                    </span>
                  </Td>
                  <Td>
                    <StatusChip
                      kind={deliveryActionStatusKind(r.status)}
                      label={deliveryActionStatusLabel(r.status, locale)}
                      size="sm"
                    />
                    {r.decisionNote !== null ? (
                      <p className="as-quote">
                        {t('reattempt.theySaid', { note: r.decisionNote })}
                      </p>
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
        title={t('reattempt.try')}
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
              {t('reattempt.dialog.neverMind')}
            </Button>
            <AsyncButton
              type="button"
              variant="primary"
              state={submit.isPending ? 'busy' : undefined}
              labels={{ idle: t('reattempt.dialog.send'), busy: t('reattempt.dialog.sending') }}
              onClick={() => setConfirming(true)}
              disabled={submit.isPending}
            />
          </DialogFooter>
        }
      >
        <div className="as-stack as-stack--tight">
          <TextArea
            id="reattempt-reason"
            label={t('reattempt.dialog.what')}
            hint={t('reattempt.dialog.hint')}
            requiredMark
            rows={4}
            maxLength={2000}
            showCount
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('reattempt.dialog.placeholder')}
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
        title={t('reattempt.confirm.title')}
        entity={orderNumber}
        entityIsIdentifier
        consequence={words}
        confirmLabel={t('reattempt.dialog.send')}
        cancelLabel={t('reattempt.confirm.back')}
        // Resolves whatever the answer: a refusal is shown in the dialog
        // behind, which stays open where the words being sent still are.
        onConfirm={() => send()}
      >
        {reason.trim() !== '' ? <p className="as-quote">“{reason.trim()}”</p> : null}
      </ConfirmDialog>
    </Section>
  );
}
