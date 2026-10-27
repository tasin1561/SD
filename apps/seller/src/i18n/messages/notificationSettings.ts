import { defineMessages } from '../define';

/** Copy owned by the "notificationSettings" feature. */
export const notificationSettings = defineMessages({
  'notificationSettings.clientConsole': ['Client console', 'ক্লায়েন্ট কনসোল'],
  'notificationSettings.notifications': ['Notifications', 'বিজ্ঞপ্তি'],
  'notificationSettings.settings': ['Settings', 'সেটিংস'],
  'notificationSettings.notificationSettings': ['Notification settings', 'বিজ্ঞপ্তির সেটিংস'],
  'notificationSettings.twoSeparateChoicesWhat': [
    'Two separate choices: what reaches YOU, and what this COMPANY is emailed about. Both only ever remove a message — neither can turn one on that the other switched off. Messages about your account and credentials are in neither list: they always go to your email and cannot be silenced.',
    'দুটি আলাদা পছন্দ: কী আপনার কাছে পৌঁছাবে, আর এই কোম্পানিকে কী নিয়ে ইমেইল করা হবে। দুটোই কেবল বার্তা বাদ দিতে পারে — একটি বন্ধ করলে অন্যটি তা চালু করতে পারে না। আপনার অ্যাকাউন্ট ও পরিচয়-তথ্য সংক্রান্ত বার্তা কোনো তালিকাতেই নেই: সেগুলো সবসময় আপনার ইমেইলে যায় এবং বন্ধ করা যায় না।',
  ],
  'notificationSettings.whatReachesYourInbox': [
    'What reaches YOUR inbox. Messages about your account and credentials are not listed — they only ever go to your email, and cannot be silenced.',
    'কী আপনার ইনবক্সে পৌঁছাবে। অ্যাকাউন্ট ও পরিচয়-তথ্য সংক্রান্ত বার্তা এখানে তালিকাভুক্ত নয় — সেগুলো শুধু আপনার ইমেইলে যায় এবং বন্ধ করা যায় না।',
  ],
  'notificationSettings.yours': ['Yours', 'আপনার'],
  'notificationSettings.theCompanyS': ["The company's", 'কোম্পানির'],
  'notificationSettings.yourAlerts': ['Your alerts', 'আপনার সতর্কতা'],
  'notificationSettings.topicsReachingYourInbox': [
    'Topics reaching your inbox.',
    'যেসব বিষয় আপনার ইনবক্সে আসে।',
  ],
  'notificationSettings.companyCategories': ['Company categories', 'কোম্পানির বিভাগ'],
  'notificationSettings.emailInAppSet': [
    'Email + in-app, set for everyone here.',
    'ইমেইল + অ্যাপের ভেতরে, এখানকার সবার জন্য ঠিক করা।',
  ],
  'notificationSettings.quietHours': ['Quiet hours', 'নীরব সময়'],
  'notificationSettings.neverSilenced': ['Never silenced', 'কখনো নীরব করা যায় না'],
  'notificationSettings.accountSecurity': ['Account & security', 'অ্যাকাউন্ট ও নিরাপত্তা'],
  'notificationSettings.signInPasswordInvites': [
    'Sign-in, password, invites.',
    'সাইন-ইন, পাসওয়ার্ড, আমন্ত্রণ।',
  ],
  'notificationSettings.whatReachesYou': ['What reaches you', 'আপনার কাছে কী পৌঁছায়'],
  'notificationSettings.yourOwnChoicesFor': [
    'Your own choices, for your own inbox.',
    'আপনার নিজের ইনবক্সের জন্য আপনার নিজের পছন্দ।',
  ],
  'notificationSettings.nobodyElseAtThis': [
    'Nobody else at this company sees them, and changing one here does not change what anybody else receives.',
    'এই কোম্পানির আর কেউ এগুলো দেখেন না, আর এখানে একটি বদলালে অন্য কেউ যা পান তা বদলায় না।',
  ],
  'notificationSettings.loadingTopics': ['Loading topics…', 'বিষয় লোড হচ্ছে…'],
  'notificationSettings.notifyMeAbout': ['Notify me about: {label}', 'আমাকে জানান: {label}'],
  'notificationSettings.theCompanySEmail': ["The company's email", 'কোম্পানির ইমেইল'],
  'notificationSettings.whatThisCompanyIs': [
    'What this company is emailed about — applies to everyone here, not only you.',
    'এই কোম্পানিকে কী নিয়ে ইমেইল করা হয় — শুধু আপনার নয়, এখানকার সবার জন্য প্রযোজ্য।',
  ],
  'notificationSettings.loadingPreferences': ['Loading preferences…', 'পছন্দ লোড হচ্ছে…'],
  'notificationSettings.failed': ['Failed.', 'ব্যর্থ হয়েছে।'],
  'notificationSettings.noPreferencesYet': ['No preferences yet.', 'এখনো কোনো পছন্দ নেই।'],
  'notificationSettings.switchingACategoryOff': [
    'Switching a category off stops that email reaching your colleagues too. Changes save instantly.',
    'কোনো বিভাগ বন্ধ করলে সেই ইমেইল আপনার সহকর্মীদের কাছেও পৌঁছানো বন্ধ হয়। পরিবর্তন সঙ্গে সঙ্গে সংরক্ষণ হয়।',
  ],
  'notificationSettings.theCompanySEmail2': [
    "The company's email, by category",
    'বিভাগ অনুযায়ী কোম্পানির ইমেইল',
  ],
  'notificationSettings.category': ['Category', 'বিভাগ'],
  'notificationSettings.email': ['Email', 'ইমেইল'],
  'notificationSettings.inApp': ['In-app', 'অ্যাপের ভেতরে'],
  'notificationSettings.whatThatMeans': ['What that means', 'এর মানে কী'],
  'notificationSettings.quietHoursHoldThe': [
    'Quiet hours hold the EMAIL only, in the company timezone. An email that arrives inside the window waits until it ends rather than being dropped — and an inbox line is never held, because nothing pings and the row itself is the delivery.',
    'নীরব সময় কেবল ইমেইল আটকে রাখে, কোম্পানির টাইমজোন অনুযায়ী। এই সময়ের মধ্যে আসা ইমেইল বাদ না গিয়ে সময় শেষ না হওয়া পর্যন্ত অপেক্ষা করে — আর ইনবক্সের লাইন কখনো আটকানো হয় না, কারণ কিছুই বেজে ওঠে না এবং সারিটিই পৌঁছে দেওয়া।',
  ],
  'notificationSettings.updateFailed': ['Update failed', 'হালনাগাদ ব্যর্থ হয়েছে'],
  'notificationSettings.email2': ['Email {title}', 'ইমেইল {title}'],
  'notificationSettings.inApp2': ['In-app {title}', 'অ্যাপের ভেতরে {title}'],
  'notificationSettings.quietHoursStartFor': [
    'Quiet hours start for {title}',
    '{title}-এর নীরব সময় শুরু',
  ],
  'notificationSettings.quietHoursEndFor': [
    'Quiet hours end for {title}',
    '{title}-এর নীরব সময় শেষ',
  ],
  'notificationSettings.noEmailAtAll': ['No email at all', 'কোনো ইমেইল নয়'],
  'notificationSettings.heldTill': ['Held till {quietHoursEnd}', '{quietHoursEnd} পর্যন্ত আটকানো'],
  'notificationSettings.sentStraightAway': ['Sent straight away', 'সঙ্গে সঙ্গে পাঠানো হয়'],
  'notificationSettings.accountAndSignIn': ['Account and sign-in', 'অ্যাকাউন্ট ও সাইন-ইন'],
  'notificationSettings.bankAndPayoutChanges': [
    'Bank and payout changes',
    'ব্যাংক ও পেআউটের পরিবর্তন',
  ],
  'notificationSettings.cannotBeSwitchedOff': ['Cannot be switched off', 'বন্ধ করা যায় না'],
  'notificationSettings.theseGoToYour': [
    'These go to your email whatever is set above. A warning you can silence is one you find out about too late.',
    'উপরে যা-ই ঠিক করা থাকুক, এগুলো আপনার ইমেইলে যাবেই। যে সতর্কতা নীরব করা যায়, তা জানতে অনেক দেরি হয়ে যায়।',
  ],
  'notificationSettings.nothingSetYet': ['nothing set yet', 'এখনো কিছু ঠিক করা নেই'],
  'notificationSettings.notSet': ['Not set', 'ঠিক করা নেই'],
  'notificationSettings.emailIsSentAs': [
    'email is sent as it happens',
    'ইমেইল ঘটনার সাথে সাথে পাঠানো হয়',
  ],
  'notificationSettings.varies': ['Varies', 'ভিন্ন ভিন্ন'],
  'notificationSettings.categoriesDifferentWindows': [
    '{withWindow} categories, different windows',
    '{withWindow}টি বিভাগ, আলাদা আলাদা সময়',
  ],
  'notificationSettings.onEveryCategory': ['on every category', 'প্রতিটি বিভাগে'],
  'notificationSettings.yourTimezone': ['Your timezone', 'আপনার টাইমজোন'],
  'notificationSettings.quietHoursAreRead': [
    'Quiet hours are read in this zone, from the company profile — never a stored offset, which drifts an hour twice a year.',
    'নীরব সময় এই জোনে পড়া হয়, কোম্পানির প্রোফাইল থেকে — কখনো সংরক্ষিত অফসেট নয়, যা বছরে দুইবার এক ঘণ্টা সরে যায়।',
  ],
  'notificationSettings.outsideQuietHoursEmail': [
    'Outside quiet hours — email is going out now',
    'নীরব সময়ের বাইরে — ইমেইল এখনই যাচ্ছে',
  ],
  'notificationSettings.insideQuietHoursEmail': [
    'Inside quiet hours — email is waiting until {end}',
    'নীরব সময়ের ভেতরে — ইমেইল {end} পর্যন্ত অপেক্ষা করছে',
  ],
  'notificationSettings.orderUpdates': ['Order updates', 'অর্ডার আপডেট'],
  'notificationSettings.orderUpdatesDesc': [
    'New orders, confirmations, cancellations, rejections.',
    'নতুন অর্ডার, নিশ্চিতকরণ, বাতিল, প্রত্যাখ্যান।',
  ],
  'notificationSettings.shipmentUpdates': ['Shipment updates', 'শিপমেন্ট আপডেট'],
  'notificationSettings.shipmentUpdatesDesc': [
    'Dispatch, in-transit, delivery, NDR, RTO.',
    'ডিসপ্যাচ, পথে থাকা, ডেলিভারি, NDR, RTO।',
  ],
  'notificationSettings.stockAlerts': ['Stock alerts', 'স্টক সতর্কতা'],
  'notificationSettings.stockAlertsDesc': [
    'Low-stock thresholds + receiving completed.',
    'স্টক কমের সীমা + গ্রহণ সম্পন্ন।',
  ],
  'notificationSettings.callCentreOutcomes': ['Call centre outcomes', 'কল সেন্টারের ফলাফল'],
  'notificationSettings.callCentreOutcomesDesc': [
    'NDR cap reached, customer declined, etc.',
    'NDR সীমা পূর্ণ, গ্রাহক প্রত্যাখ্যান করেছেন ইত্যাদি।',
  ],
  'notificationSettings.billing': ['Billing', 'বিলিং'],
  'notificationSettings.billingDesc': [
    'Remittance summaries + invoices.',
    'রেমিট্যান্সের সারসংক্ষেপ + ইনভয়েস।',
  ],
  'notificationSettings.systemAnnouncements': ['System announcements', 'সিস্টেম ঘোষণা'],
  'notificationSettings.systemAnnouncementsDesc': [
    'Maintenance windows, policy updates.',
    'রক্ষণাবেক্ষণের সময়, নীতি হালনাগাদ।',
  ],
  'notificationSettings.marketing': ['Marketing', 'মার্কেটিং'],
  'notificationSettings.marketingDesc': [
    'Skydrop product updates + tips.',
    'Skydrop-এর পণ্য হালনাগাদ + টিপস।',
  ],
  'notificationSettings.accountAlwaysDesc': [
    'Password resets, email verification, team invitations, new-device warnings.',
    'পাসওয়ার্ড রিসেট, ইমেইল যাচাই, টিমের আমন্ত্রণ, নতুন ডিভাইসের সতর্কতা।',
  ],
  'notificationSettings.bankAlwaysDesc': [
    'A change to the account we pay you into is always confirmed by email.',
    'আমরা যে অ্যাকাউন্টে আপনাকে টাকা পাঠাই তা বদলালে সবসময় ইমেইলে নিশ্চিত করা হয়।',
  ],
  'notificationSettings.alwaysOn': ['Always on.', 'সবসময় চালু।'],
});
