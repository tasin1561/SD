import { defineMessages } from '../define';

/** Copy owned by the "settingsHub" feature. */
export const settingsHub = defineMessages({
  'settingsHub.thisBrowser': ['This browser', 'এই ব্রাউজার'],
  'settingsHub.howTheConsoleMoves': [
    'How the console moves in this browser — saved here only, so another device keeps its own choice.',
    'এই ব্রাউজারে কনসোল কীভাবে চলে — কেবল এখানেই সংরক্ষিত, তাই অন্য ডিভাইস নিজের পছন্দ রাখে।',
  ],
  'settingsHub.nothingToConfigure': ['Nothing to configure', 'ঠিক করার মতো কিছু নেই'],
  'settingsHub.noneOfTheseSettings': [
    'None of these settings are part of your access. An owner or admin on your team can change that.',
    'এই সেটিংসগুলোর কোনোটিই আপনার অনুমতির অংশ নয়। আপনার টিমের মালিক বা অ্যাডমিন তা বদলাতে পারেন।',
  ],
  'settingsHub.copied': ['Copied!', 'কপি হয়েছে!'],
  'settingsHub.copy': ['Copy', 'কপি'],
  'settingsHub.signInSessions': ['Sign-in & sessions', 'সাইন-ইন ও সেশন'],
  'settingsHub.whoThisBrowserIs': [
    'Who this browser is signed in as, and a way to end every session for the account at once — for a device you no longer control.',
    'এই ব্রাউজারে কে সাইন-ইন করা আছেন, এবং অ্যাকাউন্টের সব সেশন একবারে শেষ করার উপায় — যে ডিভাইস আর আপনার হাতে নেই তার জন্য।',
  ],
  'settingsHub.stores': ['Stores', 'স্টোর'],
  'settingsHub.theShopsYouSell': [
    'The shops you sell under. A store decides which brand an order belongs to — products, stock, wallet and couriers are shared across all of them.',
    'যেসব শপের অধীনে আপনি বিক্রি করেন। স্টোর ঠিক করে একটি অর্ডার কোন ব্র্যান্ডের — পণ্য, স্টক, ওয়ালেট ও কুরিয়ার সবগুলোর মধ্যে ভাগ করা।',
  ],
  'settingsHub.orderDefaults': ['Order defaults', 'অর্ডারের ডিফল্ট'],
  'settingsHub.whatANewOrder': [
    'What a new order starts with — the delivery fee you charge your customer, pre-filled into the collectable amount.',
    'নতুন অর্ডার যা নিয়ে শুরু হয় — আপনার গ্রাহকের কাছ থেকে নেওয়া ডেলিভারি ফি, যা আদায়যোগ্য টাকায় আগে থেকে ভরা থাকে।',
  ],
  'settingsHub.stockAlerts': ['Stock alerts', 'স্টক সতর্কতা'],
  'settingsHub.theQuantityAtWhich': [
    'The quantity at which we warn you a SKU is running out. A SKU with its own threshold ignores it.',
    'কোনো SKU ফুরিয়ে আসছে বলে আমরা যে পরিমাণে আপনাকে সতর্ক করি। নিজস্ব সীমা থাকা SKU এটি উপেক্ষা করে।',
  ],
  'settingsHub.walletLimitsAndSettings': ['Wallet limits and settings', 'ওয়ালেটের সীমা ও সেটিংস'],
  'settingsHub.withdrawalLimitsWhenCod': [
    'Withdrawal limits, when COD reaches you, and what is charged. Set by Skydrop and shown read-only, so a limit is never a surprise.',
    'উইথড্রের সীমা, COD কখন আপনার কাছে পৌঁছাবে এবং কী কী চার্জ হবে। Skydrop ঠিক করে এবং শুধু পড়ার জন্য দেখায়, যাতে কোনো সীমা আপনার কাছে অপ্রত্যাশিত না হয়।',
  ],
  'settingsHub.outboundWebhooks': ['Outbound webhooks', 'আউটবাউন্ড ওয়েবহুক'],
  'settingsHub.configureHttpsEndpointsTo': [
    'Configure HTTPS endpoints to receive event POSTs from Skydrop. Each gets a unique HMAC secret.',
    'Skydrop থেকে ইভেন্ট POST পেতে HTTPS এন্ডপয়েন্ট ঠিক করুন। প্রতিটির একটি আলাদা HMAC সিক্রেট থাকে।',
  ],
  'settingsHub.notificationSettings': ['Notification settings', 'বিজ্ঞপ্তির সেটিংস'],
  'settingsHub.whatReachesYourInbox': [
    'What reaches YOUR inbox, topic by topic — and, if it is yours to set, what this COMPANY is emailed about.',
    'বিষয় ধরে ধরে কী আপনার ইনবক্সে পৌঁছাবে — এবং এটি আপনার ঠিক করার হলে, এই কোম্পানিকে কী নিয়ে ইমেইল করা হবে।',
  ],
  'settingsHub.apiKeys': ['API keys', 'API কী'],
  'settingsHub.programmaticAccessToThe': [
    'Programmatic access to the Skydrop API. Create, label, and revoke keys.',
    'Skydrop API-তে প্রোগ্রাম থেকে প্রবেশাধিকার। কী তৈরি করুন, লেবেল দিন এবং বাতিল করুন।',
  ],
  'settingsHub.clientConsole': ['Client console', 'ক্লায়েন্ট কনসোল'],
  'settingsHub.account': ['Account', 'অ্যাকাউন্ট'],
  'settingsHub.settings': ['Settings', 'সেটিংস'],
  'settingsHub.signInAndSessions': [
    'Sign-in and sessions, order and stock defaults, wallet limits, webhooks, notifications, API keys.',
    'সাইন-ইন ও সেশন, অর্ডার ও স্টকের ডিফল্ট, ওয়ালেটের সীমা, ওয়েবহুক, বিজ্ঞপ্তি, API কী।',
  ],
  'settingsHub.orderAndStockDefaults': ['Order and stock defaults', 'অর্ডার ও স্টকের ডিফল্ট'],
  'settingsHub.money': ['Money', 'টাকা'],
  'settingsHub.notifications': ['Notifications', 'বিজ্ঞপ্তি'],
  'settingsHub.integrations': ['Integrations', 'ইন্টিগ্রেশন'],
  'settingsHub.areaOpenOne': ['{count} area open to you', 'আপনার জন্য {count}টি অংশ খোলা'],
  'settingsHub.areaOpenMany': ['{count} areas open to you', 'আপনার জন্য {count}টি অংশ খোলা'],
});
