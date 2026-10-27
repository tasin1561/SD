import { defineMessages } from '../define';

/** One order (`/orders/[id]`): the page itself. Its panels (actions, address, money) have their own files. */
export const orderDetail = defineMessages({
  'ordd.back': ['Orders', 'অর্ডার'],
  'ordd.loading': ['Loading the order', 'অর্ডার লোড হচ্ছে'],
  'ordd.toast.cancelled': ['Order cancelled.', 'অর্ডার বাতিল হয়েছে।'],
  'ordd.toast.sentToSeller': [
    'Sent to Client staff to approve. The order is not cancelled until they say yes.',
    'অনুমোদনের জন্য ক্লায়েন্টের স্টাফের কাছে পাঠানো হয়েছে। তাঁরা হ্যাঁ না বলা পর্যন্ত অর্ডার বাতিল হবে না।',
  ],
  'ordd.cancelBtn.send': ['Send to your client', 'আপনার ক্লায়েন্টের কাছে পাঠান'],
  'ordd.cancelBtn.cancel': ['Cancel the order', 'অর্ডারটি বাতিল করুন'],
  'ordd.placed': ['Placed {when}', 'দেওয়া হয়েছে {when}'],
  'ordd.placedRef': [
    'Your reference {ref} · placed {when}',
    'আপনার রেফারেন্স {ref} · দেওয়া হয়েছে {when}',
  ],
  'ordd.askCancel': ['Ask the client to cancel', 'ক্লায়েন্টকে বাতিল করতে বলুন'],
  'ordd.cancelOrder': ['Cancel order', 'অর্ডার বাতিল করুন'],

  'ordd.customer': ['Customer', 'গ্রাহক'],
  'ordd.name': ['Name', 'নাম'],
  'ordd.phone': ['Phone', 'ফোন'],
  'ordd.email': ['Email', 'ইমেইল'],
  'ordd.address': ['Address', 'ঠিকানা'],

  'ordd.money': ['Money', 'টাকাপয়সা'],
  'ordd.payment': ['Payment', 'পেমেন্ট'],
  'ordd.cod': ['Cash on delivery', 'ক্যাশ অন ডেলিভারি (COD)'],
  'ordd.prepaid': ['Prepaid', 'প্রিপেইড'],
  'ordd.toCollect': ['To collect', 'আদায় করতে হবে'],
  'ordd.soldFor': ['You sold it for', 'আপনি বিক্রি করেছেন'],
  'ordd.youPayClient': ['You pay the client', 'আপনি ক্লায়েন্টকে দেবেন'],
  'ordd.terms': ['Terms', 'শর্তাবলী'],
  'ordd.termsVersion': ['Version {version}', 'সংস্করণ {version}'],
  'ordd.fixedNote': [
    'Prices and terms are fixed as they were when the order was placed.',
    'অর্ডার দেওয়ার সময় দাম ও শর্তাবলী যেমন ছিল, তেমনই স্থির থাকে।',
  ],

  'ordd.products': ['Products', 'পণ্য'],
  'ordd.col.product': ['Product', 'পণ্য'],
  'ordd.col.qty': ['Qty', 'পরিমাণ'],
  'ordd.col.soldAt': ['Sold at', 'বিক্রির দাম'],
  'ordd.col.youPay': ['You pay', 'আপনি দেবেন'],

  'ordd.parcel': ['Parcel', 'পার্সেল'],
  'ordd.waybill': ['Waybill {awb} · {courier}', 'ওয়েবিল {awb} · {courier}'],

  'ordd.callcap.title': ['We could not reach your customer', 'আমরা আপনার গ্রাহকের নাগাল পাইনি'],
  'ordd.callcap.note.off': [
    'Nothing happens on this order until it is answered. The stock stays held in the meantime.',
    'উত্তর না আসা পর্যন্ত এই অর্ডারে কিছুই হবে না। ততক্ষণ স্টক আটকে থাকবে।',
  ],
  'ordd.callcap.note.on': [
    'Nothing happens on this order until you answer. The stock stays held in the meantime.',
    'আপনি উত্তর না দেওয়া পর্যন্ত এই অর্ডারে কিছুই হবে না। ততক্ষণ স্টক আটকে থাকবে।',
  ],
  'ordd.callcap.body.off': [
    'Client staff answer this question for your store. Ask your client whether to keep trying.',
    'আপনার স্টোরের হয়ে এই প্রশ্নের উত্তর ক্লায়েন্টের স্টাফ দেন। আবার চেষ্টা করা হবে কি না, ক্লায়েন্টকে জিজ্ঞেস করুন।',
  ],
  'ordd.callcap.loading': ['Loading the question', 'প্রশ্নটি লোড হচ্ছে'],
  'ordd.callcap.waiting': [
    'This order is waiting on an answer about further call attempts.',
    'আরও কল করা হবে কি না, সেই উত্তরের অপেক্ষায় এই অর্ডারটি আটকে আছে।',
  ],
  'ordd.callcap.seeAll': [
    'See everything waiting on you',
    'আপনার উত্তরের অপেক্ষায় থাকা সবকিছু দেখুন',
  ],
  'ordd.callcap.rung': [
    'We have rung them {attempts} without an answer, and {held} of your client’s stock {verb} held for this order.',
    'আমরা তাঁকে {attempts} ফোন করেছি কিন্তু উত্তর পাইনি, এবং আপনার ক্লায়েন্টের স্টকের {held} এই অর্ডারের জন্য আটকে {verb}।',
  ],
  'ordd.callcap.attempts.one': ['{n} time', '{n} বার'],
  'ordd.callcap.attempts.other': ['{n} times', '{n} বার'],
  'ordd.callcap.units.one': ['{n} unit', '{n}টি ইউনিট'],
  'ordd.callcap.units.other': ['{n} units', '{n}টি ইউনিট'],
  'ordd.callcap.verb.one': ['is', 'আছে'],
  'ordd.callcap.verb.other': ['are', 'আছে'],
  'ordd.callcap.propose': ['Propose an answer', 'একটি উত্তর প্রস্তাব করুন'],
  'ordd.callcap.answer': ['Answer this', 'উত্তর দিন'],

  'ordd.raise.client': [
    'Something wrong with this order that the client should put right?',
    'এই অর্ডারে কি এমন কিছু ভুল আছে যা ক্লায়েন্টের ঠিক করা উচিত?',
  ],
  'ordd.raise.clientLink': ['Raise it with your client', 'আপনার ক্লায়েন্টকে জানান'],
  'ordd.raise.skydrop': [
    'Damaged, lost or stuck with Skydrop?',
    'Skydrop-এর কাছে ক্ষতিগ্রস্ত, হারিয়ে যাওয়া বা আটকে আছে?',
  ],
  'ordd.raise.skydropLink': ['Raise it with Skydrop', 'Skydrop-কে জানান'],
  'ordd.raise.approveFirst': [
    ' — Client staff approve it first; it reaches Skydrop once they say yes.',
    ' — আগে ক্লায়েন্টের স্টাফ অনুমোদন করেন; তাঁরা হ্যাঁ বললে এটি Skydrop-এর কাছে পৌঁছায়।',
  ],
  'ordd.raise.clientNotTold': [
    ' — your client is not told.',
    ' — আপনার ক্লায়েন্টকে জানানো হয় না।',
  ],

  'ordd.held.loading': [
    'Loading what you asked the client',
    'ক্লায়েন্টকে আপনি যা জিজ্ঞেস করেছেন তা লোড হচ্ছে',
  ],
  'ordd.held.title': [
    'Sent to your client to approve',
    'অনুমোদনের জন্য আপনার ক্লায়েন্টের কাছে পাঠানো',
  ],
  'ordd.held.note': [
    'Nothing on these happens until Client staff answer. A request nobody answers closes after a few days — follow up with your client if that happens.',
    'ক্লায়েন্টের স্টাফ উত্তর না দেওয়া পর্যন্ত এগুলোতে কিছুই হবে না। কেউ উত্তর না দিলে অনুরোধটি কয়েক দিন পর বন্ধ হয়ে যায় — তেমন হলে আপনার ক্লায়েন্টের সঙ্গে যোগাযোগ করুন।',
  ],
  'ordd.held.col.asked': ['What you asked', 'আপনি কী জিজ্ঞেস করেছেন'],
  'ordd.held.col.when': ['When', 'কখন'],
  'ordd.held.col.state': ['Where it got to', 'এখন কী অবস্থায়'],
  'ordd.held.theySaid': ['They said: “{note}”', 'তাঁরা বলেছেন: “{note}”'],
  'ordd.held.notDone': ['Not done — {reason}', 'করা যায়নি — {reason}'],

  'ordd.timeline': ['Timeline', 'টাইমলাইন'],
  'ordd.timeline.loading': ['Loading the timeline', 'টাইমলাইন লোড হচ্ছে'],
  'ordd.timeline.empty': [
    'Nothing has happened to this order yet.',
    'এই অর্ডারে এখনও কিছুই ঘটেনি।',
  ],
  'ordd.timeline.label': ['Order timeline', 'অর্ডারের টাইমলাইন'],
  'ordd.timeline.header': ['Order', 'অর্ডার'],

  'ordd.dlg.titleAsk': [
    'Ask the client to cancel {order}?',
    'ক্লায়েন্টকে {order} বাতিল করতে বলবেন?',
  ],
  'ordd.dlg.titleCancel': ['Cancel {order}?', '{order} বাতিল করবেন?'],
  'ordd.dlg.keepIt': ['Keep it', 'রেখে দিন'],
  'ordd.dlg.sending': ['Sending…', 'পাঠানো হচ্ছে…'],
  'ordd.dlg.toCollect': ['{amount} to collect', '{amount} আদায় করতে হবে'],
  'ordd.dlg.consequence.ask': [
    'Your client approves cancels for this store. Client staff read your reason and decide; the order is cancelled only if they say yes, and only until it is packed. The customer is not told by us — let them know yourself.',
    'এই স্টোরের বাতিলের অনুরোধ আপনার ক্লায়েন্ট অনুমোদন করেন। ক্লায়েন্টের স্টাফ আপনার কারণ পড়ে সিদ্ধান্ত নেন; তাঁরা হ্যাঁ বললেই এবং প্যাক হওয়ার আগে পর্যন্তই অর্ডার বাতিল হয়। গ্রাহককে আমরা জানাই না — আপনি নিজে জানিয়ে দিন।',
  ],
  'ordd.dlg.consequence.direct': [
    'An order can be cancelled until it is packed. The customer is not told by us — let them know yourself.',
    'প্যাক হওয়ার আগে পর্যন্ত অর্ডার বাতিল করা যায়। গ্রাহককে আমরা জানাই না — আপনি নিজে জানিয়ে দিন।',
  ],
  'ordd.dlg.why.required': ['Why (required)', 'কারণ (আবশ্যক)'],
  'ordd.dlg.why.optional': ['Why (optional)', 'কারণ (ঐচ্ছিক)'],
});
