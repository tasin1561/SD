import type { JourneyMilestoneView } from '@skydrop/ui/components';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

const BY_KEY: Readonly<Record<string, MessageKey>> = {
  order_received: 'orderPage.m.order_received',
  call_confirmed: 'orderPage.m.call_confirmed',
  picked: 'orderPage.m.picked',
  packed: 'orderPage.m.packed',
  ready_to_dispatch: 'orderPage.m.ready_to_dispatch',
  dispatched: 'orderPage.m.dispatched',
  in_transit: 'orderPage.m.in_transit',
  out_for_delivery: 'orderPage.m.out_for_delivery',
  delivered: 'orderPage.m.delivered',
  lost: 'orderPage.m.lost',
  returning: 'orderPage.m.returning',
  rto_received: 'orderPage.m.rto_received',
};

/**
 * The step's name in the reader's language. The API sends English labels with
 * stable keys; an unknown key keeps the API's own label rather than a guess.
 * `rto_settled` is two different sentences, told apart by the label the
 * server chose from the event that actually landed.
 */
export function milestoneLabel(
  m: Pick<JourneyMilestoneView, 'key' | 'label'>,
  t: Translate<MessageKey>,
): string {
  if (m.key === 'rto_settled') {
    return t(m.label === 'Not sellable' ? 'orderPage.m.rto_damaged' : 'orderPage.m.rto_restocked');
  }
  const k = BY_KEY[m.key];
  return k === undefined ? m.label : t(k);
}
