import { defineMessages } from '../define';

/** "Ask the courier to correct the address" — the panel on an order whose parcel the courier already holds. */
export const consignee = defineMessages({
  'consignee.toast.accepted': [
    'The courier took the change. This is where the parcel is now going.',
    'কুরিয়ার পরিবর্তনটি গ্রহণ করেছে। পার্সেল এখন এই ঠিকানায় যাচ্ছে।',
  ],
  'consignee.refused': [
    'The courier refused it, so the parcel is still going to the address it had.',
    'কুরিয়ার এটি গ্রহণ করেনি, তাই পার্সেল আগের ঠিকানাতেই যাচ্ছে।',
  ],
  'consignee.refusedSaid': [
    'The courier refused it, so the parcel is still going to the address it had. They said: “{message}”.',
    'কুরিয়ার এটি গ্রহণ করেনি, তাই পার্সেল আগের ঠিকানাতেই যাচ্ছে। তারা বলেছে: “{message}”।',
  ],
  'consignee.title': [
    'Ask the courier to correct the address',
    'কুরিয়ারকে ঠিকানা সংশোধন করতে বলুন',
  ],
  'consignee.note': [
    'The courier already has this parcel. Only they can change where it goes, and the change is stored only if they accept it.',
    'কুরিয়ারের হাতে এই পার্সেল ইতিমধ্যে আছে। কোথায় যাবে তা শুধু তারাই বদলাতে পারে, এবং তারা মেনে নিলে তবেই পরিবর্তনটি সংরক্ষণ হয়।',
  ],
  'consignee.name': ['Name', 'নাম'],
  'consignee.phone': ['Phone', 'ফোন'],
  'consignee.address': ['Address', 'ঠিকানা'],
  'consignee.addressHint': [
    'The street address only — the city, state and PIN are what the parcel was routed on and cannot change.',
    'শুধু রাস্তার ঠিকানা — শহর, রাজ্য ও পিন দিয়েই পার্সেলের রুট ঠিক হয়েছে, তাই এগুলো বদলানো যায় না।',
  ],
  'consignee.routedTo': ['Routed to', 'রুট করা হয়েছে'],
  'consignee.ask': ['Ask the courier', 'কুরিয়ারকে জিজ্ঞেস করুন'],
  'consignee.asking': ['Asking the courier…', 'কুরিয়ারকে জিজ্ঞেস করা হচ্ছে…'],
  'consignee.history.refused': ['refused', 'প্রত্যাখ্যাত'],
  'consignee.history.refusedWith': ['refused: {message}', 'প্রত্যাখ্যাত: {message}'],
  'consignee.history.accepted': ['accepted by the courier', 'কুরিয়ার গ্রহণ করেছে'],
  'consignee.confirm.title': [
    'Ask the courier to change the address?',
    'কুরিয়ারকে ঠিকানা বদলাতে বলবেন?',
  ],
  'consignee.confirm.consequence': [
    'The courier is asked at once. The change is stored only if they accept it; if they refuse, the parcel keeps going to the address it had.',
    'কুরিয়ারকে সঙ্গে সঙ্গে জিজ্ঞেস করা হয়। তারা মেনে নিলে তবেই পরিবর্তনটি সংরক্ষণ হয়; প্রত্যাখ্যান করলে পার্সেল আগের ঠিকানাতেই যেতে থাকে।',
  ],
  'consignee.confirm.notYet': ['Not yet', 'এখনই নয়'],
});
