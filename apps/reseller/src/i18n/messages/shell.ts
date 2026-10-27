import { defineMessages } from '../define';

/** The signed-in chrome: navigation, page metadata, the access boundary, the error screen. */
export const shell = defineMessages({
  'shell.subtitle': ['Store', 'স্টোর'],
  'shell.section': ['Member store portal', 'মেম্বার স্টোর পোর্টাল'],
  'shell.meta.title': ['Skydrop Store', 'Skydrop স্টোর'],
  'shell.meta.description': [
    'Skydrop member store portal — run your store.',
    'Skydrop মেম্বার স্টোর পোর্টাল — আপনার স্টোর চালান।',
  ],
  'nav.store': ['Store', 'স্টোর'],
  'nav.setup': ['Setup', 'সেটআপ'],
  'nav.you': ['You', 'আপনি'],
  'nav.dashboard': ['Dashboard', 'ড্যাশবোর্ড'],
  'nav.orders': ['Orders', 'অর্ডার'],
  'nav.unreachable': ['Unreachable customers', 'যোগাযোগ করা যায়নি এমন গ্রাহক'],
  'nav.customers': ['Customers', 'গ্রাহক'],
  'nav.catalogue': ['Catalogue', 'ক্যাটালগ'],
  'nav.associates': ['Associates', 'অ্যাসোসিয়েট'],
  'nav.terms': ['Terms', 'শর্তাবলী'],
  'nav.wallet': ['Wallet', 'ওয়ালেট'],
  'nav.reports': ['Reports', 'রিপোর্ট'],
  'nav.expenses': ['Expenses', 'খরচ'],
  'nav.tickets': ['Tickets', 'টিকিট'],
  'nav.team': ['Team', 'টিম'],
  'nav.integrations': ['Integrations', 'ইন্টিগ্রেশন'],
  'nav.settings': ['Store settings', 'স্টোর সেটিংস'],
  'nav.notifications': ['Notifications', 'নোটিফিকেশন'],
  'nav.account': ['My account', 'আমার অ্যাকাউন্ট'],

  'error.updating': ['Updating…', 'হালনাগাদ হচ্ছে…'],
  'error.unavailable': ['Service unavailable', 'সেবা পাওয়া যাচ্ছে না'],
  'error.didNotLoad': ['This page did not load', 'এই পাতাটি লোড হয়নি'],
  'error.staleBody': [
    'This tab was open while a new version shipped, so it asked for a file that no longer exists. Reloading to pick up the current one.',
    'নতুন সংস্করণ চালু হওয়ার সময় এই ট্যাবটি খোলা ছিল, তাই এটি এমন একটি ফাইল চেয়েছে যা আর নেই। বর্তমানটি আনতে পাতাটি রিলোড হচ্ছে।',
  ],
  'error.outageBody': [
    'We couldn’t reach the API. Your session is intact — this is a temporary outage.',
    'আমরা API-তে পৌঁছাতে পারিনি। আপনার সেশন অক্ষত আছে — এটি সাময়িক বিভ্রাট।',
  ],
  'error.failedBody': [
    'Your session is intact — something on this page failed to load.',
    'আপনার সেশন অক্ষত আছে — এই পাতার কিছু একটা লোড হয়নি।',
  ],
  'error.digest': ['digest {digest}', 'ডাইজেস্ট {digest}'],
  'error.unknown': ['unknown', 'অজানা'],
  'error.reloadNow': ['Reload now', 'এখনই রিলোড করুন'],
  'error.tryAgain': ['Try again', 'আবার চেষ্টা করুন'],

  'boundary.title': ['Not available', 'পাওয়া যাচ্ছে না'],
  'boundary.empty': [
    'This section is not part of your access',
    'এই অংশটি আপনার অ্যাক্সেসের মধ্যে পড়ে না',
  ],
  'boundary.body': [
    'This page needs the “{permission}” permission and your role does not have it. An owner of your store can change your role under Team.',
    'এই পাতার জন্য “{permission}” অনুমতি লাগে, কিন্তু আপনার রোলে তা নেই। আপনার স্টোরের মালিক টিম থেকে আপনার রোল বদলে দিতে পারেন।',
  ],
  'boundary.unknownPermission': ['unknown', 'অজানা'],
  'boundary.dashboard': ['Go to the dashboard', 'ড্যাশবোর্ডে যান'],
});
