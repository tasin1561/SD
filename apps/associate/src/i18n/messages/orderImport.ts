import { defineMessages } from '../define';

/** Upload orders (CSV). Column names in the file and the server's per-row reasons are data and stay as sent. */
export const orderImport = defineMessages({
  'import.title': ['Upload orders', 'অর্ডার আপলোড'],
  'import.subtitle': [
    'One row is one product line — give two rows the same reference and they become one order with two items. You do not set a price in the file: each product is sold at the price your store set for you. A reference you have already used comes back as an error row; re-uploading never changes an order you have already placed.',
    'একটি সারি মানে একটি পণ্যের লাইন — দুটি সারিতে একই রেফারেন্স দিলে সেগুলো দুটি আইটেমসহ একটি অর্ডার হয়ে যায়। ফাইলে দাম দিতে হয় না: প্রতিটি পণ্য আপনার স্টোরের ঠিক করা দামে বিক্রি হয়। আগে ব্যবহার করা রেফারেন্স ত্রুটির সারি হয়ে ফিরে আসে; আবার আপলোড করলে আপনার আগে দেওয়া কোনো অর্ডার বদলায় না।',
  ],
  'import.paused.title': [
    'Your store has paused new orders from you',
    'আপনার স্টোর আপনার নতুন অর্ডার দেওয়া সাময়িকভাবে বন্ধ রেখেছে',
  ],
  'import.paused.body': [
    'An upload will be refused until it is switched back on. Everything you have already placed carries on.',
    'আবার চালু না হওয়া পর্যন্ত আপলোড প্রত্যাখ্যান করা হবে। আপনি আগে যা দিয়েছেন সব চলতে থাকবে।',
  ],
  'import.upload': ['Upload', 'আপলোড'],
  'import.downloading': ['Downloading…', 'ডাউনলোড হচ্ছে…'],
  'import.dropAria': ['Order file (Excel or CSV)', 'অর্ডারের ফাইল (Excel বা CSV)'],
  'import.dropLabel': [
    'Drop your Excel or CSV file here',
    'আপনার Excel বা CSV ফাইল এখানে ছেড়ে দিন',
  ],
  'import.choose': ['Choose file…', 'ফাইল বেছে নিন…'],
  'import.check': ['Upload and check', 'আপলোড করে যাচাই করুন'],
  'import.checking': ['Checking…', 'যাচাই হচ্ছে…'],
  'import.chooseFirst': ['Choose a file first.', 'আগে একটি ফাইল বেছে নিন।'],
  'import.uploadFailed': [
    'The upload failed ({status}). Try again.',
    'আপলোড ব্যর্থ হয়েছে ({status})। আবার চেষ্টা করুন।',
  ],
  'import.started': [
    'Import started. Rows become orders in a moment.',
    'ইমপোর্ট শুরু হয়েছে। কিছুক্ষণের মধ্যেই সারিগুলো অর্ডার হয়ে যাবে।',
  ],

  'import.rows.one': ['{n} row', '{n}টি সারি'],
  'import.rows.other': ['{n} rows', '{n}টি সারি'],
  'import.orders.one': ['{n} order', '{n}টি অর্ডার'],
  'import.orders.other': ['{n} orders', '{n}টি অর্ডার'],
  'import.preview.same': ['{file}: {rows}.', '{file}: {rows}।'],
  'import.preview.making': [
    '{file}: {rows}, making {orders}.',
    '{file}: {rows}, যা থেকে {orders} তৈরি হবে।',
  ],
  'import.problems.one': ['{n} row will not import · {list}', '{n}টি সারি ইমপোর্ট হবে না · {list}'],
  'import.problems.other': [
    '{n} rows will not import · {list}',
    '{n}টি সারি ইমপোর্ট হবে না · {list}',
  ],
  'import.problem.row': ['Row {n}: {reason}', 'সারি {n}: {reason}'],
  'import.missing': [
    'Missing columns: {columns}. Fix the file and upload it again.',
    'কলাম নেই: {columns}। ফাইলটি ঠিক করে আবার আপলোড করুন।',
  ],
  'import.tooMany': [
    'More than {limit} rows. Split the file.',
    '{limit}টির বেশি সারি। ফাইলটি ভাগ করুন।',
  ],
  'import.importN': ['Import {orders}', '{orders} ইমপোর্ট করুন'],
  'import.importing': ['Importing…', 'ইমপোর্ট হচ্ছে…'],

  'import.recent': ['Recent uploads', 'সাম্প্রতিক আপলোড'],
  'import.recentLoading': ['Loading uploads', 'আপলোড লোড হচ্ছে'],
  'import.empty.title': ['No uploads yet', 'এখনও কোনো আপলোড নেই'],
  'import.empty.body': [
    'Upload a CSV above to place many orders at once.',
    'একসঙ্গে অনেক অর্ডার দিতে উপরে একটি CSV আপলোড করুন।',
  ],
  'import.col.file': ['File', 'ফাইল'],
  'import.col.status': ['Status', 'অবস্থা'],
  'import.col.orders': ['Orders', 'অর্ডার'],
  'import.col.failed': ['Failed', 'ব্যর্থ'],
  'import.templateXlsx': ['Download Excel template', 'Excel টেমপ্লেট ডাউনলোড'],
  'import.templateCsv': ['CSV template', 'CSV টেমপ্লেট'],
  'import.errorReportXlsx': ['Errors (Excel)', 'ত্রুটি (Excel)'],
  'import.errorReport': ['Error report', 'ত্রুটির রিপোর্ট'],
  'import.pages': ['Upload pages', 'আপলোডের পাতা'],

  'import.confirm.title': ['Import these orders?', 'এই অর্ডারগুলো ইমপোর্ট করবেন?'],
  'import.confirm.consequence': [
    "Each row becomes one of your orders and goes to Skydrop's call centre to be confirmed. A row that fails lands in the error report; nothing else is changed.",
    'প্রতিটি সারি আপনার একটি অর্ডার হবে এবং নিশ্চিত করার জন্য Skydrop-এর কল সেন্টারে যাবে। যে সারি ব্যর্থ হবে তা ত্রুটির রিপোর্টে যাবে; আর কিছুই বদলাবে না।',
  ],
  'import.confirm.import': ['Import', 'ইমপোর্ট করুন'],
  'import.confirm.notYet': ['Not yet', 'এখনই নয়'],

  'import.run.label': ['Importing {file}', '{file} ইমপোর্ট হচ্ছে'],
  'import.run.finished': ['Import finished', 'ইমপোর্ট শেষ হয়েছে'],
  'import.run.stopped': ['Import stopped', 'ইমপোর্ট থেমে গেছে'],
  'import.run.detail.one': [
    '{handled} of {total} row handled',
    '{total}টি সারির মধ্যে {handled}টি সম্পন্ন',
  ],
  'import.run.detail.other': [
    '{handled} of {total} rows handled',
    '{total}টি সারির মধ্যে {handled}টি সম্পন্ন',
  ],
});
