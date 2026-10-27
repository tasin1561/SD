import { defineMessages } from '../define';

/** The "Something wrong with the delivery?" panel on an order: recall, re-attempt, send back. */
export const orderActions = defineMessages({
  'ordact.recall.label': ['Call the customer again', 'গ্রাহককে আবার ফোন করুন'],
  'ordact.recall.ask': [
    'Our call centre will ring them. Say what they should be asked.',
    'আমাদের কল সেন্টার তাঁকে ফোন করবে। তাঁকে কী জিজ্ঞেস করা হবে তা লিখুন।',
  ],
  'ordact.reattempt.label': ['Try delivering again', 'আবার ডেলিভারির চেষ্টা করুন'],
  'ordact.reattempt.ask': [
    'The courier is asked to attempt the delivery again. Say what changed — a corrected landmark, a time they will be in.',
    'কুরিয়ারকে আবার ডেলিভারির চেষ্টা করতে বলা হবে। কী বদলেছে তা লিখুন — ঠিক করা ল্যান্ডমার্ক, বা গ্রাহক কখন বাসায় থাকবেন।',
  ],
  'ordact.rto.label': ['Send it back', 'ফেরত পাঠান'],
  'ordact.rto.ask': [
    'The parcel stops going to the customer and comes back to the warehouse. Say why.',
    'পার্সেল গ্রাহকের কাছে যাওয়া বন্ধ করে ওয়্যারহাউসে ফিরে আসবে। কেন তা লিখুন।',
  ],
  'ordact.failedFallback': ['It could not be carried out.', 'এটি করা সম্ভব হয়নি।'],
  'ordact.toast.sentToSeller': [
    'Sent to Client staff to approve. Nothing happens until they answer.',
    'অনুমোদনের জন্য ক্লায়েন্টের স্টাফের কাছে পাঠানো হয়েছে। তাঁরা উত্তর না দেওয়া পর্যন্ত কিছুই হবে না।',
  ],
  'ordact.toast.done': ['Done.', 'হয়ে গেছে।'],
  'ordact.loading': ['Loading what you can ask for', 'আপনি কী কী অনুরোধ করতে পারেন তা লোড হচ্ছে'],
  'ordact.waitsSeller': [
    'The client sees this and decides. Nothing happens to the parcel until they answer.',
    'ক্লায়েন্ট এটি দেখে সিদ্ধান্ত নেবেন। তাঁরা উত্তর না দেওয়া পর্যন্ত পার্সেলে কিছুই হবে না।',
  ],
  'ordact.immediate': [
    'This is carried out as soon as you send it.',
    'পাঠানোর সঙ্গে সঙ্গেই এটি কার্যকর হবে।',
  ],
  'ordact.title': ['Something wrong with the delivery?', 'ডেলিভারিতে কোনো সমস্যা?'],
  'ordact.note': [
    'What you can ask for is set by the client. Some of it happens straight away; some goes to them first.',
    'আপনি কী অনুরোধ করতে পারেন তা ক্লায়েন্ট ঠিক করেন। কিছু তখনই হয়ে যায়; কিছু আগে তাঁদের কাছে যায়।',
  ],
  'ordact.noneEnabled': [
    'The client has not enabled any of these for your store.',
    'ক্লায়েন্ট আপনার স্টোরের জন্য এগুলোর কোনোটিই চালু করেননি।',
  ],
  'ordact.stageClosed': [
    'Calling the customer again, another delivery attempt and sending the parcel back are available only while the parcel is out for delivery or has just failed to deliver.',
    'গ্রাহককে আবার ফোন করা, আরেকবার ডেলিভারির চেষ্টা এবং পার্সেল ফেরত পাঠানো — এগুলো শুধু তখনই করা যায় যখন পার্সেল ডেলিভারির জন্য বেরিয়েছে বা ডেলিভারি সবে ব্যর্থ হয়েছে।',
  ],
  'ordact.approvesFirst': [
    'The client approves this one before anything happens',
    'কিছু হওয়ার আগে ক্লায়েন্ট এটি অনুমোদন করেন',
  ],
  'ordact.happensNow': ['Happens as soon as you ask', 'অনুরোধ করার সঙ্গে সঙ্গেই হয়ে যায়'],
  'ordact.history.caption': ['What you asked for', 'আপনি যা অনুরোধ করেছেন'],
  'ordact.col.asked': ['What you asked', 'আপনি কী জিজ্ঞেস করেছেন'],
  'ordact.col.when': ['When', 'কখন'],
  'ordact.col.state': ['Where it got to', 'এখন কী অবস্থায়'],
  'ordact.theySaid': ['They said: “{note}”', 'তাঁরা বলেছেন: “{note}”'],
  'ordact.neverMind': ['Never mind', 'থাক'],
  'ordact.send': ['Send it', 'পাঠান'],
  'ordact.sending': ['Sending…', 'পাঠানো হচ্ছে…'],
  'ordact.whatHappened': ['What happened', 'কী ঘটেছে'],
  'ordact.whatHappenedHint': [
    'At least a sentence — a person reads this before acting on it.',
    'অন্তত একটি বাক্য লিখুন — পদক্ষেপ নেওয়ার আগে একজন মানুষ এটি পড়েন।',
  ],
  'ordact.confirm.back': ['Back', 'ফিরে যান'],
});
