import { defineMessages } from '../define';

/** The signed-in chrome: navigation, the access boundary, the error screen, page metadata. */
export const shell = defineMessages({
  'shell.subtitle': ['Sales', 'সেলস'],
  'shell.section': ['Associate portal', 'অ্যাসোসিয়েট পোর্টাল'],
  'shell.meta.title': ['Skydrop Sales', 'Skydrop সেলস'],
  'shell.meta.description': [
    'Skydrop associate portal — place orders for your store and follow them.',
    'Skydrop অ্যাসোসিয়েট পোর্টাল — আপনার স্টোরের জন্য অর্ডার দিন এবং সেগুলোর অবস্থা দেখুন।',
  ],

  'nav.selling': ['Selling', 'বিক্রি'],
  'nav.following': ['Following up', 'ফলো-আপ'],
  'nav.you': ['You', 'আপনি'],
  'nav.newOrder': ['New order', 'নতুন অর্ডার'],
  'nav.whatISell': ['What I sell', 'আমি যা বিক্রি করি'],
  'nav.uploadCsv': ['Upload a CSV', 'CSV আপলোড করুন'],
  'nav.myOrders': ['My orders', 'আমার অর্ডার'],
  'nav.myCustomers': ['My customers', 'আমার গ্রাহক'],
  'nav.issues': ['Issues', 'সমস্যা'],
  'nav.notifications': ['Notifications', 'বিজ্ঞপ্তি'],
  'nav.myAccount': ['My account', 'আমার অ্যাকাউন্ট'],

  'boundary.title': ['Not available', 'পাওয়া যাচ্ছে না'],
  'boundary.empty': ['This is not part of your access', 'এটি আপনার অনুমতির মধ্যে পড়ে না'],
  'boundary.description': [
    'This page needs the “{permission}” permission and your role does not have it. Whoever runs your store can change that.',
    'এই পেজের জন্য “{permission}” অনুমতি দরকার, কিন্তু আপনার ভূমিকায় তা নেই। যিনি আপনার স্টোর চালান, তিনি এটি বদলাতে পারেন।',
  ],
  'boundary.unknownPermission': ['unknown', 'অজানা'],
  'boundary.goOrders': ['Go to my orders', 'আমার অর্ডারে যান'],

  'error.updating': ['Updating…', 'আপডেট হচ্ছে…'],
  'error.unavailable': ['Service unavailable', 'সেবা এখন পাওয়া যাচ্ছে না'],
  'error.didNotLoad': ['This page did not load', 'এই পেজ লোড হয়নি'],
  'error.staleBody': [
    'This tab was open while a new version shipped, so it asked for a file that no longer exists. Reloading to pick up the current one.',
    'নতুন সংস্করণ চালু হওয়ার সময় এই ট্যাবটি খোলা ছিল, তাই এটি এমন একটি ফাইল চেয়েছে যা আর নেই। বর্তমান সংস্করণ পেতে আবার লোড করা হচ্ছে।',
  ],
  'error.outageBody': [
    'We couldn’t reach the API. Your session is intact — this is a temporary outage.',
    'আমরা API-তে পৌঁছাতে পারিনি। আপনার সেশন ঠিক আছে — এটি সাময়িক সমস্যা।',
  ],
  'error.failedBody': [
    'Your session is intact — something on this page failed to load.',
    'আপনার সেশন ঠিক আছে — এই পেজের কিছু একটা লোড হয়নি।',
  ],
  'error.digest': ['digest {digest}', 'digest {digest}'],
  'error.unknown': ['unknown', 'অজানা'],
  'error.reload': ['Reload now', 'এখনই রিলোড করুন'],
});
