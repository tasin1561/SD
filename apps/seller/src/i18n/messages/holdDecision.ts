import { defineMessages } from '../define';

/** Copy owned by the "holdDecision" feature. */
export const holdDecision = defineMessages({
  'holdDecision.orderLetGoNo': [
    'Order let go. No stock was being held against it.',
    'Order let go. No stock was being held against it.',
  ],
  'holdDecision.weWillKeepTrying': [
    'We will keep trying to reach the customer.',
    'We will keep trying to reach the customer.',
  ],
  'holdDecision.recordedTheOrderHad': [
    'Recorded. The order had already moved on, so calling did not restart.',
    'Recorded. The order had already moved on, so calling did not restart.',
  ],
  'holdDecision.orderLetGoUnit': [
    'Order let go. {heldQty} unit{plural} released back to available stock.',
    'Order let go. {heldQty} unit{plural} released back to available stock.',
  ],
  'holdDecision.weCouldNotReach': [
    'We could not reach your customer',
    'We could not reach your customer',
  ],
  'holdDecision.weHaveTriedTime': [
    'We have tried {attemptCount} time{plural} without reaching them, and are still holding {held} unit{plural2} against this order. Nothing happens to it until you say.',
    'We have tried {attemptCount} time{plural} without reaching them, and are still holding {held} unit{plural2} against this order. Nothing happens to it until you say.',
  ],
  'holdDecision.weHaveTriedTime2': [
    'We have tried {attemptCount} time{plural} without reaching them. Nothing happens to this order until you say.',
    'We have tried {attemptCount} time{plural} without reaching them. Nothing happens to this order until you say.',
  ],
  'holdDecision.cancel': ['Cancel', 'Cancel'],
  'holdDecision.letItGo': ['Let it go', 'Let it go'],
  'holdDecision.keepTrying': ['Keep trying', 'Keep trying'],
  'holdDecision.saving': ['Saving…', 'Saving…'],
  'holdDecision.decision': ['Decision', 'Decision'],
  'holdDecision.theOrderIsRejected': [
    'The order is rejected and the units go back to available stock so your other orders can use them. You can still ask us to call again afterwards.',
    'The order is rejected and the units go back to available stock so your other orders can use them. You can still ask us to call again afterwards.',
  ],
  'holdDecision.theOrderIsRejected2': [
    'The order is rejected. No stock is held against it, so nothing moves in your inventory. You can still ask us to call again afterwards.',
    'The order is rejected. No stock is held against it, so nothing moves in your inventory. You can still ask us to call again afterwards.',
  ],
  'holdDecision.theOrderGoesBack': [
    'The order goes back into the call queue and we ring again. The units stay unavailable to your other orders in the meantime.',
    'The order goes back into the call queue and we ring again. The units stay unavailable to your other orders in the meantime.',
  ],
  'holdDecision.theOrderGoesBack2': [
    'The order goes back into the call queue and we ring again.',
    'The order goes back into the call queue and we ring again.',
  ],
  'holdDecision.note': ['Note', 'Note'],
  'holdDecision.optionalAnythingYouKnow': [
    'Optional. Anything you know about this customer.',
    'Optional. Anything you know about this customer.',
  ],
  'holdDecision.letThisOrderGo': ['Let this order go?', 'Let this order go?'],
  'holdDecision.thisOrder': ['This order', 'This order'],
  'holdDecision.theOrderIsRejected3': [
    'The order is rejected and the held units return to your available stock. You can ask us to call again afterwards, but the order does not come back on its own.',
    'The order is rejected and the held units return to your available stock. You can ask us to call again afterwards, but the order does not come back on its own.',
  ],
  'holdDecision.theOrderIsRejected4': [
    'The order is rejected. You can ask us to call again afterwards, but the order does not come back on its own.',
    'The order is rejected. You can ask us to call again afterwards, but the order does not come back on its own.',
  ],
  'holdDecision.order': ['Order ', 'Order '],
});
