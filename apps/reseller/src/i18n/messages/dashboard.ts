import { defineMessages } from '../define';

/** The landing page (`/dashboard`). */
export const dashboard = defineMessages({
  'dash.reselling': ['Reselling for {seller}', '{seller}-এর হয়ে বিক্রি করছেন'],
  'dash.paused': [
    '{seller} has paused this store. It takes no new orders until they resume it; anything already placed carries on.',
    '{seller} এই স্টোরটি বিরতিতে রেখেছে। তারা আবার চালু না করা পর্যন্ত এটি নতুন কোনো অর্ডার নেবে না; আগে যা দেওয়া হয়েছে তা চলতে থাকবে।',
  ],
  'dash.goTo': ['Go to', 'যান'],
  'dash.go': ['Go', 'যান'],
  'dash.newOrder': ['New order', 'নতুন অর্ডার'],
  'dash.shortcut.orders': ['Orders', 'অর্ডার'],
  'dash.shortcut.ordersHint': ['Where each order has got to', 'প্রতিটি অর্ডার এখন কোথায়'],
  'dash.shortcut.newOrder': ['New order', 'নতুন অর্ডার'],
  'dash.shortcut.newOrderHint': ['Sell from your catalogue', 'আপনার ক্যাটালগ থেকে বিক্রি করুন'],
  'dash.shortcut.wallet': ['Wallet', 'ওয়ালেট'],
  'dash.shortcut.walletHint': ['Balance and every movement', 'ব্যালেন্স এবং প্রতিটি লেনদেন'],
  'dash.shortcut.reports': ['Reports', 'রিপোর্ট'],
  'dash.shortcut.reportsHint': ['Profit and loss by month', 'মাসভিত্তিক লাভ-ক্ষতি'],
  'dash.shortcut.tickets': ['Tickets', 'টিকিট'],
  'dash.shortcut.ticketsHint': [
    'Problems raised with your client, or with Skydrop',
    'আপনার ক্লায়েন্ট বা Skydrop-এর কাছে জানানো সমস্যা',
  ],
  'dash.store.title': ['Your store', 'আপনার স্টোর'],
  'dash.store.name': ['Store', 'স্টোর'],
  'dash.store.customersSee': ['Customers see', 'গ্রাহকরা যে নাম দেখেন'],
  'dash.store.status': ['Status', 'অবস্থা'],
  'dash.store.resellingFor': ['Reselling for', 'যার হয়ে বিক্রি করছেন'],
  'dash.store.walletManagedBy': ['Wallet managed by', 'ওয়ালেট পরিচালনা করেন'],
  'dash.store.roles': ['Your roles', 'আপনার রোল'],
  'dash.store.rolesJoin': [' and ', ' এবং '],
  'dash.sell.title': ['What you can sell', 'আপনি কী বিক্রি করতে পারেন'],
  'dash.sell.body': [
    '{seller} decides which of their products you may sell, what you pay for each and the price range you may sell at.',
    'আপনি কোন পণ্য বিক্রি করতে পারবেন, প্রতিটির জন্য কত দেবেন এবং কোন দামের সীমার মধ্যে বিক্রি করতে পারবেন তা {seller} ঠিক করে।',
  ],
  'dash.sell.link': ['See your catalogue →', 'আপনার ক্যাটালগ দেখুন →'],
  'dash.tiles.aria': ['Wallet', 'ওয়ালেট'],
  'dash.tile.balance': ['Wallet balance', 'ওয়ালেট ব্যালেন্স'],
  'dash.tile.owed': ['You are owed', 'আপনার পাওনা'],
  'dash.tile.owe': ['You owe your client', 'আপনি ক্লায়েন্টের কাছে ঋণী'],
});
