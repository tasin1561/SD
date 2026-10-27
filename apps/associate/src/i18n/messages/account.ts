import { defineMessages } from '../define';

/** My account + My customers. */
export const account = defineMessages({
  'account.title': ['My account', 'আমার অ্যাকাউন্ট'],
  'account.subtitle': ['Your own login for this store.', 'এই স্টোরে আপনার নিজের লগইন।'],
  'account.paused.title': [
    'Your store has paused new orders from you',
    'আপনার স্টোর আপনার নতুন অর্ডার দেওয়া সাময়িকভাবে বন্ধ রেখেছে',
  ],
  'account.paused.body': [
    'You can still read, track and follow up everything you have already placed. Ask whoever runs your store to switch it back on.',
    'আপনি যে অর্ডারগুলো আগে দিয়েছেন সেগুলো এখনও দেখতে, ট্র্যাক করতে ও ফলো-আপ করতে পারবেন। আবার চালু করতে যিনি স্টোর চালান তাঁকে বলুন।',
  ],
  'account.you': ['You', 'আপনি'],
  'account.name': ['Name', 'নাম'],
  'account.store': ['Store', 'স্টোর'],
  'account.roles': ['Roles', 'ভূমিকা'],
  'account.and': [' and ', ' ও '],
  'account.whatYouSee': ['What you see', 'আপনি যা দেখেন'],
  'account.seesOwn': [
    'The orders and customers you placed',
    'আপনার দেওয়া অর্ডার ও আপনার গ্রাহকরা',
  ],
  'account.seesAll': ['Everything your store has placed', 'আপনার স্টোরের দেওয়া সবকিছু'],
  'account.emailConfirmed': ['Email confirmed', 'ইমেইল নিশ্চিত হয়েছে'],
  'account.linkSent': ['Link sent', 'লিংক পাঠানো হয়েছে'],
  'account.sendLink': ['Send a confirmation link', 'নিশ্চিতকরণ লিংক পাঠান'],
  'account.sending': ['Sending…', 'পাঠানো হচ্ছে…'],
  'account.notSent': ['Not sent', 'পাঠানো হয়নি'],
  'account.checkInbox': ['Check your inbox for the link.', 'লিংকের জন্য আপনার ইনবক্স দেখুন।'],
  'account.browser.title': ['This browser', 'এই ব্রাউজার'],
  'account.browser.note': [
    'How the portal moves in this browser — saved here only, so another device keeps its own choice.',
    'এই ব্রাউজারে পোর্টাল কীভাবে নড়াচড়া করবে — শুধু এখানেই সংরক্ষিত, তাই অন্য ডিভাইসের নিজস্ব পছন্দ থাকে।',
  ],
  'account.sessions.title': ['Sessions', 'সেশন'],
  'account.sessions.note': [
    'Signed in somewhere you should not be?',
    'এমন কোথাও সাইন ইন করা আছে, যেখানে থাকার কথা নয়?',
  ],
  'account.signOutAll': ['Sign out everywhere', 'সব জায়গা থেকে সাইন আউট'],
  'account.signOutAll.title': ['Sign out of every device?', 'সব ডিভাইস থেকে সাইন আউট করবেন?'],
  'account.signOutAll.consequence': [
    'Every session of yours ends, including this one.',
    'এটিসহ আপনার সব সেশন শেষ হয়ে যাবে।',
  ],

  'customers.title': ['My customers', 'আমার গ্রাহক'],
  'customers.subtitle.own': [
    'Everyone you have sold to. You see the people you placed an order for — not the rest of the store’s.',
    'আপনি যাদের কাছে বিক্রি করেছেন তারা সবাই। আপনি শুধু তাদেরই দেখেন যাদের জন্য আপনি অর্ডার দিয়েছেন — স্টোরের বাকিদের নয়।',
  ],
  'customers.subtitle.all': [
    'Everyone your store has sold to.',
    'আপনার স্টোর যাদের কাছে বিক্রি করেছে তারা সবাই।',
  ],
  'customers.section': ['Customers', 'গ্রাহক'],
  'customers.inAll': ['{n} in all', 'মোট {n}'],
  'customers.search.label': ['Search customers', 'গ্রাহক খুঁজুন'],
  'customers.search.placeholder': ['Name, phone or email', 'নাম, ফোন বা ইমেইল'],
  'customers.loading': ['Loading customers', 'গ্রাহক লোড হচ্ছে'],
  'customers.empty.none': ['No customers yet', 'এখনও কোনো গ্রাহক নেই'],
  'customers.empty.noMatch': ['Nobody matches', 'কেউ মেলেনি'],
  'customers.empty.noneBody': [
    'Everyone you place an order for appears here.',
    'আপনি যার জন্য অর্ডার দেবেন, সে এখানে দেখা যাবে।',
  ],
  'customers.empty.noMatchBody': [
    'Try a different name, number or email.',
    'অন্য একটি নাম, নম্বর বা ইমেইল দিয়ে চেষ্টা করুন।',
  ],
  'customers.table.caption': ['My customers', 'আমার গ্রাহক'],
  'customers.col.name': ['Name', 'নাম'],
  'customers.col.phone': ['Phone', 'ফোন'],
  'customers.col.email': ['Email', 'ইমেইল'],
  'customers.col.orders': ['Orders', 'অর্ডার'],
  'customers.col.last': ['Last order', 'সর্বশেষ অর্ডার'],
  'customers.noName': ['No name given', 'নাম দেওয়া নেই'],
  'customers.seeBought': ['See what they have bought', 'তারা কী কিনেছেন দেখুন'],
  'customers.pages': ['Customer pages', 'গ্রাহকের পাতা'],
});
