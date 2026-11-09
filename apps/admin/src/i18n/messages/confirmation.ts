import { defineMessages } from '../define';

/**
 * Confirmation-call opt-out: the per-client switch and the cross-client
 * waiting list. Setting keys and API codes are data and stay untranslated.
 */
export const confirmation = defineMessages({
  'nav.awaitingConfirmation': ['Awaiting confirmation', 'নিশ্চিতকরণের অপেক্ষায়'],

  // ── Per-client panel ──
  'confirmCalls.title': ['Phone confirmation', 'ফোন নিশ্চিতকরণ'],
  'confirmCalls.note': [
    'Whether our call centre rings this client’s customers before an order is packed.',
    'অর্ডার প্যাক হওয়ার আগে আমাদের কল সেন্টার এই ক্লায়েন্টের কাস্টমারদের ফোন করবে কি না।',
  ],
  'confirmCalls.switchLabel': [
    'Call every customer to confirm',
    'নিশ্চিত করতে প্রতিটি কাস্টমারকে ফোন',
  ],
  'confirmCalls.switchOnDesc': [
    'Orders go to the call queue and wait for an agent.',
    'অর্ডার কল কিউতে যায় এবং এজেন্টের জন্য অপেক্ষা করে।',
  ],
  'confirmCalls.switchOffDesc': [
    'Orders wait instead of being called. When the time below runs out they confirm on their own, with no call.',
    'অর্ডার কল ছাড়াই অপেক্ষা করে। নিচের সময় শেষ হলে কোনো কল ছাড়াই নিজে নিজে নিশ্চিত হয়।',
  ],
  'confirmCalls.on': ['On', 'চালু'],
  'confirmCalls.off': ['Off', 'বন্ধ'],
  'confirmCalls.ttlLabel': ['Auto-confirm after (hours)', 'অটো-কনফার্ম হবে (ঘণ্টা পর)'],
  'confirmCalls.ttlHint': [
    'Whole hours, from 1 to 168 (7 days). Used only while calls are off.',
    'পূর্ণ ঘণ্টা, 1 থেকে 168 (7 দিন)। কল বন্ধ থাকলেই কেবল প্রযোজ্য।',
  ],
  'confirmCalls.ttlHintOn': [
    'Switch calls off to set this. Whole hours, from 1 to 168 (7 days).',
    'এটি ঠিক করতে কল বন্ধ করুন। পূর্ণ ঘণ্টা, 1 থেকে 168 (7 দিন)।',
  ],
  'confirmCalls.rtoWarning': [
    'The client carries the return cost on every order that is confirmed without a call. No order is exempt, whatever its value.',
    'কল ছাড়া নিশ্চিত হওয়া প্রতিটি অর্ডারের রিটার্ন খরচ ক্লায়েন্ট বহন করে। অর্ডারের মূল্য যা-ই হোক, কোনো ছাড় নেই।',
  ],
  'confirmCalls.save': ['Save', 'সংরক্ষণ'],
  'confirmCalls.saving': ['Saving', 'সংরক্ষণ হচ্ছে'],
  'confirmCalls.saved': ['Saved', 'সংরক্ষিত'],
  'confirmCalls.notSaved': ['Not saved — retry', 'সংরক্ষণ হয়নি — আবার চেষ্টা'],
  'confirmCalls.resetToDefault': ['Reset to default', 'ডিফল্টে ফেরান'],
  'confirmCalls.notANumber': ['Enter a whole number of hours.', 'ঘণ্টার একটি পূর্ণ সংখ্যা লিখুন।'],
  'confirmCalls.sourceDefault': ['Platform default', 'প্ল্যাটফর্মের ডিফল্ট'],
  'confirmCalls.sourceOverride': ['Set for this client', 'এই ক্লায়েন্টের জন্য নির্ধারিত'],
  'confirmCalls.attrDefault': [
    'Nobody has changed this. The client is on the platform default.',
    'কেউ এটি বদলায়নি। ক্লায়েন্ট প্ল্যাটফর্মের ডিফল্টে আছে।',
  ],
  'confirmCalls.attrByStaffAt': [
    'Last set by Skydrop staff on {when}',
    '{when} তারিখে Skydrop স্টাফ সর্বশেষ নির্ধারণ করেছেন',
  ],
  'confirmCalls.attrByClientAt': [
    'Last set by the client on {when}',
    '{when} তারিখে ক্লায়েন্ট নিজে সর্বশেষ নির্ধারণ করেছেন',
  ],
  'confirmCalls.attrUnknownAt': [
    'Set as an override on {when}; who set it was not recorded.',
    '{when} তারিখে ওভাররাইড হিসেবে নির্ধারিত; কে করেছেন তা রেকর্ড নেই।',
  ],
  'confirmCalls.attrUnknown': [
    'Set as an override; who set it and when was not recorded.',
    'ওভাররাইড হিসেবে নির্ধারিত; কে ও কখন করেছেন তা রেকর্ড নেই।',
  ],
  'confirmCalls.attrClientWarning': [
    'The client chose this themselves. Saving replaces their choice.',
    'এটি ক্লায়েন্ট নিজে বেছেছেন। সংরক্ষণ করলে তাঁর পছন্দ বদলে যাবে।',
  ],
  'confirmCalls.defaultValue': ['Default: {value}', 'ডিফল্ট: {value}'],
  'confirmCalls.defaultOn': [
    'calls on, auto-confirm {hours}h',
    'কল চালু, অটো-কনফার্ম {hours} ঘণ্টা',
  ],

  // ── Cross-client page ──
  'awaiting.title': ['Orders awaiting confirmation', 'নিশ্চিতকরণের অপেক্ষায় থাকা অর্ডার'],
  'awaiting.subtitle': [
    'Orders from clients who switched phone confirmation off. They confirm on their own when the time runs out; send one for a call to confirm it sooner.',
    'যেসব ক্লায়েন্ট ফোন নিশ্চিতকরণ বন্ধ রেখেছেন তাঁদের অর্ডার। সময় শেষ হলে নিজে নিজে নিশ্চিত হয়; আগে নিশ্চিত করতে কলের জন্য পাঠান।',
  ],
  'awaiting.crumbOps': ['Call centre', 'কল সেন্টার'],
  'awaiting.count': ['{total} waiting', '{total}টি অপেক্ষায়'],
  'awaiting.clientFilter': ['Client', 'ক্লায়েন্ট'],
  'awaiting.allClients': ['All clients', 'সব ক্লায়েন্ট'],
  'awaiting.thisClient': ['This client', 'এই ক্লায়েন্ট'],
  'awaiting.colOrder': ['Order', 'অর্ডার'],
  'awaiting.colClient': ['Client', 'ক্লায়েন্ট'],
  'awaiting.colRecipient': ['Recipient', 'প্রাপক'],
  'awaiting.colCod': ['COD', 'COD'],
  'awaiting.colItems': ['Items', 'আইটেম'],
  'awaiting.colPlaced': ['Placed', 'অর্ডারের সময়'],
  'awaiting.colRemaining': ['Time remaining', 'অবশিষ্ট সময়'],
  'awaiting.caption': ['Orders awaiting confirmation', 'নিশ্চিতকরণের অপেক্ষায় থাকা অর্ডার'],
  'awaiting.selectAll': ['Select all orders on this page', 'এই পৃষ্ঠার সব অর্ডার নির্বাচন করুন'],
  'awaiting.selectRow': ['Select {order}', '{order} নির্বাচন করুন'],
  'awaiting.loading': ['Loading orders', 'অর্ডার লোড হচ্ছে'],
  'awaiting.autoConfirmsIn': ['Auto-confirms in {h}h {m}m', '{h} ঘণ্টা {m} মিনিটে অটো-কনফার্ম'],
  'awaiting.autoConfirmsInMin': ['Auto-confirms in {m}m', '{m} মিনিটে অটো-কনফার্ম'],
  'awaiting.autoConfirmsInDays': ['Auto-confirms in {d}d {h}h', '{d} দিন {h} ঘণ্টায় অটো-কনফার্ম'],
  'awaiting.overdue': ['Auto-confirm due now', 'অটো-কনফার্মের সময় হয়েছে'],
  'awaiting.at': ['at {when}', '{when} এ'],
  'awaiting.level.calm': ['More than 12 hours left', '12 ঘণ্টার বেশি বাকি'],
  'awaiting.level.soon': ['Under 12 hours left', '12 ঘণ্টার কম বাকি'],
  'awaiting.level.urgent': ['Under 3 hours left', '3 ঘণ্টার কম বাকি'],
  'awaiting.level.overdue': ['Past its time', 'সময় পেরিয়ে গেছে'],
  'awaiting.noTimer': ['No timer running', 'কোনো টাইমার চলছে না'],
  'awaiting.callsBackOn': ['Calls back on', 'কল আবার চালু'],
  'awaiting.callsBackOnTitle': [
    'This client has switched calls back on since this order arrived.',
    'অর্ডারটি আসার পর এই ক্লায়েন্ট কল আবার চালু করেছেন।',
  ],

  'awaiting.selected': ['{n} selected', '{n}টি নির্বাচিত'],
  'awaiting.selectedHint': ['Up to {max} at a time.', 'একবারে সর্বোচ্চ {max}টি।'],
  'awaiting.clear': ['Clear selection', 'নির্বাচন মুছুন'],
  'awaiting.send': ['Send for confirmation call', 'কনফার্মেশন কলের জন্য পাঠান'],
  'awaiting.sending': ['Sending', 'পাঠানো হচ্ছে'],
  'awaiting.sendDone': ['Sent', 'পাঠানো হয়েছে'],
  'awaiting.sentOf': ['{sent} of {total} sent', '{total}টির মধ্যে {sent}টি পাঠানো হয়েছে'],
  'awaiting.nothingSent': ['Nothing sent', 'কিছুই পাঠানো হয়নি'],
  'awaiting.sendFailed': ['Not sent — retry', 'পাঠানো হয়নি — আবার চেষ্টা'],
  'awaiting.pickFirst': [
    'Select orders to send them to the call queue, or to confirm them without a call.',
    'কল কিউতে পাঠাতে বা কল ছাড়াই কনফার্ম করতে অর্ডার নির্বাচন করুন।',
  ],

  // ── Confirm now, no call ──
  'awaiting.confirmNow': ['Confirm now, no call', 'এখনই কনফার্ম, কল ছাড়া'],
  'awaiting.confirming': ['Confirming', 'কনফার্ম হচ্ছে'],
  'awaiting.confirmedLabel': ['Confirmed', 'কনফার্ম হয়েছে'],
  'awaiting.confirmNothing': ['Nothing confirmed', 'কিছুই কনফার্ম হয়নি'],
  'awaiting.confirmFailed': ['Not confirmed — retry', 'কনফার্ম হয়নি — আবার চেষ্টা'],
  'awaiting.confirmedOf': [
    '{done} of {total} confirmed',
    '{total}টির মধ্যে {done}টি কনফার্ম হয়েছে',
  ],
  'awaiting.confirmNowTitle': [
    'Confirm without calling the customer?',
    'কাস্টমারকে ফোন না করেই কনফার্ম করবেন?',
  ],
  'awaiting.confirmNowEntity': ['{n} selected order(s)', 'নির্বাচিত {n}টি অর্ডার'],
  'awaiting.confirmNowBody': [
    'Nobody will phone these customers. Stock is claimed for each order straight away and they go on to packing. The COD confirmation call is the step that holds returns down, and the client carries the return cost on anything that comes back.',
    'এই কাস্টমারদের কেউ ফোন করবে না। প্রতিটি অর্ডারের জন্য সঙ্গে সঙ্গে স্টক ধরে রাখা হয় এবং সেগুলো প্যাকিংয়ে চলে যায়। COD কনফার্মেশন কলই রিটার্ন কমিয়ে রাখে, আর ফেরত এলে রিটার্ন খরচ ক্লায়েন্ট বহন করেন।',
  ],
  'awaiting.confirmNowGo': ['Confirm without a call', 'কল ছাড়াই কনফার্ম করুন'],
  'awaiting.confirmNowCancel': ['Keep waiting', 'অপেক্ষাই চলুক'],
  'awaiting.confirmNowHint': [
    'Confirming sends them to packing with no call. The clock is not waited for.',
    'কনফার্ম করলে কল ছাড়াই প্যাকিংয়ে যায়। ঘড়ির জন্য অপেক্ষা করা হয় না।',
  ],
  'awaiting.confirm.allDone': [
    '{done} confirmed without a call and sent to packing.',
    'কল ছাড়াই {done}টি কনফার্ম হয়ে প্যাকিংয়ে গেছে।',
  ],
  'awaiting.confirm.mixed': [
    '{done} confirmed, {oos} out of stock, {failed} not confirmed.',
    '{done}টি কনফার্ম হয়েছে, {oos}টির স্টক নেই, {failed}টি কনফার্ম হয়নি।',
  ],
  'awaiting.confirm.noneDone': [
    'Nothing was confirmed: {oos} out of stock, {failed} not confirmed.',
    'কিছুই কনফার্ম হয়নি: {oos}টির স্টক নেই, {failed}টি কনফার্ম হয়নি।',
  ],
  'awaiting.confirm.oosNote': [
    'An out-of-stock order holds its place and can be retried once stock arrives.',
    'স্টক না থাকা অর্ডার নিজের জায়গায় থাকে; স্টক এলে আবার চেষ্টা করা যায়।',
  ],
  'awaiting.confirm.refused': ['Not confirmed', 'কনফার্ম হয়নি'],

  'awaiting.result.title': ['Result of the last send', 'সর্বশেষ পাঠানোর ফলাফল'],
  'awaiting.result.allSent': ['{sent} sent for a call.', '{sent}টি কলের জন্য পাঠানো হয়েছে।'],
  'awaiting.result.mixed': [
    '{sent} sent, {already} already queued, {failed} not sent.',
    '{sent}টি পাঠানো হয়েছে, {already}টি আগেই কিউতে ছিল, {failed}টি পাঠানো যায়নি।',
  ],
  'awaiting.result.noneSent': [
    'Nothing was sent: {already} already queued, {failed} not sent.',
    'কিছুই পাঠানো হয়নি: {already}টি আগেই কিউতে ছিল, {failed}টি পাঠানো যায়নি।',
  ],
  'awaiting.result.refused': ['Not sent', 'পাঠানো হয়নি'],
  'awaiting.result.dismiss': ['Dismiss', 'বন্ধ করুন'],

  'awaiting.emptyTitle': [
    'No client has phone confirmation switched off',
    'কোনো ক্লায়েন্টই ফোন নিশ্চিতকরণ বন্ধ রাখেননি',
  ],
  'awaiting.emptyDesc': [
    'Every client’s orders go straight to the call queue, so there is nothing waiting here. Orders appear when a client turns calls off.',
    'সব ক্লায়েন্টের অর্ডার সরাসরি কল কিউতে যায়, তাই এখানে কিছু অপেক্ষায় নেই। কোনো ক্লায়েন্ট কল বন্ধ করলে অর্ডার এখানে আসবে।',
  ],
  'awaiting.emptyFilteredTitle': [
    'Nothing waiting for this client',
    'এই ক্লায়েন্টের কিছুই অপেক্ষায় নেই',
  ],
  'awaiting.emptyFilteredDesc': [
    'Either their calls are on, or every order has already been confirmed. Clear the filter to see every client.',
    'হয় তাঁর কল চালু আছে, নয়তো সব অর্ডার ইতিমধ্যে নিশ্চিত। সব ক্লায়েন্ট দেখতে ফিল্টার মুছুন।',
  ],
  'awaiting.noAccessTitle': ['You can’t open this page', 'আপনি এই পৃষ্ঠা খুলতে পারবেন না'],
  'awaiting.noAccessDesc': [
    'Working the confirmation list needs the permission to manage the call queue. Ask an administrator if you need it.',
    'নিশ্চিতকরণ তালিকা সামলাতে কল কিউ পরিচালনার অনুমতি লাগে। প্রয়োজন হলে অ্যাডমিনকে বলুন।',
  ],
});
