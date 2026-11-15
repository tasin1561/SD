import { defineMessages } from '../define';

/** "Clone order": the create form pre-filled from an existing order. */
export const cloneOrder = defineMessages({
  'cloneOrder.button': ['Clone order', 'অর্ডার ক্লোন করুন'],
  'cloneOrder.rowLabel': ['Clone order {order}', '{order} অর্ডারটি ক্লোন করুন'],
  'cloneOrder.loading': ['Copying the order…', 'অর্ডারটি কপি করা হচ্ছে…'],
  'cloneOrder.notFound': [
    'We could not find that order to copy. You can still fill in a new order below.',
    'কপি করার মতো সেই অর্ডারটি পাওয়া যায়নি। আপনি নিচে নতুন অর্ডার পূরণ করতে পারেন।',
  ],
  'cloneOrder.failed': [
    'The order could not be loaded to copy. You can still fill in a new order below.',
    'কপি করার জন্য অর্ডারটি লোড করা যায়নি। আপনি নিচে নতুন অর্ডার পূরণ করতে পারেন।',
  ],
  'cloneOrder.title': ['Copied from order {order}', '{order} অর্ডার থেকে কপি করা'],
  'cloneOrder.body': [
    'Nothing is created until you submit. Your own reference, the charges and the address check are not copied — check every field first.',
    'জমা না দেওয়া পর্যন্ত কিছুই তৈরি হয় না। আপনার নিজের রেফারেন্স, চার্জ ও ঠিকানা যাচাই কপি হয়নি — আগে প্রতিটি ঘর দেখে নিন।',
  ],
  'cloneOrder.dropped': [
    'No longer available, so left out: {skus}',
    'আর পাওয়া যায় না, তাই বাদ দেওয়া হয়েছে: {skus}',
  ],
  'cloneOrder.repriced': [
    'Price has changed since that order, check the total: {skus}',
    'ওই অর্ডারের পর দাম বদলেছে, মোট যাচাই করুন: {skus}',
  ],
});
