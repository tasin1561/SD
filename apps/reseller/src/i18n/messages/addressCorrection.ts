import { defineMessages } from '../define';

/** "Something wrong with this order?" — the edit form for an order's delivery details. */
export const addressCorrection = defineMessages({
  'addrfix.field.recipientName': ['Name', 'নাম'],
  'addrfix.field.recipientPhoneE164': ['Phone', 'ফোন'],
  'addrfix.field.recipientAltPhoneE164': ['Second phone', 'দ্বিতীয় ফোন'],
  'addrfix.field.recipientEmail': ['Email', 'ইমেইল'],
  'addrfix.field.recipientAddressLine1': ['Address', 'ঠিকানা'],
  'addrfix.field.recipientAddressLine2': ['Landmark line', 'ল্যান্ডমার্কের লাইন'],
  'addrfix.field.recipientLandmark': ['Landmark (old field)', 'ল্যান্ডমার্ক (পুরোনো ঘর)'],
  'addrfix.field.recipientCity': ['City', 'শহর'],
  'addrfix.field.recipientStateProvince': ['State', 'রাজ্য'],
  'addrfix.field.recipientPostalCode': ['PIN code', 'পিন কোড'],
  'addrfix.hint.phone': [
    'With the country code, e.g. +919876543210',
    'দেশের কোডসহ, যেমন +919876543210',
  ],
  'addrfix.hint.line2': [
    'The landmark goes here — it is what a driver finds a rural address by.',
    'ল্যান্ডমার্ক এখানে লিখুন — গ্রামের ঠিকানা ড্রাইভার এটি দেখেই খুঁজে পান।',
  ],
  'addrfix.toast.applied': [
    'Corrected. The parcel now goes to the new address.',
    'সংশোধন হয়েছে। পার্সেল এখন নতুন ঠিকানায় যাবে।',
  ],
  'addrfix.toast.sent': [
    'Sent to client staff. The parcel keeps the old address until they answer.',
    'ক্লায়েন্টের স্টাফের কাছে পাঠানো হয়েছে। তাঁরা উত্তর না দেওয়া পর্যন্ত পার্সেল পুরোনো ঠিকানাতেই থাকবে।',
  ],
  'addrfix.loading': ['Loading the delivery details', 'ডেলিভারির তথ্য লোড হচ্ছে'],
  'addrfix.send.waits': ['Send it to client staff', 'ক্লায়েন্টের স্টাফের কাছে পাঠান'],
  'addrfix.send.direct': ['Correct it', 'সংশোধন করুন'],
  'addrfix.consequence.waits': [
    'Client staff decide this one. The parcel keeps the OLD address until they answer.',
    'এটি ক্লায়েন্টের স্টাফ ঠিক করবেন। তাঁরা উত্তর না দেওয়া পর্যন্ত পার্সেল পুরোনো ঠিকানাতেই থাকবে।',
  ],
  'addrfix.consequence.direct': [
    'This is written onto the order as soon as you send it.',
    'পাঠানোর সঙ্গে সঙ্গেই এটি অর্ডারে লেখা হয়ে যাবে।',
  ],
  'addrfix.title': ['Something wrong with this order?', 'এই অর্ডারে কোনো সমস্যা?'],
  'addrfix.note.off': [
    'Your client does not allow this store to change its orders.',
    'আপনার ক্লায়েন্ট এই স্টোরকে অর্ডার বদলানোর অনুমতি দেননি।',
  ],
  'addrfix.note.closed': [
    'What is in the parcel can only change until the customer confirms it on our call. The customer’s details can still be corrected — while the parcel is with the courier, only if they accept it.',
    'গ্রাহক আমাদের কলে নিশ্চিত করার আগ পর্যন্তই শুধু পার্সেলের ভেতরের পণ্য বদলানো যায়। গ্রাহকের তথ্য তখনও সংশোধন করা যায় — পার্সেল কুরিয়ারের কাছে থাকলে কুরিয়ার মেনে নিলে তবেই।',
  ],
  'addrfix.note.waits': [
    'Client staff read the change and decide. Nothing on the order changes until they answer.',
    'ক্লায়েন্টের স্টাফ পরিবর্তনটি পড়ে সিদ্ধান্ত নেবেন। তাঁরা উত্তর না দেওয়া পর্যন্ত অর্ডারে কিছুই বদলাবে না।',
  ],
  'addrfix.note.direct': [
    'A change here is written onto the order straight away.',
    'এখানে করা পরিবর্তন সঙ্গে সঙ্গেই অর্ডারে লেখা হয়ে যায়।',
  ],
  'addrfix.body.off': [
    'Ask the client if anything on this order needs to change.',
    'এই অর্ডারে কিছু বদলানোর দরকার হলে ক্লায়েন্টকে জিজ্ঞেস করুন।',
  ],
  'addrfix.body.closed': [
    'This order is past that stage, so what is in the parcel stands. The customer’s details can still be corrected — ask your client, and once it is with the courier the change only sticks if the courier accepts it. Once it is out for delivery you can also ask for another attempt or for it to be sent back.',
    'এই অর্ডার সেই ধাপ পেরিয়ে গেছে, তাই পার্সেলের ভেতরের পণ্য যেমন আছে তেমনই থাকবে। গ্রাহকের তথ্য তখনও সংশোধন করা যায় — আপনার ক্লায়েন্টকে বলুন, আর পার্সেল কুরিয়ারের কাছে গেলে কুরিয়ার মেনে নিলে তবেই পরিবর্তনটি কার্যকর হয়। ডেলিভারির জন্য বেরিয়ে গেলে আপনি আরেকবার চেষ্টা করতে বা ফেরত পাঠাতেও বলতে পারেন।',
  ],
  'addrfix.change': ['Change this order', 'এই অর্ডার বদলান'],
  'addrfix.hint.open': [
    'A change on this order is still open with client staff — it has to be finished before you can send another.',
    'এই অর্ডারের একটি পরিবর্তন এখনও ক্লায়েন্টের স্টাফের কাছে খোলা আছে — আরেকটি পাঠানোর আগে এটি শেষ হতে হবে।',
  ],
  'addrfix.hint.approves': [
    'Client staff approve this one before anything changes',
    'কিছু বদলানোর আগে ক্লায়েন্টের স্টাফ এটি অনুমোদন করেন',
  ],
  'addrfix.hint.now': ['Happens as soon as you send it', 'পাঠানোর সঙ্গে সঙ্গেই হয়ে যায়'],
  'addrfix.history.caption': ['What you asked to change', 'আপনি যা বদলাতে বলেছেন'],
  'addrfix.col.asked': ['What you asked to change', 'আপনি যা বদলাতে বলেছেন'],
  'addrfix.col.why': ['Why', 'কেন'],
  'addrfix.col.when': ['When', 'কখন'],
  'addrfix.col.state': ['Where it got to', 'এখন কী অবস্থায়'],
  'addrfix.theySaid': ['They said: “{note}”', 'তাঁরা বলেছেন: “{note}”'],
  'addrfix.notApplied': ['Not applied — {reason}', 'কার্যকর হয়নি — {reason}'],
  'addrfix.dlg.title': ['Correct the delivery address', 'ডেলিভারির ঠিকানা সংশোধন করুন'],
  'addrfix.dlg.neverMind': ['Never mind', 'থাক'],
  'addrfix.dlg.sending': ['Sending…', 'পাঠানো হচ্ছে…'],
  'addrfix.dlg.why': ['Why the details are wrong', 'তথ্য ভুল কেন'],
  'addrfix.dlg.whyHint': [
    'At least a sentence — client staff read this before deciding.',
    'অন্তত একটি বাক্য লিখুন — সিদ্ধান্ত নেওয়ার আগে ক্লায়েন্টের স্টাফ এটি পড়েন।',
  ],
  'addrfix.dlg.nothing': [
    'Nothing has changed yet — edit a detail above.',
    'এখনও কিছু বদলায়নি — উপরের কোনো তথ্য সম্পাদনা করুন।',
  ],
  'addrfix.dlg.sending.one': [
    'Sending {n} change. A box left as it is stays as it is.',
    '{n}টি পরিবর্তন পাঠানো হচ্ছে। যে ঘর যেমন আছে তেমনই থাকবে।',
  ],
  'addrfix.dlg.sending.other': [
    'Sending {n} changes. A box left as it is stays as it is.',
    '{n}টি পরিবর্তন পাঠানো হচ্ছে। যে ঘর যেমন আছে তেমনই থাকবে।',
  ],
  'addrfix.confirm.titleWaits': [
    'Send this change to client staff?',
    'এই পরিবর্তনটি ক্লায়েন্টের স্টাফের কাছে পাঠাবেন?',
  ],
  'addrfix.confirm.titleDirect': ['Correct this order now?', 'এখনই এই অর্ডার সংশোধন করবেন?'],
  'addrfix.confirm.back': ['Back', 'ফিরে যান'],
});
