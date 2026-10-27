'use client';

import { useState, type ReactElement } from 'react';
import type { ResellerOrderMoneyView, ResellerPartyCreditView } from '@skydrop/api-client';
import { ApiError } from '@skydrop/api-client';
import { useSellerIdentity } from '@skydrop/auth/client';
import type { StoreWalletEntryDirection, WalletEntryDirection } from '@skydrop/db';
import { Scale } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TBody, THead, TableEmpty, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { Facts, OrdSection } from '../../_components/orders-parts';
import {
  resellerCreditStatusKind,
  resellerCreditStatusLabel,
  walletDirectionLabel,
} from '@skydrop/ui/status';
import { useResellerOrderMoney } from '@/lib/api-hooks';
import { can } from '@/lib/page-access';
import { verdict } from '@/i18n/verdict';
import { DisputeFiguresModal } from './dispute-figures-modal';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

/** The fee a split line is a share of, in words. */
export function feeLabel(
  t: Translate<MessageKey>,
  fee: WalletEntryDirection | StoreWalletEntryDirection | string,
): string {
  switch (fee) {
    case 'ORDER_CHARGES':
      return t('orderResellerMoney.deliveryFee');
    case 'RTO_FEE':
      return t('orderResellerMoney.returnFee');
    case 'CUSTOMER_RETURN_FEE':
      return t('orderResellerMoney.customerReturnFee');
    default:
      return fee.toLowerCase().replace(/_/g, ' ');
  }
}

/** Why a credit was not written, in words a seller reads. */
export function skippedReasonWords(t: Translate<MessageKey>, reason: string | null): string | null {
  if (reason === null) return null;
  if (reason === 'ORDER_LOST_IN_TRANSIT') return t('orderResellerMoney.lostInTransit');
  if (reason.startsWith('ORDER_')) return t('orderResellerMoney.calledOff');
  switch (reason) {
    case 'RETURNED_UNDELIVERED':
      return t('orderResellerMoney.cameBackUndelivered');
    case 'RETURNED':
      return t('orderResellerMoney.goodsCameBack');
    case 'NOT_DELIVERED':
      return t('orderResellerMoney.notDeliveredYet');
    case 'COURIER_HAS_NOT_PAID':
      return t('orderResellerMoney.courierNotPaid');
    case 'COURIER_REVERSED':
      return t('orderResellerMoney.courierReversed');
    case 'PREPAID_NOT_PAID_BY_STORE':
      return t('orderResellerMoney.storeNotPaid');
    default:
      return reason;
  }
}

function when(t: Translate<MessageKey>, p: ResellerPartyCreditView): string {
  const d = p.reversedAt ?? p.creditedAt ?? p.dueAt;
  if (d === null) return '—';
  return t(
    p.reversedAt !== null
      ? 'orderResellerMoney.takenBack'
      : p.creditedAt !== null
        ? 'orderResellerMoney.credited'
        : 'orderResellerMoney.due',
    { when: new Date(d).toLocaleString() },
  );
}

/**
 * RS-7 (2026-09-19) — "Raise with the store", beside the figures it is
 * about.
 *
 * Here rather than on the tickets page because this is where the numbers
 * somebody is disagreeing with are on screen, and because the order is
 * then not something they have to go and look up. Cosmetic gating only
 * (FE-2): `tickets.create` is what the server checks.
 */
function DisputeFiguresAction({ orderId }: { readonly orderId: string }): ReactElement | null {
  const t = useT();
  const [open, setOpen] = useState(false);
  const identity = useSellerIdentity();
  if (!can(identity, 'tickets.create')) return null;
  return (
    <>
      <Button variant="ghost" size="sm" icon={<Scale size={14} />} onClick={() => setOpen(true)}>
        {t('orderResellerMoney.raiseWithTheStore')}
      </Button>
      <DisputeFiguresModal open={open} onOpenChange={setOpen} orderId={orderId} />
    </>
  );
}

/**
 * RS-6 phase 3c — what one of your reseller stores' orders earns YOU:
 * the transfer price, your share of each fee, and when it lands. The
 * figures come from the API (the plan is decided there, never here).
 * Rendered only for a reseller order, for anybody the endpoint will
 * answer. It does NOT close itself to a VIEWER: this said the endpoint
 * refuses that role and it does not — the controller is gated on
 * `orders.view`, which `viewer` holds. The caller's `enabled` is that
 * same permission and nothing more; a narrower gate here would be the
 * UI pretending to enforce (FE-2, RBAC-1).
 */
export function ResellerMoneyPanel({
  orderId,
  enabled,
}: {
  readonly orderId: string;
  readonly enabled: boolean;
}): ReactElement | null {
  const t = useT();
  const money = useResellerOrderMoney(orderId, enabled);
  if (!enabled) return null;
  if (money.isLoading) {
    return (
      <OrdSection title={t('orderResellerMoney.memberStoreMoney')}>
        <SkeletonRows rows={3} cols={4} label={t('orderResellerMoney.loadingTheStoreMoney')} />
      </OrdSection>
    );
  }
  if (money.isError) {
    // A channel order has no reseller money — nothing to show, not an error.
    if (money.error instanceof ApiError && money.error.status === 404) return null;
    return (
      <OrdSection title={t('orderResellerMoney.memberStoreMoney')}>
        <ErrorState message={verdict(money.error, t)} retry={() => void money.refetch()} />
      </OrdSection>
    );
  }
  const view: ResellerOrderMoneyView | undefined = money.data;
  if (view === undefined) return null;
  const mine = view.parties.find((p) => p.party === 'SELLER');
  return (
    <OrdSection
      title={t('orderResellerMoney.memberStoreMoney')}
      note={t('orderResellerMoney.yourTransferPriceFor')}
      action={<DisputeFiguresAction orderId={orderId} />}
    >
      <div className="ord-stack">
        {mine === undefined ? (
          <p className="ord-p">{t('orderResellerMoney.nothingPlannedYetThe')}</p>
        ) : (
          <Facts
            items={[
              {
                label: t('orderResellerMoney.status'),
                value: (
                  <StatusChip
                    kind={resellerCreditStatusKind(mine.status)}
                    label={resellerCreditStatusLabel(mine.status)}
                    size="sm"
                  />
                ),
              },
              { label: t('orderResellerMoney.when'), value: mine.timing },
              { label: t('orderResellerMoney.date'), value: when(t, mine) },
              ...(skippedReasonWords(t, mine.skippedReason) !== null
                ? [
                    {
                      label: t('orderResellerMoney.why'),
                      value: skippedReasonWords(t, mine.skippedReason),
                    },
                  ]
                : []),
              {
                label: t('orderResellerMoney.transferPrice'),
                value: <Money amount={mine.grossInr} direction="credit" convert={false} />,
              },
              {
                label: t('orderResellerMoney.yourShareOfThe'),
                value: <Money amount={mine.taxShareInr} direction="debit" convert={false} />,
              },
              {
                label: t('orderResellerMoney.yourShareOfThe2'),
                value: <Money amount={mine.codFeeShareInr} direction="debit" convert={false} />,
              },
              {
                label: t('orderResellerMoney.yourShareOfThe3'),
                value: <Money amount={mine.instantFeeShareInr} direction="debit" convert={false} />,
              },
              {
                label: t('orderResellerMoney.youReceive'),
                value: <Money amount={mine.netInr} convert={false} />,
                total: true,
              },
            ]}
          />
        )}

        {view.fees.length > 0 ? (
          <div className="ord-card" data-flush="1">
            <Table caption={t('orderResellerMoney.feesOnThisOrder')}>
              <THead>
                <Tr>
                  <Th>{t('orderResellerMoney.feeBilled')}</Th>
                  <Th align="right">{t('orderResellerMoney.yours')}</Th>
                  <Th align="right">{t('orderResellerMoney.paidByTheStore')}</Th>
                  <Th align="right">{t('orderResellerMoney.total')}</Th>
                </Tr>
              </THead>
              <TBody>
                {view.fees.map((f) => (
                  <Tr key={f.fee}>
                    <Td>{feeLabel(t, f.fee)}</Td>
                    <Td align="right">
                      <Money amount={f.sellerInr} convert={false} />
                    </Td>
                    <Td align="right">
                      <Money amount={f.storeInr} convert={false} />
                    </Td>
                    <Td align="right">
                      <Money amount={f.totalInr} convert={false} />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        ) : null}

        <div className="ord-card" data-flush="1">
          <Table caption={t('orderResellerMoney.yourWalletOnThis')}>
            <THead>
              <Tr>
                <Th>{t('orderResellerMoney.yourWalletOnThis')}</Th>
                <Th>{t('orderResellerMoney.when')}</Th>
                <Th align="right">{t('orderResellerMoney.amount')}</Th>
              </Tr>
            </THead>
            <TBody>
              {(view.sellerLines ?? []).length === 0 ? (
                <TableEmpty colSpan={3}>{t('orderResellerMoney.nothingInYourWallet')}</TableEmpty>
              ) : (
                (view.sellerLines ?? []).map((l) => (
                  <Tr key={l.id}>
                    <Td>
                      <div>{walletDirectionLabel(l.direction as WalletEntryDirection)}</div>
                      {l.note !== null ? <span className="ord-sub">{l.note}</span> : null}
                    </Td>
                    <Td>
                      <span className="sk-figure ord-muted">
                        {new Date(l.createdAt).toLocaleString()}
                      </span>
                    </Td>
                    <Td align="right">
                      <Money
                        amount={l.amountInr.replace(/^-/, '')}
                        direction={l.amountInr.startsWith('-') ? 'debit' : 'credit'}
                        convert={false}
                      />
                    </Td>
                  </Tr>
                ))
              )}
            </TBody>
          </Table>
        </div>
        {view.sellerNetInr !== null ? (
          <p className="ord-p ord-row ord-row--end">
            {richMessage(t('orderResellerMoney.netToYouSo'), {
              money: <Money amount={view.sellerNetInr} convert={false} />,
            })}
          </p>
        ) : null}
      </div>
    </OrdSection>
  );
}
