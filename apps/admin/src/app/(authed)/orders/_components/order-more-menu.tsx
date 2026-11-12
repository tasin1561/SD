import {
  Ban,
  Calculator,
  PackageMinus,
  PackagePlus,
  ReceiptIndianRupee,
  ScanLine,
  ShieldAlert,
  Undo2,
} from 'lucide-react';
import type { MenuEntry } from '@skydrop/ui/components';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

/**
 * The header's More menu, built from the SAME conditions the bottom
 * Actions section and the shipment buttons used. Pure on purpose: the
 * gating is the thing most worth testing, and it needs no DOM to do it.
 *
 * Each item is one of three states, and which one is the old behaviour:
 *
 *   HIDDEN      the control did not render before, so it is not in the menu
 *               (scan/cost with no shipment; cost without
 *               `money.treasury.manage`; compute without view+compute or
 *               while the charges are loading/failed; "Request return"
 *               unless DELIVERED and `orders.cancel`)
 *   DISABLED    the control rendered disabled with a reason, so it is in the
 *               menu, `aria-disabled`, with the reason as a second line
 *               (Cancel; the three god-mode items)
 *   ENABLED     otherwise
 *
 * A disabled item is never a stand-in for a hidden one.
 */
export interface MoreMenuInput {
  readonly t: Translate<MessageKey>;
  readonly orderStatus: string;
  // lifecycle (order-actions-panel's own conditions)
  readonly canOverride: boolean;
  readonly canCancel: boolean;
  readonly inTerminalState: boolean;
  readonly cancelPending: boolean;
  readonly canRequestReturn: boolean;
  // shipment-scoped: undefined = the control was not rendered
  readonly canRecordScan: boolean;
  readonly canRecordCost: boolean;
  // charges
  readonly canCompute: boolean;
  readonly open: {
    readonly cancel: () => void;
    readonly override: () => void;
    readonly release: () => void;
    readonly restore: () => void;
    readonly requestReturn: () => void;
    readonly recordScan: () => void;
    readonly recordCost: () => void;
    readonly compute: () => void;
  };
}

export function buildMoreEntries(i: MoreMenuInput): MenuEntry[] {
  const { t } = i;
  const group1: MenuEntry[] = [];
  if (i.canRecordScan) {
    group1.push({
      kind: 'action',
      id: 'scan',
      label: t('ordersManualScanPanel.recordAScanManually'),
      icon: <ScanLine size={14} />,
      onSelect: i.open.recordScan,
    });
  }
  if (i.canRecordCost) {
    group1.push({
      kind: 'action',
      id: 'cost',
      label: t('ordersShipmentCostPanel.recordCourierCost'),
      icon: <ReceiptIndianRupee size={14} />,
      onSelect: i.open.recordCost,
    });
  }
  if (i.canCompute) {
    group1.push({
      kind: 'action',
      id: 'compute',
      label: t('ordersOrderCharges.computePersistCharges'),
      icon: <Calculator size={14} />,
      onSelect: i.open.compute,
    });
  }
  // DELIVERED is terminal for everything else; a customer return is the one
  // lifecycle move a finished order still has. Hidden, never disabled.
  if (i.canRequestReturn) {
    group1.push({
      kind: 'action',
      id: 'return',
      label: t('ordersOrderActionsPanel.requestReturn'),
      icon: <Undo2 size={14} />,
      onSelect: i.open.requestReturn,
    });
  }

  const cancelDisabled = i.inTerminalState || i.cancelPending || !i.canCancel;
  const cancelReason = i.inTerminalState
    ? t('ordersOrderActionsPanel.alreadyInATerminalState', {
        value: i.orderStatus.toLowerCase(),
      })
    : t('ordersOrderActionsPanel.cancelViaTheMatrixReleases');

  const out: MenuEntry[] = [];
  if (group1.length > 0) {
    out.push(...group1, { kind: 'separator', id: 'sep1' });
  }
  out.push(
    {
      kind: 'action',
      id: 'cancel',
      label: t('ordersOrderActionsPanel.cancelOrder'),
      icon: <Ban size={14} />,
      danger: true,
      disabled: cancelDisabled,
      // Today's tooltip, verbatim: the terminal-state reason when that is
      // why it is off, else the matrix note it always carried.
      ...(cancelDisabled ? { hint: cancelReason } : {}),
      onSelect: i.open.cancel,
    },
    { kind: 'separator', id: 'sep2' },
    {
      kind: 'label',
      id: 'danger',
      label: t('orderDetail.danger.groupLabel'),
      ...(i.canOverride
        ? {}
        : { description: t('ordersOrderActionsPanel.yourRoleDoesNotInclude') }),
    },
    {
      kind: 'action',
      id: 'override',
      label: t('ordersOrderActionsPanel.forceMutate'),
      icon: <ShieldAlert size={14} />,
      danger: true,
      disabled: !i.canOverride,
      ...(i.canOverride ? {} : { hint: t('ordersOrderActionsPanel.requiresTheGodModeOverride') }),
      onSelect: i.open.override,
    },
    {
      kind: 'action',
      id: 'release',
      label: t('ordersOrderActionsPanel.releaseReservations'),
      icon: <PackageMinus size={14} />,
      danger: true,
      disabled: !i.canOverride,
      ...(i.canOverride ? {} : { hint: t('ordersOrderActionsPanel.requiresSuperAdminRole') }),
      onSelect: i.open.release,
    },
    {
      kind: 'action',
      id: 'restore',
      label: t('ordersOrderActionsPanel.restoreStockClaim'),
      icon: <PackagePlus size={14} />,
      danger: true,
      disabled: !i.canOverride,
      ...(i.canOverride ? {} : { hint: t('ordersOrderActionsPanel.requiresSuperAdminRole') }),
      onSelect: i.open.restore,
    },
  );
  return out;
}
