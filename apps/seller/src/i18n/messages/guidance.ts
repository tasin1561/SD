import { defineMessages } from '../define';

/** Copy owned by the "guidance" feature. */
export const guidance = defineMessages({
  'guidance.addressLine1Hint': [
    'The address only, in this order — Village/City, Post Office, Police Station, District. No extra words; the PIN below decides the rest.',
    'শুধু ঠিকানা, এই ক্রমে — গ্রাম/শহর, পোস্ট অফিস, থানা, জেলা। বাড়তি কোনো শব্দ নয়; বাকিটা নিচের পিন ঠিক করে দেয়।',
  ],
  'guidance.addressLine2Hint': [
    'The landmark only — a hospital, school or shop nearby. Nothing else, and never a copy of line 1: an order with both lines the same is held.',
    'শুধু ল্যান্ডমার্ক — কাছের হাসপাতাল, স্কুল বা দোকান। আর কিছু নয়, আর কখনো 1ম লাইনের কপি নয়: দুই লাইন একই হলে অর্ডারটি আটকে যায়।',
  ],
  'guidance.duplicateLines': [
    'Address line 2 repeats line 1. Put the landmark or the rest of the address here, or leave it empty.',
    'ঠিকানার 2য় লাইন 1ম লাইনের পুনরাবৃত্তি। এখানে ল্যান্ডমার্ক বা ঠিকানার বাকি অংশ লিখুন, অথবা ফাঁকা রাখুন।',
  ],
  'guidance.phoneError': [
    'Phone must be {len} digits starting 6, 7, 8 or 9 (after {dial}).',
    'ফোন নম্বর {len} সংখ্যার হতে হবে, শুরুতে 6, 7, 8 বা 9 ({dial}-এর পর)।',
  ],
  'guidance.prefixHint': [
    'Saved as “{prefix} <name>” — your code, so we can tell your parcels apart',
    '“{prefix} <নাম>” হিসেবে সংরক্ষিত হবে — এটি আপনার কোড, যাতে আমরা আপনার পার্সেল আলাদা করতে পারি',
  ],
});
