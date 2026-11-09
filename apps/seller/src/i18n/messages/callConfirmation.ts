import { defineMessages } from '../define';

/** Copy owned by "automatic confirmation calls" — the setting and the awaiting list. */
export const callConfirmation = defineMessages({
  'authedShell.awaitingConfirmation': ['Awaiting confirmation', 'নিশ্চিতকরণের অপেক্ষায়'],

  // ── Settings ──────────────────────────────────────────────────────────
  'callConfirm.settingTitle': ['Confirmation calls', 'কনফার্মেশন কল'],
  'callConfirm.switchLabel': [
    'Phone-confirm every new order',
    'প্রতিটি নতুন অর্ডার ফোনে কনফার্ম করুন',
  ],
  'callConfirm.switchDesc': [
    'Our call agents phone the customer before the order goes to the warehouse.',
    'গুদামে যাওয়ার আগে আমাদের কল এজেন্ট গ্রাহককে ফোন করেন।',
  ],
  'callConfirm.on': ['On', 'চালু'],
  'callConfirm.off': ['Off', 'বন্ধ'],
  'callConfirm.rtoFact': [
    'With calls off, orders are not phoned: they wait in your list and confirm on their own once the time below runs out, unless you send them for a call. A parcel that comes back is charged to you at the usual RTO fee.',
    'কল বন্ধ থাকলে অর্ডারে ফোন করা হয় না: সেগুলো আপনার তালিকায় অপেক্ষা করে এবং নিচের সময় শেষ হলে নিজে থেকেই কনফার্ম হয়ে যায়, যদি না আপনি কলের জন্য পাঠান। ফেরত আসা পার্সেলের জন্য স্বাভাবিক RTO ফি আপনার কাছ থেকে কাটা হয়।',
  ],
  'callConfirm.ttlLabel': ['Auto-confirm after (hours)', 'কত ঘণ্টা পরে অটো-কনফার্ম (ঘণ্টা)'],
  'callConfirm.ttlHint': [
    'Whole hours from {min} to {max} (up to 7 days). Used only while calls are off.',
    '{min} থেকে {max} পর্যন্ত পূর্ণ ঘণ্টা (সর্বোচ্চ 7 দিন)। কল বন্ধ থাকলেই কেবল কার্যকর।',
  ],
  'callConfirm.save': ['Save', 'সংরক্ষণ'],
  'callConfirm.saving': ['Saving…', 'সংরক্ষণ হচ্ছে…'],
  'callConfirm.saved': ['Saved', 'সংরক্ষিত'],
  'callConfirm.notSaved': ['Not saved', 'সংরক্ষিত হয়নি'],
  'callConfirm.savedToast': ['Confirmation settings saved.', 'কনফার্মেশন সেটিং সংরক্ষিত হয়েছে।'],
  'callConfirm.openList': ['Orders awaiting confirmation', 'নিশ্চিতকরণের অপেক্ষার অর্ডার'],

  // ── Awaiting page ─────────────────────────────────────────────────────
  'callConfirm.clientConsole': ['Client console', 'ক্লায়েন্ট কনসোল'],
  'callConfirm.fulfilment': ['Fulfilment', 'ফুলফিলমেন্ট'],
  'callConfirm.orders': ['Orders', 'অর্ডার'],
  'callConfirm.pageTitle': ['Awaiting confirmation', 'নিশ্চিতকরণের অপেক্ষায়'],
  'callConfirm.pageSubtitle': [
    'Send the orders that need a phone call to our agents. Anything left here confirms on its own when its time runs out.',
    'যে অর্ডারে ফোন দরকার সেগুলো আমাদের এজেন্টদের কাছে পাঠান। বাকিগুলো সময় শেষ হলে নিজে থেকেই কনফার্ম হয়ে যায়।',
  ],
  'callConfirm.waiting': ['{n} waiting', '{n}টি অপেক্ষায়'],
  'callConfirm.tableCaption': ['Orders awaiting confirmation', 'নিশ্চিতকরণের অপেক্ষার অর্ডার'],
  'callConfirm.selectAll': ['Select all orders on this page', 'এই পাতার সব অর্ডার বাছুন'],
  'callConfirm.selectRow': ['Select order {order}', 'অর্ডার {order} বাছুন'],
  'callConfirm.colOrder': ['Order', 'অর্ডার'],
  'callConfirm.colCustomer': ['Customer', 'গ্রাহক'],
  'callConfirm.colCod': ['COD', 'COD'],
  'callConfirm.colItems': ['Items', 'আইটেম'],
  'callConfirm.colPlaced': ['Placed', 'তৈরির সময়'],
  'callConfirm.colTimeLeft': ['Time left', 'বাকি সময়'],
  'callConfirm.autoIn': ['Auto-confirms in {time}', '{time} পরে অটো-কনফার্ম'],
  'callConfirm.autoNow': ['Auto-confirming now', 'এখনই অটো-কনফার্ম হচ্ছে'],
  'callConfirm.urgent': ['Urgent', 'জরুরি'],
  'callConfirm.soon': ['Soon', 'শীঘ্রই'],
  'callConfirm.deadlineAt': ['Auto-confirms at {when}', '{when}-এ অটো-কনফার্ম'],
  'callConfirm.dayUnit': ['{n}d', '{n}দিন'],
  'callConfirm.hourUnit': ['{n}h', '{n}ঘ'],
  'callConfirm.minUnit': ['{n}m', '{n}মি'],
  'callConfirm.noClock': ['No time limit running', 'কোনো সময়সীমা চলছে না'],
  'callConfirm.selected': ['{n} selected', '{n}টি বাছা হয়েছে'],
  'callConfirm.clear': ['Clear', 'মুছুন'],
  'callConfirm.send': ['Send for confirmation call', 'কনফার্মেশন কলের জন্য পাঠান'],
  'callConfirm.sending': ['Sending…', 'পাঠানো হচ্ছে…'],
  'callConfirm.sentLabel': ['Sent', 'পাঠানো হয়েছে'],
  'callConfirm.sendFailed': ['Not sent', 'পাঠানো হয়নি'],
  'callConfirm.resultSent': ['{n} sent', '{n}টি পাঠানো হয়েছে'],
  'callConfirm.resultAlready': ['{n} already queued', '{n}টি আগে থেকেই সারিতে'],
  'callConfirm.resultRefused': ['{n} not sent', '{n}টি পাঠানো যায়নি'],
  'callConfirm.refusedOrder': ['{order}', '{order}'],

  // ── Confirm now, no call ──────────────────────────────────────────────
  'callConfirm.confirmNow': ['Confirm now, no call', 'এখনই কনফার্ম, কল ছাড়া'],
  'callConfirm.confirmNowTitle': [
    'Confirm without calling the customer?',
    'কাস্টমারকে ফোন না করেই কনফার্ম করবেন?',
  ],
  'callConfirm.confirmNowEntity': ['{n} selected order(s)', 'বাছা {n}টি অর্ডার'],
  'callConfirm.confirmNowBody': [
    'Nobody will phone these customers. Your stock is claimed for each order straight away and they go on to packing. The confirmation call is what keeps COD returns down, and a parcel that comes back is charged to you at the usual RTO fee.',
    'এই কাস্টমারদের কেউ ফোন করবে না। প্রতিটি অর্ডারের জন্য সঙ্গে সঙ্গে আপনার স্টক ধরে রাখা হয় এবং সেগুলো প্যাকিংয়ে চলে যায়। কনফার্মেশন কলই COD রিটার্ন কমিয়ে রাখে, আর কোনো পার্সেল ফেরত এলে চেনা RTO ফি আপনার উপরেই পড়ে।',
  ],
  'callConfirm.confirmNowGo': ['Confirm without a call', 'কল ছাড়াই কনফার্ম করুন'],
  'callConfirm.confirmNowCancel': ['Keep waiting', 'অপেক্ষাই চলুক'],
  'callConfirm.resultConfirmed': [
    '{n} confirmed and sent to packing',
    '{n}টি কনফার্ম হয়ে প্যাকিংয়ে গেছে',
  ],
  'callConfirm.resultOutOfStock': ['{n} out of stock', '{n}টির স্টক নেই'],
  'callConfirm.resultNotConfirmed': ['{n} not confirmed', '{n}টি কনফার্ম হয়নি'],
  'callConfirm.outOfStockNote': [
    'An out-of-stock order keeps its place and can be confirmed once the stock is in.',
    'স্টক না থাকা অর্ডার নিজের জায়গায় থাকে; স্টক এলে কনফার্ম করা যাবে।',
  ],
  'callConfirm.loading': ['Loading orders', 'অর্ডার লোড হচ্ছে'],
  'callConfirm.loadFailed': ['Could not load the list', 'তালিকা লোড করা যায়নি'],

  // ── Empty states ──────────────────────────────────────────────────────
  'callConfirm.emptyOnTitle': ['Confirmation calls are on', 'কনফার্মেশন কল চালু আছে'],
  'callConfirm.emptyOnBody': [
    'Every new order is phoned by our agents, so nothing waits here. Switch calls off in your order settings to choose which orders get a call.',
    'প্রতিটি নতুন অর্ডারে আমাদের এজেন্ট ফোন করেন, তাই এখানে কিছুই অপেক্ষা করে না। কোন অর্ডারে কল যাবে তা নিজে বাছতে অর্ডার সেটিংসে কল বন্ধ করুন।',
  ],
  'callConfirm.emptyOffTitle': ['Nothing is waiting', 'কিছুই অপেক্ষায় নেই'],
  'callConfirm.emptyOffBody': [
    'New orders will appear here and confirm on their own when their time runs out.',
    'নতুন অর্ডার এখানে দেখা যাবে এবং সময় শেষ হলে নিজে থেকেই কনফার্ম হবে।',
  ],
  'callConfirm.openSettings': ['Open order settings', 'অর্ডার সেটিংস খুলুন'],
});
