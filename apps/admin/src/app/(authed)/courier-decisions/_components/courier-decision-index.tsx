'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Hand, Truck, X } from 'lucide-react';
import { OrderCancellationReason } from '@skydrop/db';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { TextArea } from '@skydrop/ui/app/text-field';
import { useQueryClient } from '@tanstack/react-query';
import { CANCELLATION_REASONS } from '../../orders/_components/order-actions-panel';
import { usePermission } from '@/lib/use-permission';
import { Button } from '@skydrop/ui/app/button';
import { useToast } from '@skydrop/ui/app/toast';
import { Money } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { AgeChip, OoSection, type AgeTone } from '../../orders/_components/order-ops-parts';
import { InfoButton } from '@/components/easy/info-button';
import '@/components/easy/easy.css';
import './courier-decisions.css';
import {
  useCancelOrder,
  useChooseCourier,
  useCourierDecisionQueue,
  useSendToManualPlacement,
  type CourierOptionRow,
  type WaitingCourierChoice,
} from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { useT } from '@/i18n/client';

/**
 * CUR-17 — parcels held between call confirmation and printing because
 * the seller's policy says a PERSON picks the carrier.
 *
 * ── WHAT SOMEBODY NEEDS TO DECIDE ────────────────────────────────────
 * Price and days, side by side, for every carrier that was actually
 * quoted. Not a dropdown of names: the choice IS the trade between
 * those two numbers, and hiding one of them behind a select turns a
 * decision into a guess.
 *
 * The cheapest and the fastest are marked, because in a list of eight
 * near-identical rows they are the two anybody is looking for, and
 * scanning for them by eye is where a wrong row gets clicked.
 *
 * ── HOW LONG IT HAS WAITED, LOUDLY ───────────────────────────────────
 * A parcel here is confirmed: its stock is reserved and its customer
 * has been told it is coming. Nothing about that is visible from the
 * order list, so the wait is the most prominent thing on the row — and
 * past the TTL the system books the cheapest itself and says so, which
 * is stated on the page rather than left to be discovered.
 */
function waitTone(hours: number): AgeTone {
  if (hours >= 6) return 'late';
  if (hours >= 2) return 'aging';
  return 'fresh';
}

function hoursSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000));
}

function OptionButton({
  option,
  best,
  fastest,
  onPick,
  busy,
}: {
  option: CourierOptionRow;
  best: boolean;
  fastest: boolean;
  onPick: () => void;
  busy: boolean;
}): ReactElement {
  const t = useT();
  return (
    <button type="button" onClick={onPick} disabled={busy} className="oq-option">
      <span className="oq-option__main">
        <span className="oq-option__name">{option.courierName}</span>
        <span className="oo-faint">
          {option.estimatedDays === null
            ? t('courierDecisionsCourierDecisionIndex.noEstimateGiven')
            : t(option.estimatedDays === 1 ? 'ezCourier.day' : 'ezCourier.days', {
                n: option.estimatedDays,
              })}
          {best && t('courierDecisionsCourierDecisionIndex.cheapest')}
          {fastest && t('courierDecisionsCourierDecisionIndex.fastest')}
        </span>
      </span>
      <span className="oq-option__rate sk-figure">
        <Money amount={option.rateInr} />
      </span>
    </button>
  );
}

function Row({ row }: { row: WaitingCourierChoice }): ReactElement {
  const t = useT();
  const choose = useChooseCourier();
  const toManual = useSendToManualPlacement();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const cancel = useCancelOrder(row.orderId);
  const canCancel = usePermission('orders.cancel');
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState<OrderCancellationReason>(OrderCancellationReason.OTHER);
  const [note, setNote] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const busy = choose.isPending || toManual.isPending || cancel.isPending;

  function closeCancel(): void {
    setCancelOpen(false);
    setReason(OrderCancellationReason.OTHER);
    setNote('');
    setCancelError(null);
  }

  // The same sane admin cancel as the order page (NOT god mode): the
  // server decides whether this order can still be cancelled, and its
  // [CODE] message is shown in the dialog as it arrives (FE-2).
  async function confirmCancel(): Promise<void> {
    setCancelError(null);
    try {
      await cancel.mutateAsync({
        cancellationReason: reason,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
    } catch (err) {
      setCancelError(serverVerdict(err));
      throw err;
    }
    closeCancel();
    queryClient.setQueryData<WaitingCourierChoice[]>(['admin-courier-decisions'], (rows) =>
      rows?.filter((r) => r.shipmentId !== row.shipmentId),
    );
    void queryClient.invalidateQueries({ queryKey: ['admin-courier-decisions'] });
    toast.success(
      t('courierDecisionsCourierDecisionIndex.orderCancelled', { orderNo: row.orderNumber }),
    );
  }
  const waited = hoursSince(row.waitingSince);

  // Computed here rather than on the server so the marks always agree
  // with the numbers rendered beside them — a "cheapest" badge that
  // disagrees with the prices on screen is worse than no badge.
  const cheapestId = row.options.reduce<CourierOptionRow | null>(
    (a, b) => (a === null || b.rateInr < a.rateInr ? b : a),
    null,
  )?.courierCompanyId;
  const fastestId = row.options
    .filter((o) => o.estimatedDays !== null)
    .reduce<CourierOptionRow | null>(
      (a, b) => (a === null || (b.estimatedDays ?? 0) < (a.estimatedDays ?? 0) ? b : a),
      null,
    )?.courierCompanyId;

  return (
    <Tr>
      <Td>
        <Link href={`/orders/${row.orderId}`} className="oo-link sk-ident">
          {row.orderNumber}
        </Link>
        <span className="oo-sub">{row.sellerCompanyName}</span>
      </Td>
      <Td>
        <span>{row.destCity || '—'}</span>
        <span className="oo-sub sk-figure">{row.destPostalCode}</span>
      </Td>
      <Td>
        <span className="sk-figure">
          {t('courierDecisionsCourierDecisionIndex.kg', {
            value: (row.totalWeightGrams / 1000).toFixed(2),
          })}
        </span>
        {row.codAmountInr !== null && (
          <span className="oo-sub">
            {t('ezCourier.cod')} <Money amount={row.codAmountInr} />
          </span>
        )}
      </Td>
      <Td>
        <AgeChip tone={waitTone(waited)}>
          {waited < 1
            ? t('courierDecisionsCourierDecisionIndex.justNow')
            : t('ezCourier.hours', { n: waited })}
        </AgeChip>
      </Td>
      <Td>
        {row.options.length === 0 ? (
          <p className="oo-faint">
            {t('courierDecisionsCourierDecisionIndex.noCarriersWereRecordedFor')}
          </p>
        ) : (
          <div className="oq-options">
            {row.options.map((o) => (
              <OptionButton
                key={o.courierCompanyId}
                option={o}
                best={o.courierCompanyId === cheapestId}
                fastest={o.courierCompanyId === fastestId}
                busy={busy}
                onPick={() => {
                  setError(null);
                  choose.mutate(
                    { shipmentId: row.shipmentId, courierCompanyId: o.courierCompanyId },
                    // FE-2 — the server's verdict verbatim. It refuses a
                    // carrier it never offered and a parcel that already
                    // has a waybill, and both of those are things the
                    // person clicking needs to read rather than have
                    // paraphrased.
                    { onError: (e) => setError(serverVerdict(e)) },
                  );
                }}
              />
            ))}
          </div>
        )}
        <div className="oq-alt">
          {/* The way out when no offered carrier should take it: staff place
              it by hand with a backup courier. Nothing is booked here. */}
          <Button
            variant="secondary"
            size="sm"
            className="oq-manual"
            icon={<Hand size={15} aria-hidden />}
            disabled={busy}
            onClick={() => {
              setError(null);
              toManual.mutate(
                { shipmentId: row.shipmentId },
                {
                  onSuccess: () =>
                    toast.success(t('courierDecisionsCourierDecisionIndex.sentToManual')),
                  // FE-2 — the server's [CODE] message as it arrives: a
                  // waybill already made, an order no longer waiting, or a
                  // superseded parcel are each the person's to read.
                  onError: (e) => setError(serverVerdict(e)),
                },
              );
            }}
          >
            {t('courierDecisionsCourierDecisionIndex.sendToManual')}
          </Button>
          {/* Hidden, not disabled, without orders.cancel — as on the order page. */}
          {canCancel && (
            <Button
              variant="ghost"
              size="sm"
              className="oq-manual oq-cancel"
              icon={<X size={15} aria-hidden />}
              disabled={busy}
              onClick={() => setCancelOpen(true)}
            >
              {t('courierDecisionsCourierDecisionIndex.cancelOrder')}
            </Button>
          )}
        </div>
        {/* Opens on "Keep order": a stray Enter must not cancel. */}
        <ConfirmDialog
          open={cancelOpen}
          onOpenChange={(o) => {
            if (!o) closeCancel();
          }}
          title={t('orderDetail.cancel.title', { orderNo: row.orderNumber })}
          entity={row.orderNumber}
          entityIsIdentifier
          consequence={t('ordersOrderActionsPanel.saneAdminCancelDrivesThe')}
          confirmLabel={t('ordersOrderActionsPanel.confirmCancel')}
          cancelLabel={t('orderDetail.cancel.keep')}
          destructive
          focusSafe
          onConfirm={confirmCancel}
          error={cancelError}
        >
          <div className="oo-stack oo-stack--tight">
            <p className="oo-faint">{t('ordersOrderActionsPanel.ifADeliveryFeeHas')}</p>
            <Select
              id={`cancel-reason-${row.shipmentId}`}
              label={t('ordersOrderActionsPanel.cancellationReason')}
              requiredMark
              value={reason}
              onChange={(e) => setReason(e.target.value as OrderCancellationReason)}
              disabled={cancel.isPending}
            >
              {CANCELLATION_REASONS(t).map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
            <TextArea
              id={`cancel-note-${row.shipmentId}`}
              label={t('ordersOrderActionsPanel.internalNoteOptional')}
              hint={t('ordersOrderActionsPanel.recordedInTheOrderEvent')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              disabled={cancel.isPending}
            />
          </div>
        </ConfirmDialog>
        {error !== null && (
          <p className="oo-error" role="alert">
            {error}
          </p>
        )}
      </Td>
    </Tr>
  );
}

export function CourierDecisionIndex(): ReactElement {
  const t = useT();
  const queue = useCourierDecisionQueue();
  const rows = queue.data ?? [];

  return (
    <div className="oo-page ez-touch">
      <PageHeader
        title={
          <span className="ez-titled">
            {t('courierDecisionsCourierDecisionIndex.courierDecisions')}
            <InfoButton
              title={t('courierDecisionsCourierDecisionIndex.courierDecisions')}
              text={t('courierDecisionsCourierDecisionIndex.confirmedParcelsWaitingForSomebody')}
            />
          </span>
        }
      />

      <OoSection
        title={t('courierDecisionsCourierDecisionIndex.waitingForACarrier')}
        note={
          queue.data === undefined ? undefined : t('ezCourier.waitingCount', { n: rows.length })
        }
        flush
      >
        {queue.isLoading ? (
          <div className="oo-card__pad">
            <SkeletonRows
              rows={4}
              cols={5}
              label={t('courierDecisionsCourierDecisionIndex.loadingTheQueue')}
            />
          </div>
        ) : queue.isError ? (
          <div className="oo-card__pad">
            <ErrorState
              message={
                queue.error?.message ??
                t('courierDecisionsCourierDecisionIndex.couldNotLoadTheQueue')
              }
              retry={() => void queue.refetch()}
            />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            bare
            tone="positive"
            icon={<Truck size={20} />}
            title={t('courierDecisionsCourierDecisionIndex.nothingWaitingOnADecision')}
            description={t('courierDecisionsCourierDecisionIndex.ordersAppearHereOnlyFor')}
          />
        ) : (
          <Table caption={t('courierDecisionsCourierDecisionIndex.parcelsWaitingForACarrier')}>
            <THead>
              <Tr>
                <Th>{t('courierDecisionsCourierDecisionIndex.order')}</Th>
                <Th>{t('courierDecisionsCourierDecisionIndex.destination')}</Th>
                <Th>{t('courierDecisionsCourierDecisionIndex.parcel')}</Th>
                <Th>{t('courierDecisionsCourierDecisionIndex.waiting')}</Th>
                <Th>
                  <span className="ez-titled">
                    {t('courierDecisionsCourierDecisionIndex.pickACarrier')}
                    <InfoButton
                      title={t('courierDecisionsCourierDecisionIndex.pickACarrier')}
                      text={t('ezCourier.pickInfo')}
                    />
                  </span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((row) => (
                <Row key={row.shipmentId} row={row} />
              ))}
            </TBody>
          </Table>
        )}
      </OoSection>
    </div>
  );
}
