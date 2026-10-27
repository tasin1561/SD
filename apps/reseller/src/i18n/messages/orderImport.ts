import { defineMessages } from '../define';

/** Upload orders by CSV (`/orders/import`). Column names and file names are data and stay as they are. */
export const orderImport = defineMessages({
  'ordimp.back': ['Orders', 'অর্ডার'],
  'ordimp.title': ['Upload orders', 'অর্ডার আপলোড করুন'],
  'ordimp.subtitle': [
    'One row is one product line — give two rows the same reference and they become one order with two items. Retail Price is what you sell the product for; leave it blank and we use your client’s suggested price. A reference you have already used comes back as an error row — re-uploading never changes an order you have already placed.',
    'একটি সারি মানে একটি পণ্যের লাইন — দুটি সারিকে একই রেফারেন্স দিলে সেগুলো দুটি আইটেমসহ একটি অর্ডার হয়ে যায়। Retail Price হলো যে দামে আপনি পণ্যটি বিক্রি করেন; ফাঁকা রাখলে আমরা আপনার ক্লায়েন্টের প্রস্তাবিত দাম ব্যবহার করি। আগে ব্যবহার করা রেফারেন্স এররের সারি হয়ে ফিরে আসে — আবার আপলোড করলেও আগে দেওয়া কোনো অর্ডার বদলায় না।',
  ],
  'ordimp.upload': ['Upload', 'আপলোড'],
  'ordimp.downloading': ['Downloading…', 'ডাউনলোড হচ্ছে…'],
  'ordimp.chooseFirst': ['Choose a file first.', 'আগে একটি ফাইল বেছে নিন।'],
  'ordimp.uploadFailed': [
    'The upload failed ({status}). Try again.',
    'আপলোড ব্যর্থ হয়েছে ({status})। আবার চেষ্টা করুন।',
  ],
  'ordimp.toast.started': [
    'Import started. Rows become orders in a moment.',
    'ইম্পোর্ট শুরু হয়েছে। কিছুক্ষণের মধ্যেই সারিগুলো অর্ডার হয়ে যাবে।',
  ],
  'ordimp.zone.aria': ['Order file (Excel or CSV)', 'অর্ডারের ফাইল (Excel বা CSV)'],
  'ordimp.zone.label': [
    'Drop your Excel or CSV file here',
    'আপনার Excel বা CSV ফাইল এখানে ছেড়ে দিন',
  ],
  'ordimp.zone.button': ['Choose file…', 'ফাইল বেছে নিন…'],
  'ordimp.check': ['Upload and check', 'আপলোড করে যাচাই করুন'],
  'ordimp.checking': ['Checking…', 'যাচাই হচ্ছে…'],
  'ordimp.rows.one': ['{n} row', '{n}টি সারি'],
  'ordimp.rows.other': ['{n} rows', '{n}টি সারি'],
  'ordimp.making.one': [', making {n} order', ', তা থেকে {n}টি অর্ডার হবে'],
  'ordimp.making.other': [', making {n} orders', ', তা থেকে {n}টি অর্ডার হবে'],
  'ordimp.preview': ['{file}: {rows}{making}.', '{file}: {rows}{making}।'],
  'ordimp.problems': ['{rows} will not import · {list}', '{rows} ইম্পোর্ট হবে না · {list}'],
  'ordimp.problemRow': ['Row {n}: {reason}', 'সারি {n}: {reason}'],
  'ordimp.missing': [
    'Missing columns: {columns}. Fix the file and upload it again.',
    'কলাম নেই: {columns}। ফাইলটি ঠিক করে আবার আপলোড করুন।',
  ],
  'ordimp.tooMany': ['More than {n} rows. Split the file.', '{n}টির বেশি সারি। ফাইলটি ভাগ করুন।'],
  'ordimp.import': ['Import {n} orders', '{n}টি অর্ডার ইম্পোর্ট করুন'],
  'ordimp.importing': ['Importing…', 'ইম্পোর্ট হচ্ছে…'],

  'ordimp.recent': ['Recent uploads', 'সাম্প্রতিক আপলোড'],
  'ordimp.loading': ['Loading uploads', 'আপলোড লোড হচ্ছে'],
  'ordimp.empty.title': ['No uploads yet', 'এখনও কোনো আপলোড নেই'],
  'ordimp.empty.body': [
    'Upload a CSV above to place many orders at once.',
    'একসঙ্গে অনেক অর্ডার দিতে উপরে একটি CSV আপলোড করুন।',
  ],
  'ordimp.col.file': ['File', 'ফাইল'],
  'ordimp.col.status': ['Status', 'অবস্থা'],
  'ordimp.col.orders': ['Orders', 'অর্ডার'],
  'ordimp.col.failed': ['Failed', 'ব্যর্থ'],
  'ordimp.templateXlsx': ['Download Excel template', 'Excel টেমপ্লেট ডাউনলোড'],
  'ordimp.templateCsv': ['CSV template', 'CSV টেমপ্লেট'],
  'ordimp.errorReportXlsx': ['Errors (Excel)', 'ত্রুটি (Excel)'],
  'ordimp.errorReport': ['Error report', 'এরর রিপোর্ট'],
  'ordimp.pages': ['Upload pages', 'আপলোডের পাতা'],

  'ordimp.confirm.title': ['Import these orders?', 'এই অর্ডারগুলো ইম্পোর্ট করবেন?'],
  'ordimp.confirm.orders.one': ['{n} order', '{n}টি অর্ডার'],
  'ordimp.confirm.orders.other': ['{n} orders', '{n}টি অর্ডার'],
  'ordimp.confirm.consequence': [
    'Each row becomes one of your orders and goes to Skydrop’s call centre to be confirmed. A row that fails lands in the error report; nothing else is changed.',
    'প্রতিটি সারি আপনার একটি করে অর্ডার হবে এবং নিশ্চিত করার জন্য Skydrop-এর কল সেন্টারে যাবে। যে সারি ব্যর্থ হয় সেটি এরর রিপোর্টে যায়; আর কিছুই বদলায় না।',
  ],
  'ordimp.confirm.import': ['Import', 'ইম্পোর্ট করুন'],
  'ordimp.confirm.notYet': ['Not yet', 'এখনই নয়'],

  'ordimp.run.label': ['Importing {file}', '{file} ইম্পোর্ট হচ্ছে'],
  'ordimp.run.done': ['Import finished', 'ইম্পোর্ট শেষ হয়েছে'],
  'ordimp.run.failed': ['Import stopped', 'ইম্পোর্ট থেমে গেছে'],
  'ordimp.run.detail.one': [
    '{handled} of {total} row handled',
    '{total}টি সারির মধ্যে {handled}টি সম্পন্ন',
  ],
  'ordimp.run.detail.other': [
    '{handled} of {total} rows handled',
    '{total}টি সারির মধ্যে {handled}টি সম্পন্ন',
  ],
});
