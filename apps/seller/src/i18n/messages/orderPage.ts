import { defineMessages } from '../define';

/**
 * Copy owned by the redesigned order page (client order detail, 2026-11-12).
 *
 * Wording is the owner-approved list. Bangla is written the way a Bangladeshi
 * seller would say it, not word for word; numerals stay 0-9.
 */
export const orderPage = defineMessages({
  // ── header ────────────────────────────────────────────────────────────
  'orderPage.back': ['Back to Orders', 'অর্ডারের তালিকায় ফিরে যান'],
  'orderPage.awbLabel': ['AWB', 'AWB'],
  'orderPage.copyNumber': ['Copy number', 'নম্বর কপি করুন'],
  'orderPage.copyLink': ['Copy link', 'লিংক কপি করুন'],
  'orderPage.copied': ['Copied', 'কপি হয়েছে'],
  'orderPage.actions': ['Order actions', 'অর্ডারের কাজ'],
  'orderPage.editOrder': ['Edit order', 'অর্ডার সম্পাদনা'],
  'orderPage.cancelOrder': ['Cancel order', 'অর্ডার বাতিল করুন'],
  'orderPage.toCollectFact': ['{amount} to collect', '{amount} আদায় করতে হবে'],
  'orderPage.col.price': ['Price', 'দাম'],
  'orderPage.price.declared': ['declared value', 'ঘোষিত মূল্য'],
  'orderPage.price.lineTotal': ['{amount} for {count}', '{count}টির দাম {amount}'],
  'orderPage.lineOne': ['{count} line', '{count}টি লাইন'],
  'orderPage.lineMany': ['{count} lines', '{count}টি লাইন'],
  'orderPage.unitOne': ['{count} unit', '{count}টি ইউনিট'],
  'orderPage.unitMany': ['{count} units', '{count}টি ইউনিট'],
  'orderPage.placedAt': ['Placed {when}', 'অর্ডার করা হয়েছে {when}'],
  'orderPage.updatedAt': ['Updated {when}', 'হালনাগাদ {when}'],
  'orderPage.lastMovedAt': ['Last moved {when}', 'সর্বশেষ নড়াচড়া {when}'],
  'orderPage.today': ['Today', 'আজ'],
  'orderPage.yesterday': ['Yesterday', 'গতকাল'],
  'orderPage.orderFacts': ['About this order', 'এই অর্ডারের তথ্য'],

  // ── summary ───────────────────────────────────────────────────────────
  'orderPage.sum.label': ['In short', 'সংক্ষেপে'],
  'orderPage.sum.collect': [
    'The courier will collect {money} from your customer.',
    'কুরিয়ার আপনার গ্রাহকের কাছ থেকে {money} আদায় করবে।',
  ],
  'orderPage.sum.prepaid': [
    'Already paid. Nothing to collect.',
    'আগেই পরিশোধ করা হয়েছে। কিছু আদায় করতে হবে না।',
  ],
  'orderPage.sum.addressFix': ['The address may need a fix.', 'ঠিকানাটা হয়তো ঠিক করা দরকার।'],
  'orderPage.sum.mismatch': [
    "The courier's amount does not match yours.",
    'কুরিয়ারের হিসাবের অঙ্কটা আপনার হিসাবের সাথে মেলে না।',
  ],
  'orderPage.sum.where.DRAFT': [
    'Saved as a draft. It has not gone to us yet.',
    'ড্রাফট হিসেবে সেভ করা আছে। এখনো আমাদের কাছে যায়নি।',
  ],
  'orderPage.sum.where.PENDING_CONFIRMATION': [
    'We have your order.',
    'আপনার অর্ডার আমাদের কাছে পৌঁছেছে।',
  ],
  'orderPage.sum.where.CALL_NO_RESPONSE': [
    'We called your customer and nobody answered. We will try again.',
    'আমরা আপনার গ্রাহককে কল করেছি, কেউ ধরেনি। আবার চেষ্টা করব।',
  ],
  'orderPage.sum.where.CALL_RESCHEDULED': [
    'Your customer asked us to call back later.',
    'আপনার গ্রাহক পরে কল করতে বলেছেন।',
  ],
  'orderPage.sum.where.CONFIRMED': ['Confirmed by phone.', 'ফোনে কনফার্ম হয়েছে।'],
  'orderPage.sum.where.OUT_OF_STOCK': [
    'An item is out of stock, so this order is on hold.',
    'একটি পণ্য স্টকে নেই, তাই অর্ডারটি আটকে আছে।',
  ],
  'orderPage.sum.where.CANCELLED': ['This order was cancelled.', 'এই অর্ডারটি বাতিল হয়েছে।'],
  'orderPage.sum.where.CANCELLED_BY_ADMIN': [
    'We cancelled this order.',
    'আমরা এই অর্ডারটি বাতিল করেছি।',
  ],
  'orderPage.sum.where.REJECTED': [
    'This order was not accepted, so it will not be sent.',
    'এই অর্ডারটি গ্রহণ করা হয়নি, তাই পাঠানো হবে না।',
  ],
  'orderPage.sum.where.REJECTED_BY_CUSTOMER': [
    'Your customer turned this order down on the phone.',
    'আপনার গ্রাহক ফোনে অর্ডারটি নিতে রাজি হননি।',
  ],
  'orderPage.sum.where.REJECTED_NDR': [
    'We called your customer several times and could not reach them, so the order was closed.',
    'কয়েকবার কল করেও আপনার গ্রাহককে পাওয়া যায়নি, তাই অর্ডারটি বন্ধ করা হয়েছে।',
  ],
  'orderPage.sum.where.AWAITING_SELLER_DECISION': [
    'We could not reach your customer. Nothing moves until you decide.',
    'আমরা আপনার গ্রাহকের নাগাল পাইনি। আপনি সিদ্ধান্ত না নেওয়া পর্যন্ত কিছু এগোবে না।',
  ],
  'orderPage.sum.where.AWAITING_COURIER': [
    'Confirmed by phone. We are waiting for a courier to take it.',
    'ফোনে কনফার্ম হয়েছে। কুরিয়ার নেওয়ার অপেক্ষায় আছি।',
  ],
  'orderPage.sum.where.PENDING_PICK': [
    'Waiting to be picked from the shelf.',
    'তাক থেকে তোলার অপেক্ষায় আছে।',
  ],
  'orderPage.sum.where.PICKED': ['Picked from the shelf.', 'তাক থেকে তোলা হয়েছে।'],
  'orderPage.sum.where.PACKED': ['Packed.', 'প্যাক করা হয়েছে।'],
  'orderPage.sum.where.PACK_FAILED': [
    'Packing hit a problem. We are looking into it.',
    'প্যাকিংয়ে সমস্যা হয়েছে। আমরা দেখছি।',
  ],
  'orderPage.sum.where.PENDING_DISPATCH': [
    'Packed and ready to go.',
    'প্যাক হয়ে গেছে, পাঠানোর জন্য তৈরি।',
  ],
  'orderPage.sum.where.PENDING_MANUAL_PLACEMENT': [
    'Our usual courier could not take it, so we are booking another courier by hand.',
    'আমাদের সাধারণ কুরিয়ার এটি নিতে পারেনি, তাই আমরা নিজেরা অন্য কুরিয়ার ঠিক করছি।',
  ],
  'orderPage.sum.where.DISPATCHED': ['Handed to the courier.', 'কুরিয়ারের হাতে দেওয়া হয়েছে।'],
  'orderPage.sum.where.IN_TRANSIT': ['On its way to your customer.', 'আপনার গ্রাহকের কাছে যাচ্ছে।'],
  'orderPage.sum.where.OUT_FOR_DELIVERY': [
    'Out for delivery today.',
    'আজ ডেলিভারির জন্য বেরিয়েছে।',
  ],
  'orderPage.sum.where.DELIVERED': [
    'Delivered to your customer.',
    'আপনার গ্রাহকের কাছে পৌঁছে গেছে।',
  ],
  'orderPage.sum.where.DELIVERY_FAILED': [
    'The courier could not deliver it.',
    'কুরিয়ার ডেলিভারি করতে পারেনি।',
  ],
  'orderPage.sum.where.RTO_INITIATED': [
    'The parcel is being sent back to us.',
    'পার্সেলটি আমাদের কাছে ফেরত পাঠানো হচ্ছে।',
  ],
  'orderPage.sum.where.RTO_IN_TRANSIT': [
    'The parcel is on its way back to us.',
    'পার্সেলটি আমাদের কাছে ফিরে আসছে।',
  ],
  'orderPage.sum.where.RTO_RECEIVED': [
    'The parcel is back with us and we are checking it.',
    'পার্সেলটি আমাদের কাছে ফিরে এসেছে, আমরা দেখে নিচ্ছি।',
  ],
  'orderPage.sum.where.RTO_RESTOCKED': [
    'The parcel is back and the items are in your stock again.',
    'পার্সেলটি ফিরে এসেছে এবং পণ্যগুলো আবার আপনার স্টকে ঢুকেছে।',
  ],
  'orderPage.sum.where.RTO_DAMAGED': [
    'The parcel is back, but the items cannot be sold again.',
    'পার্সেলটি ফিরে এসেছে, কিন্তু পণ্যগুলো আর বিক্রি করা যাবে না।',
  ],
  'orderPage.sum.where.LOST_IN_TRANSIT': [
    'The courier lost this parcel.',
    'কুরিয়ার এই পার্সেলটি হারিয়ে ফেলেছে।',
  ],
  'orderPage.sum.next.call_confirmed': [
    'Next, we call your customer to confirm.',
    'এরপর আমরা গ্রাহককে কল করে কনফার্ম করব।',
  ],
  'orderPage.sum.next.picked': [
    'Next, we pick it from the shelf.',
    'এরপর আমরা তাক থেকে পণ্য তুলব।',
  ],
  'orderPage.sum.next.packed': ['Next, we pack it.', 'এরপর আমরা প্যাক করব।'],
  'orderPage.sum.next.ready_to_dispatch': [
    'Next, it gets ready to dispatch.',
    'এরপর পাঠানোর জন্য তৈরি হবে।',
  ],
  'orderPage.sum.next.dispatched': [
    'Next, we hand it to the courier.',
    'এরপর আমরা কুরিয়ারের হাতে দেব।',
  ],
  'orderPage.sum.next.in_transit': [
    'Next, the courier moves it along.',
    'এরপর কুরিয়ার সেটা পথে নিয়ে যাবে।',
  ],
  'orderPage.sum.next.out_for_delivery': [
    'Next, it goes out for delivery.',
    'এরপর ডেলিভারির জন্য বের হবে।',
  ],
  'orderPage.sum.next.delivered': [
    'Next, it reaches your customer.',
    'এরপর গ্রাহকের কাছে পৌঁছাবে।',
  ],

  // ── stepper / milestones ──────────────────────────────────────────────
  'orderPage.step.label': ['Order progress', 'অর্ডারের অগ্রগতি'],
  'orderPage.step.of': ['Step {n} of {total}: {label}', '{total}টির মধ্যে {n} নম্বর ধাপ: {label}'],
  'orderPage.step.seeAll': ['See all steps', 'সব ধাপ দেখুন'],
  'orderPage.step.hideAll': ['Hide steps', 'ধাপগুলো লুকান'],
  'orderPage.step.done': ['Completed:', 'সম্পন্ন:'],
  'orderPage.step.current': ['Current step:', 'এখনকার ধাপ:'],
  'orderPage.step.todo': ['Still to come:', 'এখনো বাকি:'],
  'orderPage.step.skipped': ['Skipped:', 'বাদ গেছে:'],
  'orderPage.step.estimated': ['Estimated {date}', 'আনুমানিক {date}'],
  'orderPage.m.order_received': ['Order received', 'অর্ডার পেয়েছি'],
  'orderPage.m.call_confirmed': ['Confirmed by phone', 'ফোনে কনফার্ম হয়েছে'],
  'orderPage.m.picked': ['Picked from shelf', 'তাক থেকে তোলা হয়েছে'],
  'orderPage.m.packed': ['Packed', 'প্যাক হয়েছে'],
  'orderPage.m.ready_to_dispatch': ['Ready to dispatch', 'পাঠানোর জন্য তৈরি'],
  'orderPage.m.dispatched': ['Handed to courier', 'কুরিয়ারের হাতে দেওয়া হয়েছে'],
  'orderPage.m.in_transit': ['In transit', 'পথে আছে'],
  'orderPage.m.out_for_delivery': ['Out for delivery', 'ডেলিভারির জন্য বেরিয়েছে'],
  'orderPage.m.delivered': ['Delivered', 'ডেলিভারি হয়েছে'],
  'orderPage.m.lost': ['Lost in transit', 'পথে হারিয়ে গেছে'],
  'orderPage.m.returning': ['Coming back to us', 'আমাদের কাছে ফিরে আসছে'],
  'orderPage.m.rto_received': ['Back in our warehouse', 'আমাদের গুদামে ফিরে এসেছে'],
  'orderPage.m.rto_restocked': ['Back in your stock', 'আপনার স্টকে ফিরেছে'],
  'orderPage.m.rto_damaged': ['Not sellable', 'বিক্রির উপযোগী নয়'],

  // ── cards ─────────────────────────────────────────────────────────────
  'orderPage.collapse': ['Collapse {title}', '{title} ছোট করুন'],
  'orderPage.expand': ['Expand {title}', '{title} খুলুন'],
  'orderPage.card.recipient': ['Recipient & address', 'প্রাপক ও ঠিকানা'],
  'orderPage.card.recipientNote': [
    'Saved when the order was placed.',
    'অর্ডার দেওয়ার সময় যা সংরক্ষিত হয়েছিল।',
  ],
  'orderPage.card.items': ['Items & charges', 'পণ্য ও চার্জ'],
  'orderPage.card.itemsNote': [
    'What is in this order and what it costs you.',
    'অর্ডারে কী কী আছে আর এতে আপনার কত খরচ।',
  ],
  'orderPage.card.extrasNote': [
    'Saved as written. We did not use or act on these.',
    'যেমন লেখা ছিল তেমনই রাখা আছে। এগুলো আমরা ব্যবহার করিনি।',
  ],
  'orderPage.card.payment': ['Payment & package', 'পেমেন্ট ও প্যাকেজ'],
  'orderPage.card.troubleNote': [
    'What we said to your customer and what you asked us to do.',
    'গ্রাহককে আমরা কী বলেছি আর আপনি আমাদের কী করতে বলেছেন।',
  ],
  'orderPage.card.issuesNote': [
    'Questions you have raised with us about this order.',
    'এই অর্ডার নিয়ে আপনি আমাদের কাছে যা যা জানিয়েছেন।',
  ],
  'orderPage.card.activity': ['Activity', 'কার্যকলাপ'],
  'orderPage.card.activityNote': [
    'Everything that happened to this order, newest first.',
    'এই অর্ডারে যা যা ঘটেছে, সবচেয়ে নতুনটা আগে।',
  ],
  'orderPage.card.addressAttention': ['Address needs attention', 'ঠিকানায় নজর দেওয়া দরকার'],
  'orderPage.card.parcelNone': ['No parcel booked yet.', 'এখনো কোনো পার্সেল বুক হয়নি।'],

  // ── recipient ─────────────────────────────────────────────────────────
  'orderPage.rec.altPhone': ['Other phone', 'অন্য ফোন'],
  'orderPage.rec.landmark': ['Landmark', 'ল্যান্ডমার্ক'],
  'orderPage.rec.cityState': ['City and state', 'শহর ও রাজ্য'],
  'orderPage.rec.pin': ['PIN code', 'পিন কোড'],
  'orderPage.rec.country': ['Country', 'দেশ'],
  'orderPage.rec.call': ['Call {phone}', '{phone} নম্বরে কল করুন'],

  // ── address check ─────────────────────────────────────────────────────
  'orderPage.ac.approve': ['Address looks good', 'ঠিকানাটা ঠিকঠাক মনে হচ্ছে'],
  'orderPage.ac.confirm': [
    'Check this address with your customer',
    'এই ঠিকানা গ্রাহকের সাথে মিলিয়ে নিন',
  ],
  'orderPage.ac.reject': [
    'This address will likely fail',
    'এই ঠিকানায় ডেলিভারি ব্যর্থ হওয়ার সম্ভাবনা বেশি',
  ],
  'orderPage.ac.outOf': ['{score} out of 100', '100-এর মধ্যে {score}'],
  'orderPage.ac.issues': ['What could be better', 'যা আরও ভালো হতে পারত'],
  'orderPage.ac.questions': ['Questions to ask your customer', 'গ্রাহককে যা জিজ্ঞেস করবেন'],
  'orderPage.ac.labelAddress': ['Address for the label', 'লেবেলের জন্য ঠিকানা'],
  'orderPage.ac.parsed': [
    'How we read this address ({count})',
    'আমরা ঠিকানাটা যেভাবে পড়েছি ({count})',
  ],
  'orderPage.ac.rto': ['Chance of return: {pct}%', 'ফেরত আসার সম্ভাবনা: {pct}%'],
  'orderPage.ac.rtoNone': [
    'Chance of return: not enough data yet',
    'ফেরত আসার সম্ভাবনা: এখনো যথেষ্ট তথ্য নেই',
  ],

  // ── parcel ────────────────────────────────────────────────────────────
  'orderPage.parcel.awb': ['Tracking number (AWB)', 'ট্র্যাকিং নম্বর (AWB)'],
  'orderPage.parcel.allParcels': ['All parcels', 'সব পার্সেল'],
  'orderPage.parcel.share': ['Share with your customer', 'আপনার গ্রাহকের সাথে শেয়ার করুন'],
  'orderPage.parcel.billedWeight': ['Weight the courier bills for', 'কুরিয়ার যে ওজনে বিল করে'],
  'orderPage.parcel.notWeighed': ['Not yet weighed', 'এখনো ওজন করা হয়নি'],
  'orderPage.parcel.youDeclared': ['You declared {grams} g', 'আপনি ঘোষণা করেছিলেন {grams} g'],
  'orderPage.parcel.size': ['Size (cm)', 'মাপ (সেমি)'],
  'orderPage.parcel.expected': ['Expected delivery', 'ডেলিভারির আনুমানিক তারিখ'],
  'orderPage.parcel.notStated': ['Not stated yet', 'এখনো জানানো হয়নি'],
  'orderPage.parcel.collects': ['Courier collects at the door', 'কুরিয়ার দরজায় যা আদায় করে'],
  'orderPage.parcel.nothingPrepaid': ['Nothing — prepaid', 'কিছু না — প্রিপেইড'],
  'orderPage.parcel.collectsHint': [
    'What the courier collects at the door',
    'দরজায় কুরিয়ার যে টাকা আদায় করে',
  ],
  'orderPage.parcel.mismatch': [
    'The courier says {amount} — this does not match',
    'কুরিয়ার বলছে {amount} — এটা মেলে না',
  ],
  'orderPage.parcel.pickedUp': ['Picked up by courier', 'কুরিয়ার যখন নিয়েছে'],
  'orderPage.parcel.notYet': ['Not yet', 'এখনো না'],
  'orderPage.parcel.latest': ["Courier's latest update", 'কুরিয়ারের সর্বশেষ আপডেট'],
  'orderPage.parcel.routing': ['Courier routing code', 'কুরিয়ারের রাউটিং কোড'],

  // ── payment & package ─────────────────────────────────────────────────
  'orderPage.pay.declared': ['Value you declared', 'আপনার ঘোষিত মূল্য'],
  'orderPage.pay.special': ['Special handling', 'বিশেষ হ্যান্ডলিং'],
  'orderPage.pay.none': ['None', 'নেই'],
  'orderPage.pay.notSet': ['Not set', 'ঠিক করা নেই'],

  // ── items & charges ───────────────────────────────────────────────────
  'orderPage.items.chargesHeading': ['What this order costs you', 'এই অর্ডারে আপনার খরচ'],
  'orderPage.charge.estimated': ['Estimated', 'আনুমানিক'],
  'orderPage.charge.confirmed': ['Confirmed', 'নিশ্চিত'],
  'orderPage.charge.final': ['Final', 'চূড়ান্ত'],
  'orderPage.charge.disputed': ['Disputed', 'আপত্তি তোলা হয়েছে'],
  'orderPage.charge.adjusted': ['Adjusted', 'সমন্বয় করা হয়েছে'],

  // ── trouble panel ─────────────────────────────────────────────────────
  'orderPage.trouble.showNotes': ['Show details', 'বিস্তারিত দেখুন'],
  'orderPage.trouble.hideNotes': ['Hide details', 'বিস্তারিত লুকান'],

  // ── activity ──────────────────────────────────────────────────────────
  'orderPage.act.view': ['Activity view', 'কার্যকলাপের ধরন'],
  'orderPage.act.history': ['Full history ({count})', 'সম্পূর্ণ ইতিহাস ({count})'],
  'orderPage.act.milestones': ['Milestones ({count})', 'ধাপসমূহ ({count})'],
  'orderPage.act.showAll': ['Show all ({count})', 'সব দেখুন ({count})'],
  'orderPage.act.showLess': ['Show less', 'কম দেখুন'],
  'orderPage.act.empty': ['Nothing has happened to this order yet.', 'এই অর্ডারে এখনো কিছু ঘটেনি।'],
  'orderPage.act.attempt': ['Delivery attempt {n}', 'ডেলিভারির চেষ্টা {n}'],
  'orderPage.act.reached': ['Reached the customer', 'গ্রাহকের সাথে কথা হয়েছে'],
  'orderPage.act.notReached': ['Could not reach the customer', 'গ্রাহকের নাগাল পাওয়া যায়নি'],
  'orderPage.act.nextAttempt': ['Next attempt {when}', 'পরের চেষ্টা {when}'],
  'orderPage.act.driver': ['Driver {name}', 'ড্রাইভার {name}'],
  'orderPage.act.unnamed': ['unnamed', 'নাম জানা নেই'],
  'orderPage.act.noMeaning': ['meaning not in our table', 'এর অর্থ আমাদের তালিকায় নেই'],
  'orderPage.act.reattempt': ['a re-attempt can be requested', 'আবার চেষ্টা করতে বলা যাবে'],
  'orderPage.act.reschedule': ['a pickup reschedule applies', 'পিকআপের সময় বদলানো যাবে'],

  // ── loading ───────────────────────────────────────────────────────────
  'orderPage.loadingSteps': ['Loading the steps…', 'ধাপগুলো লোড হচ্ছে…'],
});
