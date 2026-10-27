import { defineMessages } from '../define';

/**
 * The notification inbox and its settings. The notifications' OWN title/body
 * text, topic labels and group names are written by the API in English at send
 * time and stay as the server wrote them; this file owns the screens around them.
 * `rntf.*` the inbox, `rnts.*` the settings.
 */
export const notifications = defineMessages({
  'rntf.title': ['Notifications', 'নোটিফিকেশন'],
  'rntf.subtitle': [
    'Everything sent to you about this store. Clearing one hides it from your list; the record of what was sent is kept.',
    'এই স্টোর সম্পর্কে আপনাকে পাঠানো সবকিছু। একটি মুছলে তা আপনার তালিকা থেকে লুকিয়ে যায়; কী পাঠানো হয়েছিল তার রেকর্ড থেকে যায়।',
  ],
  'rntf.markAllRead': ['Mark all read', 'সব পড়া হয়েছে চিহ্নিত করুন'],
  'rntf.clearAll': ['Clear all', 'সব মুছুন'],
  'rntf.settings': ['Settings', 'সেটিংস'],
  'rntf.inbox': ['Inbox', 'ইনবক্স'],
  'rntf.count.one': ['{n} message', '{n}টি বার্তা'],
  'rntf.count.other': ['{n} messages', '{n}টি বার্তা'],
  'rntf.shownOfLoaded': ['{shown} of {total} loaded', '{total}টি লোডের মধ্যে {shown}টি'],
  'rntf.filter.label': ['Filter notifications', 'নোটিফিকেশন ফিল্টার করুন'],
  'rntf.filter.placeholder': ['Filter what is loaded…', 'যা লোড হয়েছে তা ফিল্টার করুন…'],
  'rntf.tabs.label': ['Kind of notification', 'নোটিফিকেশনের ধরন'],
  'rntf.tabs.all': ['All', 'সব'],
  'rntf.unreadOnly': ['Unread only', 'শুধু না-পড়া'],
  'rntf.loading': ['Loading notifications…', 'নোটিফিকেশন লোড হচ্ছে…'],
  'rntf.empty.title': ['Nothing yet', 'এখনও কিছু নেই'],
  'rntf.empty.noMatch': ['Nothing matches', 'কিছু মেলেনি'],
  'rntf.empty.body': [
    'Decisions on what you have asked the client, changes to your orders, replies on your tickets and new terms all land here.',
    'ক্লায়েন্টকে আপনার করা অনুরোধের সিদ্ধান্ত, আপনার অর্ডারের পরিবর্তন, আপনার টিকিটের উত্তর এবং নতুন শর্তাবলী — সবই এখানে আসে।',
  ],
  'rntf.empty.olderNotLoaded': [
    'Nothing on this page matches. There are older notifications that have not been loaded — load them and try again.',
    'এই পাতায় কিছু মেলেনি। আরও পুরোনো নোটিফিকেশন আছে যা লোড হয়নি — সেগুলো লোড করে আবার চেষ্টা করুন।',
  ],
  'rntf.empty.nothingHere': ['Nothing here matches that.', 'এখানে কিছুই মেলেনি।'],
  'rntf.loadEarlier': ['Load earlier', 'আগেরগুলো লোড করুন'],

  'rntf.markAll.title': ['Mark everything read?', 'সবকিছু পড়া হয়েছে চিহ্নিত করবেন?'],
  'rntf.markAll.entity': [
    'Your list · {n} unread loaded',
    'আপনার তালিকা · লোড হওয়া {n}টি না-পড়া',
  ],
  'rntf.markAll.entityMore': [
    'Your list · {n} unread loaded, more further back',
    'আপনার তালিকা · লোড হওয়া {n}টি না-পড়া, আরও আগের দিকে আছে',
  ],
  'rntf.markAll.consequence': [
    'Every notification in your list is marked read, including any not loaded yet. Nothing is cleared, and you can mark one unread again.',
    'আপনার তালিকার প্রতিটি নোটিফিকেশন পড়া হয়েছে বলে চিহ্নিত হবে, যেগুলো এখনও লোড হয়নি সেগুলোসহ। কিছুই মোছা হবে না, এবং আপনি আবার না-পড়া চিহ্নিত করতে পারবেন।',
  ],
  'rntf.clearAll.title': ['Clear your whole list?', 'আপনার পুরো তালিকা মুছবেন?'],
  'rntf.clearAll.entity': ['Your list · {n} loaded', 'আপনার তালিকা · লোড হয়েছে {n}টি'],
  'rntf.clearAll.entityMore': [
    'Your list · {n} loaded, more further back',
    'আপনার তালিকা · লোড হয়েছে {n}টি, আরও আগের দিকে আছে',
  ],
  'rntf.clearAll.consequence': [
    'Every notification is hidden from your list and cannot be brought back here. The record of what was sent is kept, and anybody else sent the same messages keeps their copies.',
    'প্রতিটি নোটিফিকেশন আপনার তালিকা থেকে লুকিয়ে যাবে এবং এখান থেকে ফিরিয়ে আনা যাবে না। কী পাঠানো হয়েছিল তার রেকর্ড থেকে যায়, আর একই বার্তা যাঁদের পাঠানো হয়েছে তাঁদের কপি তাঁদের কাছেই থাকে।',
  ],
  'rntf.clearOne.title': ['Clear this from your list?', 'এটি আপনার তালিকা থেকে মুছবেন?'],
  'rntf.clearOne.consequence': [
    'It is hidden from your list and cannot be brought back here. The record of what was sent is kept.',
    'এটি আপনার তালিকা থেকে লুকিয়ে যাবে এবং এখান থেকে ফিরিয়ে আনা যাবে না। কী পাঠানো হয়েছিল তার রেকর্ড থেকে যায়।',
  ],
  'rntf.clearOne.confirm': ['Clear from my list', 'আমার তালিকা থেকে মুছুন'],

  'rntf.row.new': ['New', 'নতুন'],
  'rntf.row.openOrder': ['Open the order', 'অর্ডারটি খুলুন'],
  'rntf.row.markUnread': ['Mark unread', 'না-পড়া চিহ্নিত করুন'],
  'rntf.row.marking': ['Marking…', 'চিহ্নিত হচ্ছে…'],
  'rntf.row.unread': ['Unread', 'না-পড়া'],

  'rnts.title': ['Notification settings', 'নোটিফিকেশন সেটিংস'],
  'rnts.crumb.settings': ['Settings', 'সেটিংস'],
  'rnts.subtitle.store': [
    'Two separate choices: what reaches YOU, and what this STORE is told at all. Both only ever remove a message — neither can turn one on that the other switched off. Some messages cannot be switched off by either; they are marked.',
    'দুটি আলাদা পছন্দ: কী আপনার কাছে পৌঁছাবে, আর এই স্টোরকে আদৌ কী জানানো হবে। দুটিই শুধু বার্তা সরায় — একটি যা বন্ধ করেছে অন্যটি তা চালু করতে পারে না। কিছু বার্তা কোনোটিই বন্ধ করতে পারে না; সেগুলো চিহ্নিত করা আছে।',
  ],
  'rnts.subtitle.own': [
    'What reaches YOUR inbox and your email. Some messages cannot be switched off; they are marked.',
    'আপনার ইনবক্স ও ইমেইলে কী পৌঁছাবে। কিছু বার্তা বন্ধ করা যায় না; সেগুলো চিহ্নিত করা আছে।',
  ],
  'rnts.kpi.reaching': ['Reaching you', 'আপনার কাছে পৌঁছাচ্ছে'],
  'rnts.kpi.reachingFigure': ['{on} of {total}', '{total}টির মধ্যে {on}টি'],
  'rnts.kpi.reachingHint': ['topics you have not silenced', 'যে বিষয়গুলো আপনি নীরব করেননি'],
  'rnts.kpi.storeWide': ['Store-wide', 'পুরো স্টোর'],
  'rnts.kpi.storeWideHint': [
    'categories, set for everybody here',
    'ক্যাটাগরি, এখানকার সবার জন্য ঠিক করা',
  ],
  'rnts.kpi.always': ['Always sent', 'সবসময় পাঠানো হয়'],
  'rnts.kpi.alwaysHint': [
    'answers, money and order changes',
    'উত্তর, টাকাপয়সা ও অর্ডারের পরিবর্তন',
  ],

  'rnts.yours.title': ['What reaches you', 'আপনার কাছে কী পৌঁছায়'],
  'rnts.yours.sub': [
    'Your own choices, for your own inbox and email. Nobody else at this store sees them, and changing one here does not change what your colleagues receive.',
    'আপনার নিজের ইনবক্স ও ইমেইলের জন্য আপনার নিজের পছন্দ। এই স্টোরের আর কেউ এগুলো দেখেন না, এবং এখানে একটি বদলালে আপনার সহকর্মীরা যা পান তা বদলায় না।',
  ],
  'rnts.yours.loading': ['Loading topics…', 'বিষয় লোড হচ্ছে…'],
  'rnts.yours.count': ['{on} of {total} on', '{total}টির মধ্যে {on}টি চালু'],
  'rnts.yours.locked': ['Always sent. {reason}', 'সবসময় পাঠানো হয়। {reason}'],
  'rnts.yours.aria': ['Notify me about: {label}', 'আমাকে জানান: {label}'],

  'rnts.store.title': ['What this store is told', 'এই স্টোরকে কী জানানো হয়'],
  'rnts.store.sub.manage': [
    'Applies to EVERYBODY here, not only you — switching a category off stops it reaching your colleagues too. Changes save instantly.',
    'এখানকার সবার ক্ষেত্রে প্রযোজ্য, শুধু আপনার নয় — একটি ক্যাটাগরি বন্ধ করলে তা আপনার সহকর্মীদের কাছেও পৌঁছায় না। পরিবর্তন সঙ্গে সঙ্গে সংরক্ষিত হয়।',
  ],
  'rnts.store.sub.view': [
    'Set for the whole store. Somebody who can edit the store profile can change these.',
    'পুরো স্টোরের জন্য ঠিক করা। যিনি স্টোরের প্রোফাইল সম্পাদনা করতে পারেন তিনি এগুলো বদলাতে পারেন।',
  ],
  'rnts.store.loading': ['Loading categories…', 'ক্যাটাগরি লোড হচ্ছে…'],
  'rnts.store.lock.empty': [
    'Nothing is sent under this yet, so there is nothing to switch off.',
    'এর অধীনে এখনও কিছু পাঠানো হয় না, তাই বন্ধ করার মতো কিছু নেই।',
  ],
  'rnts.store.lock.never': [
    'Everything here is something Skydrop never silences, so there is nothing to switch off.',
    'এখানকার সবকিছুই Skydrop কখনও নীরব করে না, তাই বন্ধ করার মতো কিছু নেই।',
  ],
  'rnts.store.emailAria': ['Email the store about {title}', '{title} সম্পর্কে স্টোরকে ইমেইল করুন'],
  'rnts.store.inAppAria': ["Show {title} in the store's inboxes", 'স্টোরের ইনবক্সে {title} দেখান'],
  'rnts.store.foot': [
    'Left switch: email. Right switch: the bell. A message has to pass BOTH this and your own choice above to reach you.',
    'বাম সুইচ: ইমেইল। ডান সুইচ: বেল। আপনার কাছে পৌঁছাতে একটি বার্তাকে এটি এবং উপরে আপনার নিজের পছন্দ — দুটিই পার হতে হয়।',
  ],

  'rnts.cat.ORDER_UPDATES.title': ['Your orders and your requests', 'আপনার অর্ডার ও আপনার অনুরোধ'],
  'rnts.cat.ORDER_UPDATES.desc': [
    'Answers to what you asked the client, and changes somebody else made to one of your orders.',
    'ক্লায়েন্টকে আপনার করা অনুরোধের উত্তর, এবং আপনার কোনো অর্ডারে অন্য কারও করা পরিবর্তন।',
  ],
  'rnts.cat.MONEY.title': ['Money', 'টাকাপয়সা'],
  'rnts.cat.MONEY.desc': [
    'Credits, fee shares, what you prepaid, and decisions about your wallet.',
    'জমা, ফির অংশ, আপনার প্রিপেইড করা টাকা এবং আপনার ওয়ালেট নিয়ে সিদ্ধান্ত।',
  ],
  'rnts.cat.SUPPORT.title': ['Disputes and issues', 'বিরোধ ও সমস্যা'],
  'rnts.cat.SUPPORT.desc': [
    'Replies and outcomes on the tickets you raise with the client or with Skydrop.',
    'ক্লায়েন্ট বা Skydrop-এর কাছে আপনার তোলা টিকিটের উত্তর ও ফলাফল।',
  ],
  'rnts.cat.TERMS.title': ['The client’s terms', 'ক্লায়েন্টের শর্তাবলী'],
  'rnts.cat.TERMS.desc': [
    'A new version to accept — who pays which fee, and when each side is credited.',
    'গ্রহণ করার মতো একটি নতুন সংস্করণ — কোন ফি কে দেবে, এবং প্রতি পক্ষ কখন টাকা পায়।',
  ],
  'rnts.cat.ANNOUNCEMENTS.title': ['Announcements', 'ঘোষণা'],
  'rnts.cat.ANNOUNCEMENTS.desc': [
    'Skydrop speaking to everybody, not only to this store.',
    'Skydrop সবার সঙ্গে কথা বলছে, শুধু এই স্টোরের সঙ্গে নয়।',
  ],

  'rnts.always.title': ['Cannot be switched off', 'বন্ধ করা যায় না'],
  'rnts.always.sub': [
    'Neither by you nor store-wide. A warning you can silence is one you find out about too late.',
    'আপনিও পারেন না, পুরো স্টোরও পারে না। যে সতর্কতা নীরব করা যায়, তার খবর আপনি পান অনেক দেরিতে।',
  ],
  'rnts.always.answers.title': ['Answers to what you asked', 'আপনার করা অনুরোধের উত্তর'],
  'rnts.always.answers.body': [
    'Approved, rejected, or nobody answered in time. Your customer is waiting on that answer.',
    'অনুমোদিত, প্রত্যাখ্যাত, বা সময়মতো কেউ উত্তর দেননি। আপনার গ্রাহক সেই উত্তরের অপেক্ষায় আছেন।',
  ],
  'rnts.always.money.title': ['Anything about your money', 'আপনার টাকা নিয়ে যেকোনো কিছু'],
  'rnts.always.money.body': [
    'Credits, fee shares, what you prepaid, and a settled dispute that moves money between your wallet and the client’s.',
    'জমা, ফির অংশ, আপনার প্রিপেইড করা টাকা, এবং আপনার ও ক্লায়েন্টের ওয়ালেটের মধ্যে টাকা সরায় এমন নিষ্পত্তি হওয়া বিরোধ।',
  ],
  'rnts.always.orders.title': ['Changes to your orders', 'আপনার অর্ডারের পরিবর্তন'],
  'rnts.always.orders.body': [
    'Including a courier refusing an address change the client had already agreed to.',
    'ক্লায়েন্ট আগেই মেনে নিয়েছিলেন এমন ঠিকানা বদলে কুরিয়ারের অস্বীকৃতিসহ।',
  ],
  'rnts.always.account.title': ['Account and sign-in', 'অ্যাকাউন্ট ও সাইন ইন'],
  'rnts.always.account.body': [
    'Password resets, email verification and team invitations only ever go to your email — an in-app one is unreadable when you are locked out.',
    'পাসওয়ার্ড রিসেট, ইমেইল যাচাই এবং টিমের আমন্ত্রণ শুধু আপনার ইমেইলেই যায় — আপনি লক-আউট হলে অ্যাপের ভেতরের বার্তা পড়া যায় না।',
  ],
});
