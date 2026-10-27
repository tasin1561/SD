import { defineMessages } from '../define';

/**
 * Copy that the extraction could not lift mechanically: sentences with live
 * nodes inside them, text inside module-level tables, plural words. Each key is
 * prefixed with the screen that owns it, like every other namespace.
 */
export const extra = defineMessages({
  'ordersOrderActionsPanel.failedError': ['failed: {error}', 'ব্যর্থ: {error}'],
  'ordersOrderActionsPanel.unknown': ['unknown', 'অজানা'],
  'callCenterCustomerRiskStrip.returnRate': [
    "{pct} of this customer's parcels came back",
    'এই গ্রাহকের {pct} পার্সেল ফেরত এসেছে',
  ],
  'callCenterCustomerRiskStrip.previousOrders': [
    '{total} previous order{plural}',
    'আগের {total}টি অর্ডার{plural}',
  ],
  'callCenterCustomerRiskStrip.declinedOnACall': [
    ' · declined on a call {n}×',
    ' · কলে {n} বার প্রত্যাখ্যান',
  ],
  'delhiveryWalletImportPanel.skippedN': [', {n} skipped', ', {n}টি বাদ'],
  'warehouseRtoRtoItemRow.mismatchMissingRestock': [
    'A missing unit cannot go back on the shelf — you probably mean Write off.',
    'হারানো ইউনিট শেলফে ফেরত যেতে পারে না — সম্ভবত আপনি “অবলোপন” বোঝাতে চেয়েছেন।',
  ],
  'warehouseRtoRtoItemRow.mismatchDamagedRestock': [
    'A damaged unit put back in stock will be sold to the next customer. Is it really sellable?',
    'ক্ষতিগ্রস্ত ইউনিট স্টকে ফেরত দিলে তা পরের গ্রাহকের কাছে বিক্রি হবে। এটি কি সত্যিই বিক্রয়যোগ্য?',
  ],
  'warehouseRtoRtoItemRow.mismatchGoodHold': [
    'Keeping a good unit aside means it can never be sold. Put it back in stock instead?',
    'ভালো ইউনিট আলাদা করে রাখলে তা কখনো বিক্রি হবে না। বরং স্টকে ফেরত দেবেন?',
  ],
  'warehouseRtoRtoItemRow.mismatchMissingHold': [
    'A missing unit is not here to keep aside — you probably mean Write off.',
    'হারানো ইউনিট এখানে নেই যে আলাদা করে রাখা যাবে — সম্ভবত আপনি “অবলোপন” বোঝাতে চেয়েছেন।',
  ],
  'warehouseRtoRtoItemRow.mismatchGoodWriteOff': [
    'Writing off a good unit removes sellable stock for good. Put it back in stock instead?',
    'ভালো ইউনিট অবলোপন করলে বিক্রয়যোগ্য স্টক চিরতরে সরে যায়। বরং স্টকে ফেরত দেবেন?',
  ],
  'warehouseRtoRtoItemRow.remainingAll': [
    'All {lineQuantity} units have a decision.',
    'সব {lineQuantity}টি ইউনিটের সিদ্ধান্ত হয়েছে।',
  ],
  'warehouseRtoRtoItemRow.remainingSome': [
    '{left} of {lineQuantity} units still need a decision.',
    '{lineQuantity}টি ইউনিটের মধ্যে {left}টির এখনও সিদ্ধান্ত দরকার।',
  ],
  'warehouseRtoRtoItemRow.remainingOver': [
    '{over} more than the {lineQuantity} units on this line.',
    'এই লাইনের {lineQuantity}টি ইউনিটের চেয়ে {over}টি বেশি।',
  ],
  'warehouseRtoRtoStation.unitOne': ['{n} unit', '{n}টি ইউনিট'],
  'warehouseRtoRtoStation.unitOther': ['{n} units', '{n}টি ইউনিট'],
  'warehouseRtoRtoStation.restockOne': ['{units} goes back in stock', '{units} স্টকে ফেরত যায়'],
  'warehouseRtoRtoStation.restockOther': ['{units} go back in stock', '{units} স্টকে ফেরত যায়'],
  'warehouseRtoRtoStation.holdOne': [
    '{units} is kept aside damaged',
    '{units} ক্ষতিগ্রস্ত হিসেবে আলাদা করে রাখা হয়',
  ],
  'warehouseRtoRtoStation.holdOther': [
    '{units} are kept aside damaged',
    '{units} ক্ষতিগ্রস্ত হিসেবে আলাদা করে রাখা হয়',
  ],
  'warehouseRtoRtoStation.writeOffOne': ['{units} is written off', '{units} অবলোপন করা হয়'],
  'warehouseRtoRtoStation.writeOffOther': ['{units} are written off', '{units} অবলোপন করা হয়'],
  'warehouseRtoRtoStation.nothingReady': [
    'Nothing is ready to move — every unit is still waiting on a decision.',
    'সরানোর জন্য কিছু প্রস্তুত নয় — প্রতিটি ইউনিট এখনও সিদ্ধান্তের অপেক্ষায়।',
  ],
  'warehouseRtoRtoStation.listJoin': ['{head} and {last}', '{head} এবং {last}'],
  'warehouseRtoRtoStation.listSeparator': [', ', ', '],
  'warehouseRtoRtoStation.consequenceTail': [
    '{listed} — stock moves now and this cannot be undone.',
    '{listed} — স্টক এখনই সরে এবং এটি ফেরানো যায় না।',
  ],
});
