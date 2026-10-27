'use client';

import { useState, type ReactElement } from 'react';
import { Clock, OctagonX, PhoneCall, RotateCcw, Truck, Undo2, Zap } from 'lucide-react';
// The layout mounts the legacy <Toaster>; the app `useToast` would throw
// outside its own provider, so this keeps the legacy hook (same API).
import { useToast } from '@skydrop/ui/components';
import { deliveryActionStatusKind, deliveryActionStatusLabel } from '@skydrop/ui/status';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea } from '@skydrop/ui/app/text-field';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import type { MessageKey } from '@/i18n/catalog';
import { useLocale, useT } from '@/i18n/client';
import { formatDateTime } from '@/i18n/format';
import { verdict } from '@/i18n/verdict';
import {
  useRequestStoreAction,
  useStoreOrderActions,
  type StoreActionKind,
} from '@/lib/order-hooks';
import { Notice, RoSection } from '../../_components/orders-parts';

/**
 * The three things a store can ask for about a live parcel, and what it
 * has asked for before.
 *
 * WHICH ones are offered is the SELLER's policy for this store, read
 * from the server with the requests (`allowed`). A capability they
 * switched off is not rendered at all — an offered button that always
 * refuses teaches people to ignore refusals. One set to "ask the seller"
 * is offered and says so, because the difference matters to whoever has
 * a customer waiting on the answer.
 */
const ACTIONS: ReadonlyArray<{
  readonly kind: StoreActionKind;
  /** The policy column that governs it. */
  readonly capability: string;
  readonly label: MessageKey;
  readonly ask: MessageKey;
}> = [
  {
    kind: 'RECALL',
    capability: 'recall',
    label: 'ordact.recall.label',
    ask: 'ordact.recall.ask',
  },
  {
    kind: 'REATTEMPT',
    capability: 'reattempt',
    label: 'ordact.reattempt.label',
    ask: 'ordact.reattempt.ask',
  },
  {
    kind: 'RTO',
    capability: 'sendBack',
    label: 'ordact.rto.label',
    ask: 'ordact.rto.ask',
  },
];

function actionLabelKey(kind: StoreActionKind): MessageKey | undefined {
  return ACTIONS.find((a) => a.kind === kind)?.label;
}

function actionIcon(kind: StoreActionKind): ReactElement {
  switch (kind) {
    case 'RECALL':
      return <PhoneCall size={15} />;
    case 'REATTEMPT':
      return <Truck size={15} />;
    case 'RTO':
      return <Undo2 size={15} />;
  }
}

/**
 * Asking for one of the three runs through two steps: the dialog that
 * collects what happened, then a confirm that restates the order, the
 * act and whether it happens now or waits for the seller — both before
 * the SAME request. A refusal lands back in the first dialog, as before.
 */
export function OrderActions({
  orderId,
  orderNumber,
  stageOpen,
}: {
  orderId: string;
  /** Shown in the confirm; display only. */
  orderNumber: string;
  /** The order is out for delivery or has just failed — the only time these apply. */
  stageOpen: boolean;
}): ReactElement {
  const t = useT();
  const locale = useLocale();
  const actions = useStoreOrderActions(orderId);
  const submit = useRequestStoreAction();
  const toast = useToast();
  const [asking, setAsking] = useState<(typeof ACTIONS)[number] | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function send(): Promise<void> {
    if (asking === null) return;
    setError(null);
    try {
      const out = await submit.mutateAsync({
        orderId,
        action: asking.kind,
        reason: reason.trim(),
      });
      // The REPLY says what actually happened (2026-09-17): waiting on
      // Seller staff, done, or refused — a send-back the courier turns
      // down comes back FAILED with the reason.
      if (out.request.status === 'FAILED') {
        setError(out.request.executionError ?? t('ordact.failedFallback'));
        return;
      }
      toast.success(out.awaitingSeller ? t('ordact.toast.sentToSeller') : t('ordact.toast.done'));
      setAsking(null);
      setReason('');
    } catch (err) {
      // Verbatim (FE-2): DELIVERY_ACTION_REASON_TOO_SHORT,
      // DELIVERY_ACTION_ALREADY_OPEN, STORE_ACTION_NOT_ALLOWED…
      setError(verdict(err, t));
    }
  }

  if (actions.isPending) {
    return <SkeletonRows rows={2} cols={3} label={t('ordact.loading')} />;
  }
  if (actions.isError) {
    return <ErrorState message={verdict(actions.error, t)} retry={() => void actions.refetch()} />;
  }

  const labelOf = (kind: StoreActionKind): string => {
    const key = actionLabelKey(kind);
    return key === undefined ? kind : t(key);
  };
  const offered = ACTIONS.filter((a) => actions.data.allowed[a.capability] !== 'OFF');
  const history = actions.data.items;
  if (offered.length === 0 && history.length === 0) return <></>;
  const askingWaits = asking !== null && actions.data.allowed[asking.capability] === 'ASK_SELLER';
  const askingWords =
    asking === null ? undefined : askingWaits ? t('ordact.waitsSeller') : t('ordact.immediate');

  return (
    <RoSection title={t('ordact.title')} note={t('ordact.note')}>
      <div className="ro-stack">
        {offered.length === 0 ? (
          <p className="ro-p">{t('ordact.noneEnabled')}</p>
        ) : !stageOpen ? (
          <p className="ro-p">{t('ordact.stageClosed')}</p>
        ) : (
          <ul className="ro-offers">
            {offered.map((a) => {
              const waits = actions.data.allowed[a.capability] === 'ASK_SELLER';
              return (
                <li key={a.kind} className="ro-offer">
                  <Button
                    variant="secondary"
                    icon={actionIcon(a.kind)}
                    onClick={() => {
                      setError(null);
                      setReason('');
                      setAsking(a);
                    }}
                  >
                    {t(a.label)}
                  </Button>
                  <span className="ro-offer__note">
                    {waits ? <Clock size={13} aria-hidden /> : <Zap size={13} aria-hidden />}
                    {waits ? t('ordact.approvesFirst') : t('ordact.happensNow')}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {history.length > 0 ? (
          <Table caption={t('ordact.history.caption')}>
            <THead>
              <Tr>
                <Th>{t('ordact.col.asked')}</Th>
                <Th>{t('ordact.col.when')}</Th>
                <Th>{t('ordact.col.state')}</Th>
              </Tr>
            </THead>
            <TBody>
              {history.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <div>{labelOf(r.action)}</div>
                    <span className="ro-sub">{r.reason}</span>
                  </Td>
                  <Td>
                    <span className="ro-muted sk-figure">
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
                      <p className="ro-quote">{t('ordact.theySaid', { note: r.decisionNote })}</p>
                    ) : null}
                    {r.executionError !== null ? (
                      <span className="ro-sub ro-tone-bad">{r.executionError}</span>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : null}
      </div>

      <Dialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) setAsking(null);
        }}
        title={asking === null ? '' : t(asking.label)}
        description={askingWords}
        icon={asking === null ? <RotateCcw size={18} /> : actionIcon(asking.kind)}
        locked={submit.isPending}
        footer={
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAsking(null)}
              disabled={submit.isPending}
            >
              {t('ordact.neverMind')}
            </Button>
            <AsyncButton
              type="button"
              variant="primary"
              state={submit.isPending ? 'busy' : undefined}
              labels={{ idle: t('ordact.send'), busy: t('ordact.sending') }}
              onClick={() => setConfirming(true)}
              disabled={submit.isPending}
            />
          </DialogFooter>
        }
      >
        <div className="ro-stack ro-stack--tight">
          <TextArea
            id="action-reason"
            label={t('ordact.whatHappened')}
            hint={t('ordact.whatHappenedHint')}
            requiredMark
            rows={4}
            maxLength={2000}
            showCount
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={asking === null ? '' : t(asking.ask)}
          />
          {error !== null ? (
            <Notice tone="bad" role="alert" icon={<OctagonX size={16} />}>
              <span>{error}</span>
            </Notice>
          ) : null}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirming && asking !== null}
        onOpenChange={setConfirming}
        title={`${asking === null ? '' : t(asking.label)}?`}
        entity={orderNumber}
        entityIsIdentifier
        consequence={askingWords ?? ''}
        confirmLabel={t('ordact.send')}
        cancelLabel={t('ordact.confirm.back')}
        destructive={asking?.kind === 'RTO'}
        // Resolves whatever the answer: a refusal is shown in the dialog
        // behind, which stays open, exactly where it was shown before.
        onConfirm={() => send()}
      >
        {reason.trim() !== '' ? <p className="ro-quote">“{reason.trim()}”</p> : null}
      </ConfirmDialog>
    </RoSection>
  );
}
