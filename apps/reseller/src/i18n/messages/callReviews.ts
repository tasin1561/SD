import { defineMessages } from '../define';

/**
 * "We could not reach your customer — keep trying, or give the stock back?"
 * `callrev.*` is the answer dialog (used on the queue AND on the order);
 * `callq.*` is the queue page at /orders/call-reviews.
 */
export const callReviews = defineMessages({
  'callrev.answer': ['Answer', 'উত্তর দিন'],
  'callrev.toast.sentToSeller': [
    'Sent to Client staff to approve. Nothing changes on the order until they answer.',
    'অনুমোদনের জন্য ক্লায়েন্টের স্টাফের কাছে পাঠানো হয়েছে। তাঁরা উত্তর না দেওয়া পর্যন্ত অর্ডারে কিছুই বদলাবে না।',
  ],
  'callrev.toast.released': [
    '{units} released back into stock, and the order is rejected.',
    '{units} স্টকে ফেরত গেছে, এবং অর্ডারটি প্রত্যাখ্যাত হয়েছে।',
  ],
  'callrev.toast.keepTrying': [
    'We will keep trying to reach the customer.',
    'আমরা গ্রাহকের সঙ্গে যোগাযোগের চেষ্টা চালিয়ে যাব।',
  ],
  'callrev.toast.movedOn': [
    'Recorded — but the order had already moved on, so calling did not restart.',
    'নথিভুক্ত হয়েছে — কিন্তু অর্ডারটি ততক্ষণে এগিয়ে গিয়েছিল, তাই কল আবার শুরু হয়নি।',
  ],
  'callrev.commit.seller': [
    'Send to your client to approve',
    'অনুমোদনের জন্য আপনার ক্লায়েন্টের কাছে পাঠান',
  ],
  'callrev.commit.release': [
    'Release the stock and reject the order',
    'স্টক ছেড়ে দিন এবং অর্ডার প্রত্যাখ্যান করুন',
  ],
  'callrev.commit.keep': ['Keep trying', 'চেষ্টা চালিয়ে যান'],
  'callrev.title': [
    'Keep trying to reach the customer?',
    'গ্রাহকের সঙ্গে যোগাযোগের চেষ্টা চালিয়ে যাবেন?',
  ],
  'callrev.titleOrder': [
    '{order} — keep trying to reach the customer?',
    '{order} — গ্রাহকের সঙ্গে যোগাযোগের চেষ্টা চালিয়ে যাবেন?',
  ],
  'callrev.desc': [
    'We have tried them {tries} without an answer, and {units} of your client’s stock {verb} held for this order in the meantime.',
    'আমরা তাঁকে {tries} চেষ্টা করেছি কিন্তু উত্তর পাইনি, এবং ইতিমধ্যে আপনার ক্লায়েন্টের স্টকের {units} এই অর্ডারের জন্য আটকে {verb}।',
  ],
  'callrev.desc.seller': [
    ' Your client approves this answer first — nothing happens until Client staff say yes.',
    ' আপনার ক্লায়েন্ট আগে এই উত্তর অনুমোদন করেন — ক্লায়েন্টের স্টাফ হ্যাঁ না বলা পর্যন্ত কিছুই হবে না।',
  ],
  'callrev.tries.one': ['{n} time', '{n} বার'],
  'callrev.tries.other': ['{n} times', '{n} বার'],
  'callrev.units.one': ['{n} unit', '{n}টি ইউনিট'],
  'callrev.units.other': ['{n} units', '{n}টি ইউনিট'],
  'callrev.verb.one': ['is', 'আছে'],
  'callrev.verb.other': ['are', 'আছে'],
  'callrev.neverMind': ['Never mind', 'থাক'],
  'callrev.sending': ['Sending…', 'পাঠানো হচ্ছে…'],
  'callrev.choose': ['What should happen', 'কী করা হবে'],
  'callrev.keep.title': ['Keep trying', 'চেষ্টা চালিয়ে যান'],
  'callrev.keep.desc': [
    'The order goes back into the call queue and we ring the customer again. The stock stays held for it in the meantime.',
    'অর্ডারটি আবার কল কিউতে ফিরে যাবে এবং আমরা গ্রাহককে আবার ফোন করব। ততক্ষণ স্টক এর জন্য আটকে থাকবে।',
  ],
  'callrev.release.title': ['Give up on this order', 'এই অর্ডারটি ছেড়ে দিন'],
  'callrev.release.desc': [
    'The held stock goes back so other orders can use it.',
    'আটকে থাকা স্টক ফেরত যাবে, যাতে অন্য অর্ডার সেটি ব্যবহার করতে পারে।',
  ],
  'callrev.release.note': [
    'This cannot be undone. {units} return to available stock, {rejected} — nobody will call the customer again and nothing will be sent to them. If you want to try them yourself first, choose “Keep trying” instead.',
    'এটি আর ফেরানো যাবে না। {units} মজুত স্টকে ফিরে যাবে, {rejected} — কেউ আর গ্রাহককে ফোন করবে না এবং তাঁকে কিছু পাঠানো হবে না। আগে নিজে চেষ্টা করতে চাইলে বরং “চেষ্টা চালিয়ে যান” বেছে নিন।',
  ],
  'callrev.release.noteBold': ['and the order is rejected', 'এবং অর্ডারটি প্রত্যাখ্যাত হবে'],
  'callrev.note.release': ['Why you are giving up on it', 'কেন ছেড়ে দিচ্ছেন'],
  'callrev.note.seller': ['Why', 'কেন'],
  'callrev.note.plain': ['Note', 'নোট'],
  'callrev.hint.seller': [
    'Client staff read this before they approve or reject your answer.',
    'আপনার উত্তর অনুমোদন বা প্রত্যাখ্যানের আগে ক্লায়েন্টের স্টাফ এটি পড়েন।',
  ],
  'callrev.hint.release': [
    'Kept on the order. Your client reads this when they ask why the sale was rejected.',
    'অর্ডারে রেখে দেওয়া হয়। বিক্রিটি কেন প্রত্যাখ্যাত হলো জানতে চাইলে আপনার ক্লায়েন্ট এটি পড়েন।',
  ],
  'callrev.hint.plain': [
    'Optional — anything the call centre should know.',
    'ঐচ্ছিক — কল সেন্টারের যা জানা দরকার।',
  ],

  'callq.title': ['Customers we could not reach', 'যে গ্রাহকদের নাগাল আমরা পাইনি'],
  'callq.subtitle': [
    'Orders where we rang the customer as often as your client allows and never got through. Until you answer, the stock stays held and nothing is sent.',
    'যে অর্ডারে আপনার ক্লায়েন্টের অনুমোদিত সংখ্যক বার ফোন করেও গ্রাহকের নাগাল পাওয়া যায়নি। আপনি উত্তর না দেওয়া পর্যন্ত স্টক আটকে থাকবে এবং কিছু পাঠানো হবে না।',
  ],
  'callq.allOrders': ['All orders', 'সব অর্ডার'],
  'callq.kpi.units': ['Units held waiting on you', 'আপনার উত্তরের অপেক্ষায় আটকে থাকা ইউনিট'],
  'callq.kpi.unitsHint': [
    'Your client cannot sell these to anyone else meanwhile',
    'ততক্ষণ আপনার ক্লায়েন্ট এগুলো অন্য কারও কাছে বিক্রি করতে পারেন না',
  ],
  'callq.kpi.orders': ['Orders waiting on an answer', 'উত্তরের অপেক্ষায় থাকা অর্ডার'],
  'callq.kpi.ordersHint': [
    'Each has a customer who has not heard from you',
    'প্রতিটির গ্রাহক আপনার কাছ থেকে কোনো খবর পাননি',
  ],
  'callq.section': ['Waiting on you', 'আপনার উত্তরের অপেক্ষায়'],
  'callq.answeredBySeller': [
    'The client answers call-attempt questions for this store. Ask them whether to keep trying.',
    'এই স্টোরের কল-চেষ্টার প্রশ্নের উত্তর ক্লায়েন্ট দেন। চেষ্টা চালিয়ে যাওয়া হবে কি না, তাঁদের জিজ্ঞেস করুন।',
  ],
  'callq.loading': [
    'Loading the orders we could not confirm',
    'যে অর্ডার নিশ্চিত করা যায়নি সেগুলো লোড হচ্ছে',
  ],
  'callq.empty.title': ['Nothing waiting', 'অপেক্ষায় কিছু নেই'],
  'callq.empty.body': [
    'When we run out of call attempts on one of your orders without reaching the customer, it appears here for you to decide: keep trying, or give the stock back.',
    'আপনার কোনো অর্ডারে গ্রাহকের নাগাল না পেয়ে কল করার সুযোগ শেষ হয়ে গেলে সেটি এখানে দেখা যাবে, আপনি সিদ্ধান্ত নেবেন: চেষ্টা চালিয়ে যাবেন, নাকি স্টক ফেরত দেবেন।',
  ],
  'callq.empty.go': ['Go to your orders', 'আপনার অর্ডারে যান'],
  'callq.caption': ['Orders waiting on your answer', 'আপনার উত্তরের অপেক্ষায় থাকা অর্ডার'],
  'callq.col.order': ['Order', 'অর্ডার'],
  'callq.col.customer': ['Customer', 'গ্রাহক'],
  'callq.col.units': ['Units held', 'আটকে থাকা ইউনিট'],
  'callq.col.calls': ['Calls made', 'কল করা হয়েছে'],
  'callq.col.waiting': ['Waiting', 'অপেক্ষা'],
  'callq.col.answer': ['Your answer', 'আপনার উত্তর'],
  'callq.openOrder': ['Open the order', 'অর্ডারটি খুলুন'],
  'callq.propose': ['Propose an answer', 'একটি উত্তর প্রস্তাব করুন'],
  'callq.answer': ['Answer', 'উত্তর দিন'],
  'callq.wait.lessThanHour': ['less than an hour', 'এক ঘণ্টারও কম'],
  'callq.wait.hour': ['{n} hour', '{n} ঘণ্টা'],
  'callq.wait.hours': ['{n} hours', '{n} ঘণ্টা'],
  'callq.wait.days': ['{n} days', '{n} দিন'],
});
