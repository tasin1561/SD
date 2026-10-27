import { defineMessages } from '../define';

/** The "What this order earns you" panel on an order. Display copy only: every figure is the server's. */
export const orderMoney = defineMessages({
  'ordm.title': ['What this order earns you', 'এই অর্ডার থেকে আপনি কী পান'],
  'ordm.loading': ['Loading the money', 'টাকার হিসাব লোড হচ্ছে'],
  'ordm.cod': ['COD collected for you', 'আপনার হয়ে আদায় করা COD'],
  'ordm.transfer': ['Goods at the client’s transfer price', 'ক্লায়েন্টের ট্রান্সফার দামে পণ্য'],
  'ordm.taxShare': ['Your share of the COD tax', 'COD করের আপনার অংশ'],
  'ordm.codFeeShare': ['Your share of the COD fee', 'COD ফি-র আপনার অংশ'],
  'ordm.instantShare': ['Your share of the Instant Pay fee', 'ইনস্ট্যান্ট পে ফি-র আপনার অংশ'],
  'ordm.credited': ['You are credited', 'আপনার ওয়ালেটে জমা হবে'],
  'ordm.due': ['Due', 'প্রাপ্য হওয়ার সময়'],
  'ordm.creditedAt': ['Credited', 'জমা হয়েছে'],
  'ordm.takenBack': ['Taken back', 'ফেরত নেওয়া হয়েছে'],
  'ordm.prepaidNote': [
    'A prepaid order is paid from your wallet at confirmation: the goods at the client’s transfer price and your share of the delivery fee. The lines are below.',
    'প্রিপেইড অর্ডারের টাকা নিশ্চিত হওয়ার সময় আপনার ওয়ালেট থেকে কাটা হয়: ক্লায়েন্টের ট্রান্সফার দামে পণ্য এবং ডেলিভারি ফির আপনার অংশ। লাইনগুলো নিচে দেওয়া আছে।',
  ],
  'ordm.notYet': [
    'The money for this order is worked out once it is confirmed.',
    'অর্ডার নিশ্চিত হলে তবেই এর টাকার হিসাব করা হয়।',
  ],
  'ordm.fees.caption': ['Skydrop fees and your share', 'Skydrop-এর ফি এবং আপনার অংশ'],
  'ordm.fees.fee': ['Skydrop fee', 'Skydrop ফি'],
  'ordm.fees.share': ['Your share', 'আপনার অংশ'],
  'ordm.fee.delivery': ['Delivery fee', 'ডেলিভারি ফি'],
  'ordm.fee.rto': ['Return fee', 'রিটার্ন ফি'],
  'ordm.fee.customerReturn': ['Customer return fee', 'গ্রাহকের রিটার্ন ফি'],
  'ordm.lines.none': [
    'Nothing has moved in your wallet for this order yet.',
    'এই অর্ডারের জন্য আপনার ওয়ালেটে এখনও কিছুই নড়েনি।',
  ],
  'ordm.lines.caption': [
    'Your wallet lines for this order',
    'এই অর্ডারের জন্য আপনার ওয়ালেটের লাইন',
  ],
  'ordm.lines.when': ['When', 'কখন'],
  'ordm.lines.in': ['In your wallet', 'আপনার ওয়ালেটে'],
  'ordm.lines.amount': ['Amount', 'পরিমাণ'],
  'ordm.net': [
    'Net in your wallet for this order: {amount}',
    'এই অর্ডারে আপনার ওয়ালেটে মোট: {amount}',
  ],
});
