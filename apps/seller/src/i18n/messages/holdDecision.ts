import { defineMessages } from '../define';

/** Copy owned by the "holdDecision" feature. */
export const holdDecision = defineMessages({
  'holdDecision.orderLetGoNo': [
    'Order let go. No stock was being held against it.',
    'অর্ডার ছেড়ে দেওয়া হয়েছে। এর বিপরীতে কোনো স্টক ধরে রাখা ছিল না।',
  ],
  'holdDecision.weWillKeepTrying': [
    'We will keep trying to reach the customer.',
    'আমরা গ্রাহকের সাথে যোগাযোগের চেষ্টা চালিয়ে যাব।',
  ],
  'holdDecision.recordedTheOrderHad': [
    'Recorded. The order had already moved on, so calling did not restart.',
    'নথিভুক্ত হয়েছে। অর্ডারটি ইতিমধ্যে এগিয়ে গিয়েছিল, তাই কল আবার শুরু হয়নি।',
  ],
  'holdDecision.orderLetGoUnit': [
    'Order let go. {heldQty} unit{plural} released back to available stock.',
    'অর্ডার ছেড়ে দেওয়া হয়েছে। {heldQty}টি ইউনিট ব্যবহারযোগ্য স্টকে ফিরে গেছে।',
  ],
  'holdDecision.weCouldNotReach': [
    'We could not reach your customer',
    'আমরা আপনার গ্রাহকের নাগাল পাইনি',
  ],
  'holdDecision.weHaveTriedTime': [
    'We have tried {attemptCount} time{plural} without reaching them, and are still holding {held} unit{plural2} against this order. Nothing happens to it until you say.',
    'আমরা {attemptCount} বার চেষ্টা করেও তাঁকে পাইনি, এবং এই অর্ডারের বিপরীতে এখনো {held}টি ইউনিট ধরে রেখেছি। আপনি না বলা পর্যন্ত এর কিছুই হবে না।',
  ],
  'holdDecision.weHaveTriedTime2': [
    'We have tried {attemptCount} time{plural} without reaching them. Nothing happens to this order until you say.',
    'আমরা {attemptCount} বার চেষ্টা করেও তাঁকে পাইনি। আপনি না বলা পর্যন্ত এই অর্ডারের কিছুই হবে না।',
  ],
  'holdDecision.cancel': ['Cancel', 'বাতিল'],
  'holdDecision.letItGo': ['Let it go', 'ছেড়ে দিন'],
  'holdDecision.keepTrying': ['Keep trying', 'চেষ্টা চালিয়ে যান'],
  'holdDecision.saving': ['Saving…', 'সংরক্ষণ হচ্ছে…'],
  'holdDecision.decision': ['Decision', 'সিদ্ধান্ত'],
  'holdDecision.theOrderIsRejected': [
    'The order is rejected and the units go back to available stock so your other orders can use them. You can still ask us to call again afterwards.',
    'অর্ডারটি প্রত্যাখ্যাত হবে এবং ইউনিটগুলো ব্যবহারযোগ্য স্টকে ফিরে যাবে, যাতে আপনার অন্য অর্ডার সেগুলো ব্যবহার করতে পারে। পরে আপনি আবার কল করতে বলতে পারবেন।',
  ],
  'holdDecision.theOrderIsRejected2': [
    'The order is rejected. No stock is held against it, so nothing moves in your inventory. You can still ask us to call again afterwards.',
    'অর্ডারটি প্রত্যাখ্যাত হবে। এর বিপরীতে কোনো স্টক ধরে রাখা নেই, তাই আপনার ইনভেন্টরিতে কিছু সরবে না। পরে আপনি আবার কল করতে বলতে পারবেন।',
  ],
  'holdDecision.theOrderGoesBack': [
    'The order goes back into the call queue and we ring again. The units stay unavailable to your other orders in the meantime.',
    'অর্ডারটি আবার কল কিউতে যাবে এবং আমরা আবার ফোন করব। এর মধ্যে ইউনিটগুলো আপনার অন্য অর্ডারের জন্য পাওয়া যাবে না।',
  ],
  'holdDecision.theOrderGoesBack2': [
    'The order goes back into the call queue and we ring again.',
    'অর্ডারটি আবার কল কিউতে যাবে এবং আমরা আবার ফোন করব।',
  ],
  'holdDecision.note': ['Note', 'নোট'],
  'holdDecision.optionalAnythingYouKnow': [
    'Optional. Anything you know about this customer.',
    'ঐচ্ছিক। এই গ্রাহক সম্পর্কে আপনি যা জানেন।',
  ],
  'holdDecision.letThisOrderGo': ['Let this order go?', 'এই অর্ডার ছেড়ে দেবেন?'],
  'holdDecision.thisOrder': ['This order', 'এই অর্ডার'],
  'holdDecision.theOrderIsRejected3': [
    'The order is rejected and the held units return to your available stock. You can ask us to call again afterwards, but the order does not come back on its own.',
    'অর্ডারটি প্রত্যাখ্যাত হবে এবং ধরে রাখা ইউনিটগুলো আপনার ব্যবহারযোগ্য স্টকে ফিরে যাবে। পরে আপনি আবার কল করতে বলতে পারবেন, কিন্তু অর্ডারটি নিজে থেকে ফিরে আসবে না।',
  ],
  'holdDecision.theOrderIsRejected4': [
    'The order is rejected. You can ask us to call again afterwards, but the order does not come back on its own.',
    'অর্ডারটি প্রত্যাখ্যাত হবে। পরে আপনি আবার কল করতে বলতে পারবেন, কিন্তু অর্ডারটি নিজে থেকে ফিরে আসবে না।',
  ],
  'holdDecision.order': ['Order ', 'অর্ডার '],
});
