import { defineMessages } from '../define';

/** Which template columns are required and which are optional (bulk upload pages). Column headers are data and stay as the file prints them. */
export const csvColumns = defineMessages({
  'csvcols.title': ['Which columns do I need?', 'কোন কোন কলাম লাগবে?'],
  'csvcols.everyRow': ['Needed on every row', 'প্রতিটি সারিতে লাগবে'],
  'csvcols.everyRowHint': [
    'Fill these in on every single row of the file.',
    'ফাইলের প্রতিটি সারিতে এগুলো পূরণ করুন।',
  ],
  'csvcols.oncePerOrder': ['Needed once per order', 'প্রতি অর্ডারে একবার লাগবে'],
  'csvcols.oncePerOrderHint': [
    'For an order with several rows, fill these on its first row. The following rows of the same order may leave them blank.',
    'একাধিক সারির অর্ডারে এগুলো প্রথম সারিতে পূরণ করুন। একই অর্ডারের পরের সারিগুলোতে ফাঁকা রাখা যাবে।',
  ],
  'csvcols.optional': ['Optional', 'ঐচ্ছিক'],
  'csvcols.optionalHint': [
    'You can leave these out, or leave them blank.',
    'এগুলো বাদ দিতে পারেন, অথবা ফাঁকা রাখতে পারেন।',
  ],
  'csvcols.uat': ['(enabled in settings)', '(সেটিংসে চালু)'],
  'csvcols.landmarkNote': [
    'The landmark, e.g. "Near City Hospital". The courier address is line 1 + line 2, so this is required even though Delhivery’s own template leaves it blank — a blank here fails the row.',
    'ল্যান্ডমার্ক, যেমন "Near City Hospital"। কুরিয়ারের ঠিকানা হলো লাইন ১ + লাইন ২, তাই এটি আবশ্যক — Delhivery-র নিজের টেমপ্লেটে এটি ফাঁকা থাকলেও। এখানে ফাঁকা থাকলে সারিটি ব্যর্থ হবে।',
  ],
});
