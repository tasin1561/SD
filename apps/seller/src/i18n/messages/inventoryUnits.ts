import { defineMessages } from '../define';

/** Copy owned by the "inventoryUnits" feature. */
export const inventoryUnits = defineMessages({
  'inventoryUnits.inventory': ['Inventory', 'ইনভেন্টরি'],
  'inventoryUnits.clientConsole': ['Client console', 'ক্লায়েন্ট কনসোল'],
  'inventoryUnits.stock': ['Stock', 'স্টক'],
  'inventoryUnits.unitDiscrepancies': ['Unit discrepancies', 'ইউনিটের অমিল'],
  'inventoryUnits.forSkusTrackedPer': [
    'For SKUs tracked per unit by serial. Where a scan is missing, a parcel is unaccounted for, or the serials disagree with the stock count.',
    'যেসব SKU সিরিয়াল ধরে প্রতি ইউনিটে ট্র্যাক করা হয় সেগুলোর জন্য। যেখানে কোনো স্ক্যান বাদ পড়েছে, কোনো পার্সেলের হিসাব মিলছে না, বা সিরিয়াল স্টক গণনার সাথে মিলছে না।',
  ],
  'inventoryUnits.everythingReconciles': ['Everything reconciles', 'সব মিলে গেছে'],
  'inventoryUnits.toLookAt': ['{totalIssues} to look at', 'দেখার আছে {totalIssues}টি'],
  'inventoryUnits.strictMode': ['Strict mode', 'কঠোর মোড'],
  'inventoryUnits.aSkuOnStrict': [
    'A SKU on strict mode carries a serial on every physical unit, and the warehouse scans it at receiving, pick and pack. Only those SKUs appear on this page. We set it, not you.',
    'কঠোর মোডের SKU-র প্রতিটি ভৌত ইউনিটে একটি সিরিয়াল থাকে, আর ওয়্যারহাউস গ্রহণ, পিক ও প্যাকের সময় তা স্ক্যান করে। শুধু সেই SKU-গুলোই এই পেজে আসে। এটি আমরা ঠিক করি, আপনি নন।',
  ],
  'inventoryUnits.strictModeSkusOnly': ['Strict-mode SKUs only', 'শুধু কঠোর মোডের SKU'],
  'inventoryUnits.read': ['Read {generatedAt}', 'পড়া হয়েছে {generatedAt}'],
  'inventoryUnits.couldNotLoadThe': ['Could not load the report.', 'রিপোর্ট লোড করা যায়নি।'],
  'inventoryUnits.needsAttention': ['Needs attention', 'মনোযোগ দরকার'],
  'inventoryUnits.everythingReconciles2': ['Everything reconciles.', 'সব মিলে গেছে।'],
  'inventoryUnits.stuckMidLifecycle': ['Stuck mid-lifecycle', 'জীবনচক্রের মাঝপথে আটকে'],
  'inventoryUnits.unresolvedDispatches': ['Unresolved dispatches', 'অমীমাংসিত ডিসপ্যাচ'],
  'inventoryUnits.countMismatches': ['Count mismatches', 'গণনার অমিল'],
  'inventoryUnits.pickedOrPackedFor': [
    'Picked or packed for over {stuckSlaHours}h.',
    '{stuckSlaHours} ঘণ্টার বেশি সময় ধরে পিক বা প্যাক করা।',
  ],
  'inventoryUnits.outForOverDays': [
    'Out for over {dispatchedUnresolvedDays} days, never delivered or returned.',
    '{dispatchedUnresolvedDays} দিনের বেশি বাইরে, ডেলিভারি বা ফেরত কোনোটিই হয়নি।',
  ],
  'inventoryUnits.serialsDisagreeWithThe': [
    'Serials disagree with the stock figure.',
    'সিরিয়াল স্টকের অঙ্কের সাথে মিলছে না।',
  ],
  'inventoryUnits.usuallyASkippedScan': [
    'Usually a skipped scan on the floor rather than a lost item.',
    'সাধারণত কোনো জিনিস হারানো নয়, ফ্লোরে একটি স্ক্যান বাদ পড়া।',
  ],
  'inventoryUnits.nothingStuck': ['Nothing stuck', 'কিছুই আটকে নেই'],
  'inventoryUnits.eachOfTheseIs': [
    'Each of these is a parcel to chase with the courier.',
    'এগুলোর প্রতিটি একটি পার্সেল, যা কুরিয়ারের সাথে অনুসরণ করতে হবে।',
  ],
  'inventoryUnits.nothingUnaccountedFor': ['Nothing unaccounted for', 'হিসাবের বাইরে কিছু নেই'],
  'inventoryUnits.reportedNeverAutoCorrected': [
    'Reported, never auto-corrected — that would erase the evidence.',
    'রিপোর্ট করা হয়, কখনো স্বয়ংক্রিয়ভাবে ঠিক করা হয় না — তাতে প্রমাণ মুছে যেত।',
  ],
  'inventoryUnits.serialsAndStockAgree': ['Serials and stock agree', 'সিরিয়াল ও স্টক মিলেছে'],
  'inventoryUnits.forEveryStrictMode': [
    'For every strict-mode SKU, the number of in-stock serials matches the recorded quantity on hand.',
    'প্রতিটি কঠোর মোডের SKU-র জন্য, স্টকে থাকা সিরিয়ালের সংখ্যা নথিভুক্ত হাতে থাকা পরিমাণের সাথে মেলে।',
  ],
  'inventoryUnits.sku': ['SKU', 'SKU'],
  'inventoryUnits.warehouse': ['Warehouse', 'ওয়্যারহাউস'],
  'inventoryUnits.serialsInStock': ['Serials in stock', 'স্টকে থাকা সিরিয়াল'],
  'inventoryUnits.recordedOnHand': ['Recorded on hand', 'নথিভুক্ত হাতে থাকা'],
  'inventoryUnits.difference': ['Difference', 'পার্থক্য'],
  'inventoryUnits.retiredUnits': ['Retired units', 'বাতিল ইউনিট'],
  'inventoryUnits.keptVisibleSoA': [
    'Kept visible so a loss stays countable rather than just disappearing.',
    'দৃশ্যমান রাখা হয় যাতে ক্ষতি শুধু উধাও না হয়ে গণনাযোগ্য থাকে।',
  ],
  'inventoryUnits.noUnitsWrittenOff': [
    'No units written off or lost',
    'কোনো ইউনিট বাতিল বা হারানো হিসেবে লেখা হয়নি',
  ],
  'inventoryUnits.serial': ['Serial', 'সিরিয়াল'],
  'inventoryUnits.status': ['Status', 'স্ট্যাটাস'],
  'inventoryUnits.timeInStatus': ['Time in status', 'এই অবস্থায় সময়'],
  'inventoryUnits.lastScan': ['Last scan', 'সর্বশেষ স্ক্যান'],
  'inventoryUnits.neverScanned': ['Never scanned', 'কখনো স্ক্যান হয়নি'],
  'inventoryUnits.traceASerial': ['Trace a serial', 'একটি সিরিয়াল ট্রেস করুন'],
  'inventoryUnits.theNumberPrintedOn': [
    'The number printed on a single unit. Its whole history, in the order it happened.',
    'একটি ইউনিটে ছাপা নম্বর। এর সম্পূর্ণ ইতিহাস, ঘটার ক্রমে।',
  ],
  'inventoryUnits.scanOrType': ['Scan or type', 'স্ক্যান করুন বা টাইপ করুন'],
  'inventoryUnits.trace': ['Trace', 'ট্রেস'],
  'inventoryUnits.tracing': ['Tracing…', 'ট্রেস হচ্ছে…'],
  'inventoryUnits.noUnitOfYours': [
    'No unit of yours carries that serial. Either the number belongs to something we never received, or this SKU is not tracked per unit.',
    'আপনার কোনো ইউনিটে এই সিরিয়াল নেই। হয় নম্বরটি এমন কিছুর যা আমরা কখনো গ্রহণ করিনি, নয়তো এই SKU প্রতি ইউনিটে ট্র্যাক করা হয় না।',
  ],
  'inventoryUnits.historyOf': ['History of {serialBarcode}', '{serialBarcode}-এর ইতিহাস'],
  'inventoryUnits.when': ['When', 'কখন'],
  'inventoryUnits.moved': ['Moved', 'সরেছে'],
  'inventoryUnits.step': ['Step', 'ধাপ'],
  'inventoryUnits.note': ['Note', 'নোট'],
  'inventoryUnits.skus': ['SKUs', 'SKU'],
  'inventoryUnits.everySerializedUnitThat': [
    'Every serialized unit that started a pick has been scanned through to the next stage.',
    'পিক শুরু হওয়া প্রতিটি সিরিয়ালযুক্ত ইউনিট পরের ধাপ পর্যন্ত স্ক্যান করা হয়েছে।',
  ],
  'inventoryUnits.everyDispatchedUnitHas': [
    'Every dispatched unit has either been delivered or come back.',
    'ডিসপ্যাচ করা প্রতিটি ইউনিট হয় ডেলিভারি হয়েছে নয়তো ফিরে এসেছে।',
  ],
  'inventoryUnits.nothingHasBeenRetired': [
    'Nothing has been retired from the serial ledger.',
    'সিরিয়াল লেজার থেকে কিছু বাতিল করা হয়নি।',
  ],
});
