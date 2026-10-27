import { defineMessages } from '../define';

/** The new-order form. Product names, variant labels and SKUs come from the catalogue and are not translated. */
export const orderNew = defineMessages({
  'neworder.title': ['New order', 'নতুন অর্ডার'],
  // v2 only: shown while we ask whether this account is in the pilot.
  'neworder.loading': ['Loading the order form…', 'অর্ডার ফর্ম লোড হচ্ছে…'],
  'neworder.subtitle': [
    'Pick what your customer is buying and say where it is going. Your prices are set by your store.',
    'আপনার গ্রাহক কী কিনছেন তা বেছে নিন এবং কোথায় যাবে তা লিখুন। আপনার দাম আপনার স্টোর ঠিক করে।',
  ],
  'neworder.empty.body': [
    'Your store has not given you any products to sell. Ask whoever runs it to add some, then come back.',
    'আপনার স্টোর আপনাকে বিক্রির জন্য কোনো পণ্য দেয়নি। যিনি স্টোর চালান তাঁকে কিছু যোগ করতে বলুন, তারপর ফিরে আসুন।',
  ],
  'neworder.paused.body': [
    'You can still read, track and follow up everything you have already placed. Ask whoever runs your store to switch it back on.',
    'আপনি আগে যা দিয়েছেন সেগুলো এখনও দেখতে, ট্র্যাক করতে ও ফলো-আপ করতে পারবেন। আবার চালু করতে যিনি স্টোর চালান তাঁকে বলুন।',
  ],

  'neworder.buying': ['What they are buying', 'তারা কী কিনছেন'],
  'neworder.buyingNote': ['Your store sets these prices', 'এই দামগুলো আপনার স্টোর ঠিক করে'],
  'neworder.product': ['Product', 'পণ্য'],
  'neworder.chooseProduct': ['Choose a product', 'একটি পণ্য বেছে নিন'],
  'neworder.optionLabel': ['{label} — {n} available', '{label} — {n}টি মজুত আছে'],
  'neworder.qty': ['Qty', 'পরিমাণ'],
  'neworder.quantity': ['Quantity', 'পরিমাণ'],
  'neworder.removeLine': ['Remove this product', 'এই পণ্যটি সরান'],
  'neworder.each': ['{price} each', 'প্রতিটি {price}'],
  'neworder.noneLeft': ['None left', 'আর নেই'],
  'neworder.available': ['{n} available', '{n}টি মজুত আছে'],
  'neworder.addAnother': ['Add another product', 'আরেকটি পণ্য যোগ করুন'],
  'neworder.unpriced.one': [
    'One product is missing from the list above because nobody has set your price for it: {list}. Ask whoever runs your store to set one.',
    'একটি পণ্য উপরের তালিকায় নেই, কারণ কেউ এর জন্য আপনার দাম ঠিক করেনি: {list}। যিনি স্টোর চালান, তাঁকে দাম ঠিক করতে বলুন।',
  ],
  'neworder.unpriced.many': [
    '{n} products are missing from the list above because nobody has set your price for them: {list}. Ask whoever runs your store to set one.',
    '{n}টি পণ্য উপরের তালিকায় নেই, কারণ কেউ সেগুলোর জন্য আপনার দাম ঠিক করেনি: {list}। যিনি স্টোর চালান, তাঁকে দাম ঠিক করতে বলুন।',
  ],

  'neworder.where': ['Where it is going', 'কোথায় যাচ্ছে'],
  'neworder.name': ['Name', 'নাম'],
  'neworder.phone': ['Phone', 'ফোন'],
  'neworder.phoneHint': [
    'With the country code, e.g. +919876543210',
    'দেশের কোডসহ, যেমন +919876543210',
  ],
  'neworder.email': ['Email (optional)', 'ইমেইল (ঐচ্ছিক)'],
  'neworder.pin': ['PIN code', 'পিন কোড'],
  'neworder.address': ['Address', 'ঠিকানা'],
  'neworder.landmark': ['Landmark', 'ল্যান্ডমার্ক'],
  'neworder.landmarkHint': [
    'What a driver looks for to find the door',
    'ড্রাইভার দরজা খুঁজে পেতে যা দেখে',
  ],

  'neworder.paid': ['How it is paid for', 'কীভাবে টাকা দেওয়া হবে'],
  'neworder.paidQuestion': ['How is this one paid for?', 'এটির টাকা কীভাবে দেওয়া হবে?'],
  'neworder.cod.title': ['Cash on delivery', 'ক্যাশ অন ডেলিভারি (COD)'],
  'neworder.cod.desc': [
    'The courier collects from your customer on the doorstep.',
    'কুরিয়ার দরজায় আপনার গ্রাহকের কাছ থেকে টাকা আদায় করে।',
  ],
  'neworder.prepaid.title': ['Prepaid', 'প্রিপেইড'],
  'neworder.prepaid.desc': [
    'Your customer has already paid. Nothing is collected on delivery.',
    'আপনার গ্রাহক আগেই টাকা দিয়েছেন। ডেলিভারির সময় কিছু আদায় হবে না।',
  ],
  'neworder.deliveryFee': [
    'Delivery charge to the customer (₹, optional)',
    'গ্রাহকের কাছ থেকে ডেলিভারি চার্জ (₹, ঐচ্ছিক)',
  ],
  'neworder.cash': ['Cash to collect (₹)', 'আদায় করার নগদ টাকা (₹)'],
  'neworder.cashHint': ['Leave blank to collect {amount}', '{amount} আদায় করতে চাইলে ফাঁকা রাখুন'],
  'neworder.reference': ['Order ID (optional)', 'অর্ডার আইডি (ঐচ্ছিক)'],
  'neworder.notes': ['Delivery Notes (optional)', 'ডেলিভারি নোট (ঐচ্ছিক)'],
  'neworder.prepaidNote': [
    "Nothing is collected on delivery. Your store's wallet covers this order when it is confirmed; if it cannot, the order is refused and nothing is placed.",
    'ডেলিভারির সময় কিছু আদায় হবে না। অর্ডার নিশ্চিত হলে আপনার স্টোরের ওয়ালেট এর খরচ মেটায়; না পারলে অর্ডার প্রত্যাখ্যাত হয় এবং কিছুই দেওয়া হয় না।',
  ],
  'neworder.codNote': [
    "Skydrop's call centre rings every customer to confirm the order before it is packed.",
    'প্যাক করার আগে Skydrop-এর কল সেন্টার প্রতিটি গ্রাহককে ফোন করে অর্ডার নিশ্চিত করে।',
  ],
  'neworder.duplicate': [
    'This is a separate order — place it anyway',
    'এটি আলাদা একটি অর্ডার — তবুও দিন',
  ],

  'neworder.summary.none': ['No products chosen yet', 'এখনও কোনো পণ্য বাছা হয়নি'],
  'neworder.products.one': ['{n} product', '{n}টি পণ্য'],
  'neworder.products.other': ['{n} products', '{n}টি পণ্য'],
  'neworder.mode.prepaid': ['prepaid', 'প্রিপেইড'],
  'neworder.mode.cod': ['cash on delivery', 'ক্যাশ অন ডেলিভারি'],
  'neworder.summary': ['{products} · {mode}', '{products} · {mode}'],
  'neworder.cancel': ['Cancel', 'বাতিল'],
  'neworder.place': ['Place order', 'অর্ডার দিন'],
  'neworder.placing': ['Placing…', 'অর্ডার দেওয়া হচ্ছে…'],
  'neworder.notPlaced': ['Not placed', 'অর্ডার দেওয়া হয়নি'],

  'neworder.confirm.title': ['Place this order?', 'এই অর্ডারটি দেবেন?'],
  'neworder.confirm.alreadyPaid': ['Already paid', 'আগেই পরিশোধিত'],
  'neworder.confirm.toCollect': ['{amount} to collect', '{amount} আদায় করতে হবে'],
  'neworder.confirm.products.one': ['one product', 'একটি পণ্যের জন্য'],
  'neworder.confirm.products.other': ['{n} products', '{n}টি পণ্যের জন্য'],
  'neworder.confirm.mode.prepaid': ['already paid for', 'আগেই পরিশোধিত'],
  'neworder.confirm.mode.cod': ['cash on delivery', 'ক্যাশ অন ডেলিভারি'],
  'neworder.confirm.consequence': [
    "It is placed for {products}, {mode}, and goes to Skydrop's call centre, who ring the customer to confirm it before it is packed.",
    'এটি {products}, {mode} হিসেবে দেওয়া হবে এবং Skydrop-এর কল সেন্টারে যাবে, যারা প্যাক করার আগে গ্রাহককে ফোন করে নিশ্চিত করবে।',
  ],
  'neworder.confirm.notYet': ['Not yet', 'এখনই নয়'],
});
