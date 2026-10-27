import { defineMessages } from '../define';

/**
 * The create-order form. `/orders/new` and `/orders/new-v2` read THESE keys and
 * no others — v2 becomes the only form when the flag flips, so a key landed for
 * one and not the other would be lost. Product names, variant labels and SKUs
 * come from the catalogue and are not translated.
 */
export const orderNew = defineMessages({
  'neworder.title': ['New order', 'নতুন অর্ডার'],
  'neworder.subtitle': [
    'Pick products from your catalogue, set what you sell them for, and say who they are going to.',
    'আপনার ক্যাটালগ থেকে পণ্য বেছে নিন, কত দামে বিক্রি করছেন তা ঠিক করুন এবং কার কাছে যাবে তা লিখুন।',
  ],
  // v2 only: shown while we ask whether this account is in the pilot.
  'neworder.loadingForm': ['Loading the order form…', 'অর্ডার ফর্ম লোড হচ্ছে…'],
  'neworder.loadingCatalogue': ['Loading your catalogue', 'আপনার ক্যাটালগ লোড হচ্ছে'],
  'neworder.back': ['Orders', 'অর্ডার'],
  'neworder.noAccess.title': ['You cannot see the catalogue', 'আপনি ক্যাটালগ দেখতে পারছেন না'],
  'neworder.noAccess.body': [
    'Placing an order starts from your store’s catalogue, and your role cannot open it. Ask an owner or admin of your store to change your role, or to place the order.',
    'অর্ডার দেওয়া শুরু হয় আপনার স্টোরের ক্যাটালগ থেকে, কিন্তু আপনার রোল সেটি খুলতে পারে না। আপনার স্টোরের মালিক বা অ্যাডমিনকে রোল বদলাতে বা অর্ডারটি দিতে বলুন।',
  ],
  'neworder.empty.title': ['Nothing to sell yet', 'বিক্রির মতো কিছু এখনও নেই'],
  'neworder.empty.body': [
    'The client has not turned any products on for your store. Ask them to, then come back.',
    'ক্লায়েন্ট আপনার স্টোরের জন্য কোনো পণ্য চালু করেননি। তাঁকে চালু করতে বলুন, তারপর ফিরে আসুন।',
  ],

  'neworder.stepper.label': ['Order form sections', 'অর্ডার ফর্মের অংশগুলো'],
  'neworder.step.products': ['Products', 'পণ্য'],
  'neworder.step.customer': ['Customer', 'গ্রাহক'],
  'neworder.step.payment': ['Payment', 'পেমেন্ট'],

  'neworder.product': ['Product', 'পণ্য'],
  'neworder.chooseProduct': ['Choose a product', 'একটি পণ্য বেছে নিন'],
  'neworder.optionLabel': ['{label} — {n} available', '{label} — {n}টি মজুত আছে'],
  'neworder.qty': ['Qty', 'পরিমাণ'],
  'neworder.quantity': ['Quantity', 'পরিমাণ'],
  'neworder.sellAt': ['Sell at (₹ each)', 'বিক্রয়মূল্য (প্রতিটি ₹)'],
  'neworder.retailPerUnit': ['Retail price per unit', 'প্রতি ইউনিটের খুচরা দাম'],
  'neworder.sell': ['Sell {range}', 'বিক্রি করুন {range}'],
  'neworder.range.any': ['any price', 'যেকোনো দামে'],
  'neworder.range.between': ['between {min} and {max}', '{min} থেকে {max}-এর মধ্যে'],
  'neworder.range.atLeast': ['{min} or more', '{min} বা তার বেশি দামে'],
  'neworder.range.upTo': ['up to {max}', 'সর্বোচ্চ {max} দামে'],
  'neworder.removeLine': ['Remove this product', 'এই পণ্যটি সরান'],
  'neworder.lineNote': [
    'You pay the client {price} each · {n} available to your store',
    'আপনি ক্লায়েন্টকে প্রতিটির জন্য {price} দেবেন · আপনার স্টোরের জন্য {n}টি মজুত আছে',
  ],
  'neworder.addAnother': ['Add another product', 'আরেকটি পণ্য যোগ করুন'],

  'neworder.orderId': ['Order ID (optional)', 'অর্ডার আইডি (ঐচ্ছিক)'],
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

  'neworder.paidQuestion': ['How is this one paid for?', 'এটির টাকা কীভাবে দেওয়া হবে?'],
  'neworder.cod.title': ['Cash on delivery', 'ক্যাশ অন ডেলিভারি (COD)'],
  'neworder.cod.desc': [
    'The courier collects from your customer on the doorstep and the money comes back to you.',
    'কুরিয়ার দরজায় আপনার গ্রাহকের কাছ থেকে টাকা আদায় করে এবং সেই টাকা আপনার কাছে ফিরে আসে।',
  ],
  'neworder.prepaid.title': ['Prepaid', 'প্রিপেইড'],
  'neworder.prepaid.desc': [
    'Your customer has already paid you. Your store wallet covers the goods and your share of the delivery fee when the order is confirmed.',
    'আপনার গ্রাহক আগেই আপনাকে টাকা দিয়েছেন। অর্ডার নিশ্চিত হলে আপনার স্টোরের ওয়ালেট পণ্যের দাম এবং ডেলিভারি ফির আপনার অংশ মেটায়।',
  ],
  'neworder.deliveryFee': [
    'Delivery charge to the customer (₹, optional)',
    'গ্রাহকের কাছ থেকে ডেলিভারি চার্জ (₹, ঐচ্ছিক)',
  ],
  'neworder.cash': ['Cash to collect (₹)', 'আদায় করার নগদ টাকা (₹)'],
  'neworder.cashHint': ['Leave blank to collect {amount}', '{amount} আদায় করতে চাইলে ফাঁকা রাখুন'],
  'neworder.notes': ['Delivery Notes (optional)', 'ডেলিভারি নোট (ঐচ্ছিক)'],
  'neworder.prepaidNote.withGoods': [
    'Nothing is collected on delivery. When this order is confirmed your wallet pays the goods at your client’s transfer price — {amount} for what is on this order, plus your share of the delivery fee. If the wallet cannot cover it the order is refused and nothing is placed.',
    'ডেলিভারির সময় কিছু আদায় হবে না। অর্ডার নিশ্চিত হলে আপনার ওয়ালেট ক্লায়েন্টের ট্রান্সফার দামে পণ্যের টাকা মেটাবে — এই অর্ডারের পণ্যের জন্য {amount}, সঙ্গে ডেলিভারি ফির আপনার অংশ। ওয়ালেটে না কুলালে অর্ডার প্রত্যাখ্যাত হবে এবং কিছুই দেওয়া হবে না।',
  ],
  'neworder.prepaidNote.noGoods': [
    'Nothing is collected on delivery. When this order is confirmed your wallet pays the goods at your client’s transfer price, plus your share of the delivery fee. If the wallet cannot cover it the order is refused and nothing is placed.',
    'ডেলিভারির সময় কিছু আদায় হবে না। অর্ডার নিশ্চিত হলে আপনার ওয়ালেট ক্লায়েন্টের ট্রান্সফার দামে পণ্যের টাকা মেটাবে, সঙ্গে ডেলিভারি ফির আপনার অংশ। ওয়ালেটে না কুলালে অর্ডার প্রত্যাখ্যাত হবে এবং কিছুই দেওয়া হবে না।',
  ],
  'neworder.codNote': [
    'Skydrop’s call centre confirms every order with the customer before it is packed.',
    'প্যাক করার আগে Skydrop-এর কল সেন্টার প্রতিটি অর্ডার গ্রাহকের সঙ্গে নিশ্চিত করে।',
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
  'neworder.confirm.prepaidAmount': [
    '{amount} of goods from your wallet',
    'আপনার ওয়ালেট থেকে পণ্যের {amount}',
  ],
  'neworder.confirm.toCollect': ['{amount} to collect', '{amount} আদায় করতে হবে'],
  'neworder.confirm.products.one': ['one product', 'একটি পণ্যের জন্য'],
  'neworder.confirm.products.other': ['{n} products', '{n}টি পণ্যের জন্য'],
  'neworder.confirm.mode.prepaid': [
    'paid from your wallet when it is confirmed',
    'নিশ্চিত হলে আপনার ওয়ালেট থেকে টাকা কাটা হবে',
  ],
  'neworder.confirm.mode.cod': ['cash on delivery', 'ক্যাশ অন ডেলিভারি'],
  'neworder.confirm.consequence': [
    'It is placed for {products}, {mode}, and goes to Skydrop’s call centre, who confirm it with the customer before it is packed.',
    'এটি {products}, {mode} হিসেবে দেওয়া হবে এবং Skydrop-এর কল সেন্টারে যাবে, যারা প্যাক করার আগে গ্রাহকের সঙ্গে নিশ্চিত করে।',
  ],
  'neworder.confirm.notYet': ['Not yet', 'এখনই নয়'],
});
