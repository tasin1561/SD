import { defineMessages } from '../define';

/** Store settings (`/settings`), plus the one-time secret card shared by settings, integrations and team. */
export const settings = defineMessages({
  'setg.title': ['Store settings', 'স্টোর সেটিংস'],
  'setg.subtitle': [
    'How your store presents itself to customers.',
    'আপনার স্টোর গ্রাহকদের কাছে নিজেকে কীভাবে তুলে ধরে।',
  ],
  'setg.loading': ['Loading store settings', 'স্টোর সেটিংস লোড হচ্ছে'],
  'setg.profile': ['Profile', 'প্রোফাইল'],
  'setg.customersSee': ['Customers see', 'গ্রাহকরা যা দেখেন'],
  'setg.contactEmail': ['Contact email', 'যোগাযোগের ইমেইল'],
  'setg.contactPhone': ['Contact phone', 'যোগাযোগের ফোন'],
  'setg.saved': ['Store settings saved.', 'স্টোর সেটিংস সংরক্ষিত হয়েছে।'],
  'setg.displayName': ['Name customers see', 'গ্রাহকরা যে নাম দেখেন'],
  'setg.displayNameHint': ['Leave empty to use “{store}”.', '“{store}” ব্যবহার করতে ফাঁকা রাখুন।'],
  'setg.phoneHint': [
    'With the country code — +8801712345678 for Bangladesh, +919812345678 for India.',
    'দেশের কোডসহ — বাংলাদেশের জন্য +8801712345678, ভারতের জন্য +919812345678।',
  ],
  'setg.save': ['Save', 'সংরক্ষণ করুন'],
  'setg.saving': ['Saving…', 'সংরক্ষণ হচ্ছে…'],
  'setg.notSaved': ['Not saved', 'সংরক্ষণ হয়নি'],
  'setg.logo.title': ['Logo', 'লোগো'],
  'setg.logo.note': ['JPEG, PNG or WebP, up to 1 MB.', 'JPEG, PNG বা WebP, সর্বোচ্চ 1 MB।'],
  'setg.logo.updated': ['Logo updated.', 'লোগো হালনাগাদ হয়েছে।'],
  'setg.logo.alt': ['Your store logo', 'আপনার স্টোরের লোগো'],
  'setg.logo.none': ['No logo yet.', 'এখনও কোনো লোগো নেই।'],
  'setg.logo.choose': ['Choose a logo', 'একটি লোগো বেছে নিন'],
  'setg.logo.uploading': ['Uploading…', 'আপলোড হচ্ছে…'],
  'setg.logo.remove': ['Remove logo', 'লোগো সরান'],
  'setg.logo.removeTitle': ['Remove your logo?', 'আপনার লোগো সরাবেন?'],
  'setg.logo.removeEntity': ['Your store logo', 'আপনার স্টোরের লোগো'],
  'setg.logo.removeConsequence': [
    'Customers see your store’s name without a logo on tracking and anywhere else it shows, until you upload another.',
    'আপনি আরেকটি আপলোড না করা পর্যন্ত ট্র্যাকিংসহ যেখানে যেখানে দেখানো হয়, সেখানে গ্রাহকরা লোগো ছাড়া আপনার স্টোরের নাম দেখবেন।',
  ],
  'setg.logo.removed': ['Logo removed.', 'লোগো সরানো হয়েছে।'],

  'secret.once': [
    'Copy it now — it is shown only this once. We keep only a fingerprint of it.',
    'এখনই কপি করুন — এটি শুধু এই একবারই দেখানো হয়। আমরা শুধু এর একটি ফিঙ্গারপ্রিন্ট রাখি।',
  ],
  'secret.copied': ['Copied.', 'কপি হয়েছে।'],
  'secret.copy': ['Copy', 'কপি করুন'],
});
