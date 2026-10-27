import { defineMessages } from '../define';

/** Copy owned by the "settingsStock" feature. */
export const settingsStock = defineMessages({
  'settingsStock.defaultThresholdClearedSkus': [
    'Default threshold cleared — SKUs without their own will not alert.',
    'ডিফল্ট সীমা মুছে ফেলা হয়েছে — নিজস্ব সীমা নেই এমন SKU সতর্ক করবে না।',
  ],
  'settingsStock.defaultLowStockThreshold': [
    'Default low-stock threshold saved.',
    'ডিফল্ট স্টক-কম সীমা সংরক্ষিত হয়েছে।',
  ],
  'settingsStock.lowStockAlerts': ['Low-stock alerts', 'স্টক-কম সতর্কতা'],
  'settingsStock.offNothingAlertsBy': [
    'Off — nothing alerts by default',
    'বন্ধ — ডিফল্টভাবে কিছুই সতর্ক করে না',
  ],
  'settingsStock.warningBelowUnits': [
    'Warning below {defaultLowStockThreshold} units',
    '{defaultLowStockThreshold}টি ইউনিটের নিচে গেলে সতর্কতা',
  ],
  'settingsStock.couldNotLoadYour': [
    'Could not load your alert settings.',
    'আপনার সতর্কতার সেটিংস লোড করা যায়নি।',
  ],
  'settingsStock.defaultThreshold': ['Default threshold', 'ডিফল্ট সীমা'],
  'settingsStock.emptyNoSkuAlerts': [
    'Empty — no SKU alerts unless it carries its own threshold.',
    'ফাঁকা — নিজস্ব সীমা না থাকলে কোনো SKU সতর্ক করবে না।',
  ],
  'settingsStock.unitsWholeNumber0': [
    'Units. Whole number, 0–{maxThreshold}.',
    'ইউনিট। পূর্ণ সংখ্যা, 0–{maxThreshold}।',
  ],
  'settingsStock.off': ['Off', 'বন্ধ'],
  'settingsStock.save': ['Save', 'সংরক্ষণ'],
  'settingsStock.saving': ['Saving…', 'সংরক্ষণ হচ্ছে…'],
  'settingsStock.saved': ['Saved', 'সংরক্ষিত'],
  'settingsStock.cancel': ['Cancel', 'বাতিল'],
  'settingsStock.aSkuWithIts': [
    'A SKU with its own threshold ignores this one — set that on the variant page. Leaving this empty turns alerts off for everything else; zero still alerts, but only once the SKU is completely out.',
    'নিজস্ব সীমা থাকা SKU এটি উপেক্ষা করে — সেটি ভ্যারিয়েন্টের পেজে ঠিক করুন। এটি ফাঁকা রাখলে বাকি সবকিছুর জন্য সতর্কতা বন্ধ হয়; শূন্য দিলে এখনো সতর্ক করে, তবে SKU সম্পূর্ণ ফুরিয়ে গেলে তবেই।',
  ],
  'settingsStock.clientConsole': ['Client console', 'ক্লায়েন্ট কনসোল'],
  'settingsStock.account': ['Account', 'অ্যাকাউন্ট'],
  'settingsStock.settings': ['Settings', 'সেটিংস'],
  'settingsStock.stockAlerts': ['Stock alerts', 'স্টক সতর্কতা'],
  'settingsStock.whenWeWarnYou': [
    'When we warn you that a SKU is running out. A SKU with its own threshold ignores this one.',
    'কখন আমরা আপনাকে সতর্ক করব যে কোনো SKU ফুরিয়ে আসছে। নিজস্ব সীমা থাকা SKU এটি উপেক্ষা করে।',
  ],
  'settingsStock.enterAWholeNumber': [
    'Enter a whole number between 0 and {maxThreshold}, or leave empty to turn alerts off.',
    '0 থেকে {maxThreshold}-এর মধ্যে একটি পূর্ণ সংখ্যা লিখুন, অথবা সতর্কতা বন্ধ করতে ফাঁকা রাখুন।',
  ],
  'settingsStock.notSaved': ['Not saved', 'সংরক্ষণ হয়নি'],
});
