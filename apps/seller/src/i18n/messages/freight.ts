import { defineMessages } from '../define';

/** Copy owned by the "freight" feature. */
export const freight = defineMessages({
  'freight.clientConsole': ['Client console', 'ক্লায়েন্ট কনসোল'],
  'freight.money': ['Money', 'টাকা'],
  'freight.inboundFreight': ['Inbound freight', 'ইনবাউন্ড ফ্রেইট'],
  'freight.theShippingCostOf': [
    'The shipping cost of getting your stock from Bangladesh into our Indian warehouse. WHEN it is charged depends on the terms agreed for each consignment — see Terms on each row.',
    'বাংলাদেশ থেকে আপনার স্টক আমাদের ভারতের ওয়্যারহাউসে আনার শিপিং খরচ। এটি কখন কাটা হয় তা প্রতিটি কনসাইনমেন্টের জন্য ঠিক করা শর্তের ওপর নির্ভর করে — প্রতিটি সারির শর্ত দেখুন।',
  ],
  'freight.stillOwed': ['{span}Still owed', '{span}এখনো বাকি'],
  'freight.ofUnitsCharged': [
    '{unitsSettled} of {unitsTotal} units charged',
    '{unitsTotal}টির মধ্যে {unitsSettled}টি ইউনিট চার্জ করা হয়েছে',
  ],
  'freight.stillOwed2': ['Still owed', 'এখনো বাকি'],
  'freight.whatIsStillTo': [
    'What is still to be taken from your wallet',
    'আপনার ওয়ালেট থেকে এখনো যা কাটা বাকি',
  ],
  'freight.billedToYou': ['Billed to you', 'আপনাকে বিল করা হয়েছে'],
  'freight.chargedSoFar': ['Charged so far', 'এ পর্যন্ত চার্জ করা হয়েছে'],
  'freight.consignmentsBilled': ['Consignments billed', 'বিল হওয়া কনসাইনমেন্ট'],
  'freight.everyStatus': ['Every status.', 'সব স্ট্যাটাস।'],
  'freight.unitsCharged': ['Units charged', 'চার্জ করা ইউনিট'],
  'freight.aUnitIsCharged': [
    'A unit is charged its share when it is delivered.',
    'একটি ইউনিট ডেলিভারি হলে তার ভাগ চার্জ করা হয়।',
  ],
  'freight.freightBills': ['Freight bills', 'ফ্রেইট বিল'],
  'freight.reset': ['Reset', 'রিসেট'],
  'freight.filterByStatus': ['Filter by status', 'স্ট্যাটাস অনুযায়ী ফিল্টার'],
  'freight.allBills': ['All bills', 'সব বিল'],
  'freight.failedToLoadFreight': ['Failed to load freight bills.', 'ফ্রেইট বিল লোড করা যায়নি।'],
  'freight.loadingFreightBills': ['Loading freight bills…', 'ফ্রেইট বিল লোড হচ্ছে…'],
  'freight.noBillsWithThat': ['No bills with that status', 'এই স্ট্যাটাসে কোনো বিল নেই'],
  'freight.noFreightBillsYet': ['No freight bills yet', 'এখনো কোনো ফ্রেইট বিল নেই'],
  'freight.tryAnotherStatusOr': [
    'Try another status, or reset the filter.',
    'অন্য স্ট্যাটাস দিয়ে চেষ্টা করুন, অথবা ফিল্টার রিসেট করুন।',
  ],
  'freight.aBillAppearsHere': [
    'A bill appears here once we receive a consignment from you and record what the freight cost.',
    'আপনার কাছ থেকে একটি কনসাইনমেন্ট গ্রহণ করে ফ্রেইটের খরচ নথিভুক্ত করলে একটি বিল এখানে দেখা যাবে।',
  ],
  'freight.consignment': ['Consignment', 'কনসাইনমেন্ট'],
  'freight.terms': ['Terms', 'শর্ত'],
  'freight.total': ['Total', 'মোট'],
  'freight.status': ['Status', 'স্ট্যাটাস'],
  'freight.includesServiceCharge': ['includes {money} service charge', '{money} সার্ভিস চার্জসহ'],
  'freight.nothingWithdrawn': ['Nothing — withdrawn', 'কিছু না — প্রত্যাহার করা হয়েছে'],
  'freight.howABillIs': ['How a bill is charged', 'বিল কীভাবে চার্জ করা হয়'],
  'freight.onPayAsIt': [
    "On pay-as-it-sells terms, each unit carries its share of the consignment's freight, and that share is deducted from your wallet when the unit is delivered. Stock still sitting in the warehouse has not been charged for yet — which is why a bill can stay partly owed for a long time without anything being wrong.",
    'বিক্রি হওয়ার সাথে সাথে পরিশোধের শর্তে, প্রতিটি ইউনিট কনসাইনমেন্টের ফ্রেইটের নিজের ভাগ বহন করে, এবং ইউনিটটি ডেলিভারি হলে সেই ভাগ আপনার ওয়ালেট থেকে কাটা হয়। ওয়্যারহাউসে পড়ে থাকা স্টকের জন্য এখনো চার্জ করা হয়নি — তাই কোনো গোলমাল না থাকলেও একটি বিল অনেক দিন আংশিক বাকি থাকতে পারে।',
  ],
  'freight.billed': ['Billed', 'বিল করা হয়েছে'],
  'freight.withdrawnBillWrong': [
    'Withdrawn {date} — this bill was wrong and anything it charged has gone back to your wallet.',
    'প্রত্যাহার করা হয়েছে {date} — এই বিলটি ভুল ছিল এবং এর মাধ্যমে যা কাটা হয়েছিল তা আপনার ওয়ালেটে ফিরে গেছে।',
  ],
});
