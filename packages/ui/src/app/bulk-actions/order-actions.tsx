import { Ban, Check, FileDown, FileText, PhoneCall, PhoneOff, Tag, Truck, X } from 'lucide-react';
import type { Translate } from '../i18n';
import type { UiMessageKey } from '../i18n/ui-messages';
import type { BulkActionDef } from './index';

/**
 * The bulk actions each console offers on its ORDER list, in one place so the
 * four consoles cannot drift: the path, the permission, whether the endpoint
 * takes an idempotency key, and what the confirm step says.
 *
 * `may(permission)` is the caller's own check; an action the person may not
 * run is not offered at all.
 *
 * Order on the bar: the everyday actions first, the cancelling ones last —
 * the thing that cannot be undone is the furthest from a stray tap.
 *
 * Two families of endpoint, and they take different bodies:
 *  - cancel / request cancellation / delivery actions take `{ orderIds,
 *    idempotencyKey, … }`;
 *  - confirmation calls, confirm-without-call, invoices, labels and the CSV
 *    export take `{ orderIds }` ONLY — the server refuses an unknown field,
 *    so no key is sent to those.
 */
export type BulkConsole = 'seller' | 'store' | 'admin';

type T = Translate<UiMessageKey>;

export function orderBulkActions(opts: {
  readonly console: BulkConsole;
  readonly t: T;
  readonly may: (permission: string) => boolean;
}): BulkActionDef[] {
  const { console: c, t, may } = opts;
  const out: BulkActionDef[] = [];

  const cancel: BulkActionDef = {
    id: 'cancel',
    label: t('ui.bulk.act.cancel'),
    icon: <Ban size={14} />,
    danger: true,
    kind: 'post',
    path: `/api/${c}/bulk/orders/cancel`,
    withKey: true,
    confirm: {
      title: t('ui.bulk.cancel.title'),
      consequence: t('ui.bulk.cancel.consequence'),
      confirmLabel: t('ui.bulk.cancel.confirm'),
      dismissLabel: t('ui.bulk.cancel.keep'),
      fields: [{ kind: 'text', name: 'note', label: t('ui.bulk.note'), maxLength: 500 }],
    },
  };
  const cancelRequest: BulkActionDef = {
    id: 'cancel-request',
    label: t('ui.bulk.act.cancelRequest'),
    icon: <X size={14} />,
    kind: 'post',
    path: `/api/${c}/bulk/orders/cancel-request`,
    withKey: true,
    confirm: {
      title: t('ui.bulk.cancelRequest.title'),
      consequence: t('ui.bulk.cancelRequest.consequence'),
      confirmLabel: t('ui.bulk.cancelRequest.confirm'),
      fields: [{ kind: 'text', name: 'note', label: t('ui.bulk.note'), maxLength: 1000 }],
    },
  };
  const call: BulkActionDef = {
    id: 'call',
    label: t('ui.bulk.act.call'),
    icon: <PhoneCall size={14} />,
    kind: 'post',
    path: `/api/${c}/orders/bulk/confirmation-calls`,
  };
  const confirmNoCall: BulkActionDef = {
    id: 'confirm-without-call',
    label: t('ui.bulk.act.confirmNoCall'),
    icon: <PhoneOff size={14} />,
    kind: 'post',
    path: `/api/${c}/orders/bulk/confirm-without-call`,
    confirm: {
      title: t('ui.bulk.confirmNoCall.title'),
      consequence: t('ui.bulk.confirmNoCall.consequence'),
      confirmLabel: t('ui.bulk.confirmNoCall.confirm'),
    },
  };
  const exportCsv: BulkActionDef = {
    id: 'export',
    label: t('ui.bulk.act.export'),
    icon: <FileDown size={14} />,
    kind: 'download',
    path: `/api/${c}/orders/bulk/export`,
    allMatching: true,
    fileName: 'orders.csv',
  };

  if (c === 'seller') {
    if (may('orders.create')) {
      out.push(call, confirmNoCall, {
        id: 'delivery',
        label: t('ui.bulk.act.delivery'),
        icon: <Truck size={14} />,
        kind: 'post',
        path: '/api/seller/bulk/orders/delivery-actions',
        withKey: true,
        confirm: {
          title: t('ui.bulk.delivery.title'),
          consequence: t('ui.bulk.delivery.consequence'),
          confirmLabel: t('ui.bulk.delivery.confirm'),
          fields: [
            {
              kind: 'select',
              name: 'action',
              label: t('ui.bulk.delivery.action'),
              options: [
                { value: 'REATTEMPT', label: t('ui.bulk.delivery.reattempt') },
                { value: 'RECALL', label: t('ui.bulk.delivery.recall') },
                { value: 'RTO', label: t('ui.bulk.delivery.rto') },
              ],
            },
            {
              kind: 'text',
              name: 'reason',
              label: t('ui.bulk.reason'),
              minLength: 1,
              maxLength: 500,
            },
          ],
        },
      });
    }
    if (may('charges.view')) {
      out.push({
        id: 'invoices',
        label: t('ui.bulk.act.invoices'),
        icon: <FileText size={14} />,
        kind: 'download',
        path: '/api/seller/orders/bulk/invoices',
        fileName: 'invoices.pdf',
      });
    }
    if (may('orders.view')) out.push(exportCsv);
    if (may('orders.cancel')) out.push(cancelRequest, cancel);
    return out;
  }

  if (c === 'store') {
    if (may('orders.view')) out.push(exportCsv);
    if (may('orders.cancel')) out.push(cancelRequest, cancel);
    return out;
  }

  if (may('callcenter.queue.manage')) out.push(call, confirmNoCall);
  if (may('warehouse.pick')) {
    out.push({
      id: 'labels',
      label: t('ui.bulk.act.labels'),
      icon: <Tag size={14} />,
      kind: 'download',
      path: '/api/admin/orders/bulk/labels',
      fileName: 'labels.pdf',
    });
  }
  if (may('orders.view')) out.push(exportCsv);
  if (may('orders.cancel')) out.push(cancel);
  return out;
}

/** Staff deciding clients' failed-delivery requests in bulk. Ids are REQUEST ids. */
export function deliveryDecisionBulkActions(opts: {
  readonly t: T;
  readonly may: (permission: string) => boolean;
}): BulkActionDef[] {
  const { t, may } = opts;
  if (!may('courier.ops.write')) return [];
  return [
    {
      id: 'approve',
      label: t('ui.bulk.act.approve'),
      icon: <Check size={14} />,
      kind: 'post',
      path: '/api/admin/bulk/delivery-actions/approve',
      idsKey: 'requestIds',
      withKey: true,
      confirm: {
        title: t('ui.bulk.approve.title'),
        consequence: t('ui.bulk.approve.consequence'),
        confirmLabel: t('ui.bulk.approve.confirm'),
        fields: [{ kind: 'text', name: 'note', label: t('ui.bulk.note'), maxLength: 500 }],
      },
    },
    {
      id: 'reject',
      label: t('ui.bulk.act.reject'),
      icon: <X size={14} />,
      danger: true,
      kind: 'post',
      path: '/api/admin/bulk/delivery-actions/reject',
      idsKey: 'requestIds',
      withKey: true,
      confirm: {
        title: t('ui.bulk.reject.title'),
        consequence: t('ui.bulk.reject.consequence'),
        confirmLabel: t('ui.bulk.reject.confirm'),
        fields: [
          {
            kind: 'text',
            name: 'note',
            label: t('ui.bulk.reject.reason'),
            hint: t('ui.bulk.reject.hint'),
            minLength: 5,
            maxLength: 500,
          },
        ],
      },
    },
  ];
}
