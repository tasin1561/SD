import { defineMessages } from '../define';

/** Which template columns are required and which are optional (bulk upload pages). Column headers are data and stay as the file prints them. */
export const csvColumns = defineMessages({
  'csvcols.title': ['Which columns do I need?', 'কোন কোন কলাম লাগবে?'],
  'csvcols.everyRow': ['Every row', 'প্রতিটি সারি'],
  'csvcols.everyRowHint': [
    'Mandatory on every single row of the file.',
    'ফাইলের প্রতিটি সারিতে আবশ্যক।',
  ],
  'csvcols.oncePerOrder': ['Once per order', 'প্রতি অর্ডারে একবার'],
  'csvcols.oncePerOrderHint': [
    'For an order with several rows, fill these on its first row. The following rows of the same order may leave them blank.',
    'একাধিক সারির অর্ডারে এগুলো প্রথম সারিতে পূরণ করুন। একই অর্ডারের পরের সারিগুলোতে ফাঁকা রাখা যাবে।',
  ],
  'csvcols.colTitle': ['Title', 'শিরোনাম'],
  'csvcols.colMandatory': ['Mandatory', 'আবশ্যক'],
  'csvcols.colDescription': ['Description', 'বিবরণ'],
  'csvcols.colSample': ['Sample', 'নমুনা'],
  'csvcols.yes': ['Yes', 'হ্যাঁ'],
  'csvcols.no': ['No', 'না'],
  'csvcols.notUsed': ['Not used', 'ব্যবহৃত হয় না'],
  'csvcols.uat': ['(enabled in settings)', '(সেটিংসে চালু)'],
  'csvcols.landmarkNote': [
    'The landmark, e.g. "Near City Hospital". The courier address is line 1 + line 2, so this is required even though Delhivery’s own template leaves it blank — a blank here fails the row.',
    'ল্যান্ডমার্ক, যেমন "Near City Hospital"। কুরিয়ারের ঠিকানা হলো লাইন 1 + লাইন 2, তাই এটি আবশ্যক — Delhivery-র নিজের টেমপ্লেটে এটি ফাঁকা থাকলেও। এখানে ফাঁকা থাকলে সারিটি ব্যর্থ হবে।',
  ],
  'csvcols.d.externalRef': [
    'Your own order number. Rows sharing one number are lines of ONE order.',
    'আপনার নিজের অর্ডার নম্বর। একই নম্বরের সারিগুলো একটি অর্ডারের লাইন।',
  ],
  'csvcols.d.paymentMode': [
    'COD or Prepaid. It decides whether the courier collects cash.',
    'COD অথবা Prepaid। এটি ঠিক করে কুরিয়ার নগদ সংগ্রহ করবে কি না।',
  ],
  'csvcols.d.customerName': ['The customer’s full name.', 'গ্রাহকের পূর্ণ নাম।'],
  'csvcols.d.customerPhone': [
    'A 10-digit Indian mobile. Format the column as Text so Excel keeps every digit.',
    '10 সংখ্যার ভারতীয় মোবাইল নম্বর। Excel যেন সব সংখ্যা রাখে তাই কলামটি Text ফরম্যাটে রাখুন।',
  ],
  'csvcols.d.addressLine1': ['House, street and area.', 'বাড়ি, রাস্তা ও এলাকা।'],
  'csvcols.d.city': [
    'The customer’s city. We can work it out from the PIN code.',
    'গ্রাহকের শহর। পিন কোড থেকেই আমরা এটি বের করতে পারি।',
  ],
  'csvcols.d.state': [
    'The customer’s state. We can work it out from the PIN code.',
    'গ্রাহকের রাজ্য। পিন কোড থেকেই আমরা এটি বের করতে পারি।',
  ],
  'csvcols.d.pinCode': [
    'The 6-digit PIN code. The courier routes the parcel on this.',
    '6 সংখ্যার পিন কোড। কুরিয়ার এটি দেখেই পার্সেল পাঠায়।',
  ],
  'csvcols.d.productSku': [
    'The SKU of the item, exactly as in your catalogue.',
    'পণ্যের SKU, আপনার ক্যাটালগে যেমন আছে ঠিক তেমন।',
  ],
  'csvcols.d.quantity': ['How many units of this item.', 'এই পণ্যের কত ইউনিট।'],
  'csvcols.d.retailUnitPrice': ['The selling price of one unit.', 'এক ইউনিটের বিক্রয়মূল্য।'],
  'csvcols.d.advanceAmount': [
    'Cash already paid by the customer, if any.',
    'গ্রাহক আগেই যে টাকা দিয়েছেন, থাকলে।',
  ],
  'csvcols.d.codAmount': [
    'The total the courier collects. Leave empty for Prepaid.',
    'কুরিয়ার মোট যত টাকা সংগ্রহ করবে। Prepaid হলে ফাঁকা রাখুন।',
  ],
  'csvcols.d.deliveryFee': [
    'The delivery charge you took from the customer.',
    'গ্রাহকের কাছ থেকে নেওয়া ডেলিভারি চার্জ।',
  ],
  'csvcols.d.discountValue': ['The discount you gave.', 'আপনার দেওয়া ছাড়।'],
  'csvcols.d.discountType': [
    'Whether the discount is a percentage or a fixed amount.',
    'ছাড়টি শতাংশ নাকি নির্দিষ্ট অঙ্কের।',
  ],
  'csvcols.d.declaredValue': ['The declared value of the parcel.', 'পার্সেলের ঘোষিত মূল্য।'],
  'csvcols.d.productName': ['The product’s name.', 'পণ্যের নাম।'],
  'csvcols.d.productExternalRef': [
    'Your own product ID. Variants of one product share it.',
    'আপনার নিজের প্রোডাক্ট আইডি। একই পণ্যের ভ্যারিয়েন্টগুলো এটি শেয়ার করে।',
  ],
  'csvcols.d.variantSkuCode': ['A unique SKU for this variant.', 'এই ভ্যারিয়েন্টের অনন্য SKU।'],
  'csvcols.d.weightGrams': ['Weight of one unit, in grams.', 'এক ইউনিটের ওজন, গ্রামে।'],
  'csvcols.d.lengthCm': ['Parcel length in cm.', 'পার্সেলের দৈর্ঘ্য, সেমিতে।'],
  'csvcols.d.widthCm': ['Parcel width in cm.', 'পার্সেলের প্রস্থ, সেমিতে।'],
  'csvcols.d.heightCm': ['Parcel height in cm.', 'পার্সেলের উচ্চতা, সেমিতে।'],
  'csvcols.d.declaredValueInr': [
    'Declared value of one unit, in rupees.',
    'এক ইউনিটের ঘোষিত মূল্য, টাকায়।',
  ],
  'csvcols.d.barcode': ['The barcode printed on the item, if any.', 'পণ্যে ছাপা বারকোড, থাকলে।'],
  'csvcols.d.variantAttributes': [
    'Attributes as name=value pairs, e.g. color=Red;size=M.',
    'নাম=মান জোড়ায় বৈশিষ্ট্য, যেমন color=Red;size=M।',
  ],
});
