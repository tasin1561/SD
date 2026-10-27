import { defineMessages } from '../define';

/** The catalogue (`/catalogue`): what this store may sell, from the client. Product names and SKUs are data. */
export const catalogue = defineMessages({
  'cat.title': ['Catalogue', 'ক্যাটালগ'],
  'cat.clientFallback': ['The client', 'ক্লায়েন্ট'],
  'cat.subtitle': [
    'The products {seller} lets you sell, what you pay for each, and how many are available.',
    '{seller} আপনাকে যে পণ্যগুলো বিক্রি করতে দেয়, প্রতিটির জন্য আপনি কত দেবেন এবং কতগুলো মজুত আছে।',
  ],
  'cat.loading': ['Loading the catalogue', 'ক্যাটালগ লোড হচ্ছে'],
  'cat.search.label': ['Search by name or SKU', 'নাম বা SKU দিয়ে খুঁজুন'],
  'cat.search.placeholder': ['Search name or SKU', 'নাম বা SKU খুঁজুন'],
  'cat.empty.none': ['No products yet', 'এখনও কোনো পণ্য নেই'],
  'cat.empty.noMatch': ['Nothing matches that search', 'এই সার্চে কিছু মেলেনি'],
  'cat.empty.body': [
    '{seller} has not given this store any products yet. Ask them to turn some on.',
    '{seller} এখনও এই স্টোরকে কোনো পণ্য দেয়নি। তাদের কিছু চালু করতে বলুন।',
  ],
  'cat.caption': ['Products', 'পণ্য'],
  'cat.col.product': ['Product', 'পণ্য'],
  'cat.col.youPay': ['You pay', 'আপনি দেবেন'],
  'cat.col.sellBetween': ['Sell between', 'বিক্রির সীমা'],
  'cat.col.suggested': ['Suggested', 'প্রস্তাবিত'],
  'cat.col.available': ['Available', 'মজুত'],
  'cat.transfer.title': ['Transfer price', 'ট্রান্সফার প্রাইস'],
  'cat.transfer.body': [
    'What your store pays {seller} for each unit you sell. The difference between it and the retail price you charge is yours, before your share of Skydrop’s fees.',
    'আপনি যে প্রতিটি ইউনিট বিক্রি করেন তার জন্য আপনার স্টোর {seller}-কে যা দেয়। এটি এবং আপনার নেওয়া খুচরা দামের পার্থক্যই আপনার, Skydrop-এর ফিতে আপনার অংশ বাদ দেওয়ার আগে।',
  ],
  'cat.range.any': ['Any price', 'যেকোনো দাম'],
  'cat.range.upTo': ['up to {max}', 'সর্বোচ্চ {max}'],
  'cat.range.between': ['{min} – {max}', '{min} – {max}'],
  'cat.range.atLeast': ['{min} or more', '{min} বা তার বেশি'],
});
