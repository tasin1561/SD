import { defineMessages } from '../define';

/** Copy owned by the "inventory" feature. */
export const inventory = defineMessages({
  'inventory.clientConsole': ['Client console', 'ক্লায়েন্ট কনসোল'],
  'inventory.stock': ['Stock', 'স্টক'],
  'inventory.inventory': ['Inventory', 'ইনভেন্টরি'],
  'inventory.stockAvailableForOrders': [
    'Stock available for orders. Receiving happens at the warehouse — speak to ops to add inventory.',
    'অর্ডারের জন্য পাওয়া স্টক। গ্রহণ ওয়্যারহাউসে হয় — ইনভেন্টরি যোগ করতে অপারেশনসের সাথে কথা বলুন।',
  ],
  'inventory.skus': ['{totalSkus} SKUs', '{totalSkus}টি SKU'],
  'inventory.lowOnStock': ['{lowStockSkus} low on stock', '{lowStockSkus}টির স্টক কম'],
  'inventory.unitsInTransit': [
    '{totalQtyInTransit} units in transit',
    '{totalQtyInTransit}টি ইউনিট পথে',
  ],
  'inventory.unitDiscrepancies': ['Unit discrepancies →', 'ইউনিটের অমিল →'],
  'inventory.indiaStock': ['India stock', 'ভারতের স্টক'],
  'inventory.inTransit': ['In transit', 'পথে আছে'],
  'inventory.lowOnStock2': ['Low on stock', 'স্টক কম'],
  'inventory.stockValueAtCost': ['Stock value at cost', 'ক্রয়মূল্যে স্টকের মূল্য'],
  'inventory.sellableNow': ['Sellable now', 'এখন বিক্রয়যোগ্য'],
  'inventory.heldForOrders': ['Held for orders', 'অর্ডারের জন্য ধরে রাখা'],
  'inventory.goodsThatHaveLeft': [
    'Goods that have left you but are not on our Indian shelf yet — in Dhaka or in the air. They are counted, and they cannot be sold until they arrive.',
    'আপনার কাছ থেকে বেরিয়েছে কিন্তু এখনো আমাদের ভারতের তাকে পৌঁছায়নি এমন পণ্য — ঢাকায় বা আকাশপথে। এগুলো গোনা হয়, কিন্তু পৌঁছানোর আগে বিক্রি করা যায় না।',
  ],
  'inventory.inDhakaOrIn': [
    'In Dhaka or in the air — not sellable yet.',
    'ঢাকায় বা আকাশপথে — এখনো বিক্রয়যোগ্য নয়।',
  ],
  'inventory.nothingIsOnIts': ['Nothing is on its way in.', 'পথে কিছু নেই।'],
  'inventory.atOrUnderThe': [
    'At or under the threshold you set.',
    'আপনার ঠিক করা সীমায় বা তার নিচে।',
  ],
  'inventory.everySkuIsAbove': [
    'Every SKU is above its threshold.',
    'প্রতিটি SKU তার সীমার উপরে আছে।',
  ],
  'inventory.onTheShelfIn': ['On the shelf in India', 'ভারতে তাকে আছে'],
  'inventory.unitsWithNoCost': [
    'Units with no cost — excluded',
    'ক্রয়মূল্য নেই এমন ইউনিট — বাদ দেওয়া হয়েছে',
  ],
  'inventory.stockRegister': ['Stock register', 'স্টক রেজিস্টার'],
  'inventory.loadingInventory': ['Loading inventory…', 'ইনভেন্টরি লোড হচ্ছে…'],
  'inventory.failedToLoadInventory': ['Failed to load inventory.', 'ইনভেন্টরি লোড করা যায়নি।'],
  'inventory.noStockYet': ['No stock yet', 'এখনো কোনো স্টক নেই'],
  'inventory.onceYourShipmentIs': [
    'Once your shipment is received at our Indian warehouse, your variants will show up here with on-hand qty.',
    'আপনার চালান আমাদের ভারতের ওয়্যারহাউসে গ্রহণ করা হলে আপনার ভ্যারিয়েন্টগুলো হাতে থাকা পরিমাণসহ এখানে দেখা যাবে।',
  ],
  'inventory.inbound': ['Inbound', 'ইনবাউন্ড'],
  'inventory.sku': ['SKU', 'SKU'],
  'inventory.variant': ['Variant', 'ভ্যারিয়েন্ট'],
  'inventory.reserved': ['Reserved', 'সংরক্ষিত'],
  'inventory.available': ['Available', 'পাওয়া যাচ্ছে'],
  'inventory.lowStock': ['Low-stock', 'স্টক কম'],
  'inventory.stockRegisterPages': ['Stock register pages', 'স্টক রেজিস্টারের পেজ'],
  'inventory.retry': ['Retry', 'আবার চেষ্টা করুন'],
  'inventory.skus2': ['SKUs', 'SKU'],
});
