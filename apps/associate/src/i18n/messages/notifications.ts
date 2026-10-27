import { defineMessages } from '../define';

/**
 * The notification inbox. The notifications' OWN title/body text and topic
 * names are written by the API in English at send time; this file only owns
 * the screen around them.
 */
export const notifications = defineMessages({
  'ntf.title': ['Notifications', 'বিজ্ঞপ্তি'],
  'ntf.subtitle': [
    'Everything sent to you — what was delivered, what came back, and what could not be delivered. Clearing one hides it from your list; the record of what was sent is kept.',
    'আপনাকে পাঠানো সবকিছু — কী ডেলিভারি হয়েছে, কী ফেরত এসেছে, আর কী ডেলিভারি করা যায়নি। একটি মুছে দিলে তা আপনার তালিকা থেকে লুকিয়ে যায়; কী পাঠানো হয়েছিল তার রেকর্ড থেকে যায়।',
  ],
  'ntf.markAllRead': ['Mark all read', 'সব পড়া হয়েছে'],
  'ntf.clearAll': ['Clear all', 'সব মুছুন'],
  'ntf.inbox': ['Inbox', 'ইনবক্স'],
  'ntf.count.one': ['{n} message', '{n}টি বার্তা'],
  'ntf.count.other': ['{n} messages', '{n}টি বার্তা'],
  'ntf.unreadSuffix': [' · {n} unread', ' · {n}টি না-পড়া'],
  'ntf.loading': ['Loading your notifications', 'আপনার বিজ্ঞপ্তি লোড হচ্ছে'],
  'ntf.empty.title': ['Nothing yet', 'এখনও কিছু নেই'],
  'ntf.empty.body': [
    'Each day you will be told here what was delivered, what came back, and what the courier could not deliver.',
    'প্রতিদিন এখানে জানানো হবে কী ডেলিভারি হয়েছে, কী ফেরত এসেছে, আর কুরিয়ার কী ডেলিভারি করতে পারেনি।',
  ],
  'ntf.loadEarlier': ['Load earlier', 'আগেরগুলো দেখুন'],
  'ntf.unreadCount': ['{n} unread', '{n}টি না-পড়া'],

  'ntf.markAll.title': ['Mark everything read?', 'সবকিছু পড়া হয়েছে চিহ্নিত করবেন?'],
  'ntf.markAll.consequence': [
    'Every message in your inbox is marked read. Nothing is removed.',
    'ইনবক্সের প্রতিটি বার্তা পড়া হয়েছে বলে চিহ্নিত হবে। কিছুই মুছে যাবে না।',
  ],
  'ntf.markAll.notNow': ['Not now', 'এখন নয়'],
  'ntf.clearAll.title': ['Clear your whole inbox?', 'পুরো ইনবক্স মুছে ফেলবেন?'],
  'ntf.clearAll.consequence': [
    'They are hidden from your list and cannot be brought back from here. The record of what was sent to you is kept.',
    'এগুলো আপনার তালিকা থেকে লুকিয়ে যাবে এবং এখান থেকে ফিরিয়ে আনা যাবে না। আপনাকে কী পাঠানো হয়েছিল তার রেকর্ড থেকে যাবে।',
  ],
  'ntf.clearAll.keep': ['Keep them', 'রেখে দিন'],
  'ntf.clearOne.title': ['Clear this from your list?', 'এটি তালিকা থেকে মুছে ফেলবেন?'],
  'ntf.clearOne.consequence': [
    'It is hidden from your list and cannot be brought back from here.',
    'এটি আপনার তালিকা থেকে লুকিয়ে যাবে এবং এখান থেকে ফিরিয়ে আনা যাবে না।',
  ],
  'ntf.clearOne.confirm': ['Clear it', 'মুছে ফেলুন'],
  'ntf.clearOne.keep': ['Keep it', 'রেখে দিন'],

  'ntf.row.new': ['New', 'নতুন'],
  'ntf.row.openOrder': ['Open the order', 'অর্ডারটি খুলুন'],
  'ntf.row.markUnread': ['Mark unread', 'না-পড়া চিহ্নিত করুন'],
  'ntf.row.marking': ['Marking…', 'চিহ্নিত হচ্ছে…'],
  'ntf.row.unread': ['Unread', 'না-পড়া'],
  'ntf.row.clear': ['Clear from my list', 'আমার তালিকা থেকে মুছুন'],
});
