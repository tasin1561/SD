import { defineMessages } from '../define';

/**
 * Copy that the extraction could not lift mechanically: sentences with live
 * nodes inside them, text inside module-level tables, plural words. Each key is
 * prefixed with the screen that owns it, like every other namespace.
 */
export const extra = defineMessages({
  'ordersOrderActionsPanel.failedError': ['failed: {error}', 'ব্যর্থ: {error}'],
  'ordersOrderActionsPanel.unknown': ['unknown', 'অজানা'],
  'callCenterCustomerRiskStrip.returnRate': [
    "{pct} of this customer's parcels came back",
    'এই গ্রাহকের {pct} পার্সেল ফেরত এসেছে',
  ],
  'callCenterCustomerRiskStrip.previousOrders': [
    '{total} previous order{plural}',
    'আগের {total}টি অর্ডার{plural}',
  ],
  'callCenterCustomerRiskStrip.declinedOnACall': [
    ' · declined on a call {n}×',
    ' · কলে {n} বার প্রত্যাখ্যান',
  ],
});
