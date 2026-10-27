import { defineMessages } from '../define';

/** The orders list (`/orders`). The order detail has its own file, `orderDetail.ts`. */
export const orders = defineMessages({
  'orders.title': ['Orders', 'অর্ডার'],
  'orders.subtitle': [
    'Everything your store has sold, and where each order has got to.',
    'আপনার স্টোর যা কিছু বিক্রি করেছে এবং প্রতিটি অর্ডার এখন কোথায় আছে।',
  ],
  'orders.uploadCsv': ['Upload a CSV', 'CSV আপলোড করুন'],
  'orders.newOrder': ['New order', 'নতুন অর্ডার'],
  'orders.section': ['Your orders', 'আপনার অর্ডার'],
  'orders.shown': ['{shown} of {total} shown', '{total}টির মধ্যে {shown}টি দেখানো হচ্ছে'],
  'orders.loading': ['Loading orders', 'অর্ডার লোড হচ্ছে'],
  'orders.search': ['Search', 'খুঁজুন'],
  'orders.searchAria': ['Search orders', 'অর্ডার খুঁজুন'],
  'orders.searchPlaceholder': [
    'Order, reference, customer or waybill',
    'অর্ডার, রেফারেন্স, গ্রাহক বা ওয়েবিল',
  ],
  'orders.status': ['Status', 'অবস্থা'],
  'orders.filterByStatus': ['Filter by status', 'অবস্থা অনুযায়ী ফিল্টার'],
  'orders.allStatuses': ['All statuses', 'সব অবস্থা'],
  'orders.tabAll': ['All', 'সব'],
  'orders.empty.none': ['No orders yet', 'এখনও কোনো অর্ডার নেই'],
  'orders.empty.noMatch': ['Nothing matches', 'কিছু মেলেনি'],
  'orders.empty.firstOrder': [
    'Place your first order from your catalogue, or upload a CSV of them.',
    'আপনার ক্যাটালগ থেকে প্রথম অর্ডারটি দিন, অথবা অর্ডারগুলোর একটি CSV আপলোড করুন।',
  ],
  'orders.empty.willAppear': [
    'Orders your store places will appear here.',
    'আপনার স্টোরের দেওয়া অর্ডার এখানে দেখা যাবে।',
  ],
  'orders.empty.clear': [
    'Try clearing the search or the status filter.',
    'সার্চ বা অবস্থার ফিল্টারটি মুছে চেষ্টা করুন।',
  ],
  'orders.table.caption': ['Orders', 'অর্ডার'],
  'orders.col.order': ['Order', 'অর্ডার'],
  'orders.col.customer': ['Customer', 'গ্রাহক'],
  'orders.col.status': ['Status', 'অবস্থা'],
  'orders.col.collect': ['To collect', 'আদায় করতে হবে'],
  'orders.col.placed': ['Placed', 'দেওয়া হয়েছে'],
  'orders.ref': ['ref {ref}', 'রেফ {ref}'],
  'orders.prepaid': ['Prepaid', 'প্রিপেইড'],
  'orders.pages': ['Orders pages', 'অর্ডারের পাতা'],
});
