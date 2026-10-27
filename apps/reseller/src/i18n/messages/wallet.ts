import { defineMessages } from '../define';

/**
 * The store wallet (`/wallet`). Display copy only: every figure and every
 * state is the server's. `wal.*` the page and top-up, `walwd.*` the withdraw
 * card, `walled.*` the ledger.
 */
export const wallet = defineMessages({
  'wal.title': ['Wallet', 'ওয়ালেট'],
  'wal.headerSubtitle': [
    'Your store’s balance and every movement of it.',
    'আপনার স্টোরের ব্যালেন্স এবং তার প্রতিটি লেনদেন।',
  ],
  'wal.loading': ['Loading the wallet', 'ওয়ালেট লোড হচ্ছে'],
  'wal.subtitle.skydrop': [
    'Skydrop manages this wallet: send money to our bank to top it up, and withdraw through us.',
    'এই ওয়ালেট Skydrop পরিচালনা করে: টপ-আপ করতে আমাদের ব্যাংকে টাকা পাঠান, আর উত্তোলন করুন আমাদের মাধ্যমে।',
  ],
  'wal.subtitle.seller': [
    '{seller} manages this wallet: they top it up for you and pay you directly.',
    'এই ওয়ালেট {seller} পরিচালনা করে: তারা আপনার হয়ে টপ-আপ করে এবং সরাসরি আপনাকে টাকা দেয়।',
  ],
  'wal.kpi.balance': ['Balance', 'ব্যালেন্স'],
  'wal.kpi.withdraw': ['You can withdraw', 'আপনি উত্তোলন করতে পারবেন'],
  'wal.kpi.withdrawHint': [
    'Your balance, less withdrawals already asked for.',
    'আপনার ব্যালেন্স, আগে অনুরোধ করা উত্তোলন বাদ দিয়ে।',
  ],
  'wal.kpi.negative': ['May go below zero by', 'শূন্যের নিচে যেতে পারে সর্বোচ্চ'],
  'wal.kpi.negativeHint': ['Set by {seller}.', '{seller} ঠিক করেছে।'],
  'wal.kpi.waiting': ['Waiting on Skydrop', 'Skydrop-এর অপেক্ষায়'],
  'wal.kpi.waitingHint': [
    'Top-ups to be seen and withdrawals to be paid.',
    'যে টপ-আপ দেখা এবং যে উত্তোলন পরিশোধ করা বাকি।',
  ],
  'wal.empty.skydrop': ['Top up the wallet to get started.', 'শুরু করতে ওয়ালেট টপ-আপ করুন।'],
  'wal.empty.seller': ['{seller} tops it up for you.', '{seller} আপনার হয়ে এটি টপ-আপ করে।'],

  'wal.topup.title': ['Top up', 'টপ-আপ'],
  'wal.topup.sub': [
    'Send money to one of Skydrop’s accounts, then tell us here. Nothing is credited until we see it on our statement.',
    'Skydrop-এর কোনো একটি অ্যাকাউন্টে টাকা পাঠান, তারপর এখানে আমাদের জানান। আমাদের স্টেটমেন্টে না দেখা পর্যন্ত কিছুই জমা হয় না।',
  ],
  'wal.topup.paidInto': ['Paid into', 'যে অ্যাকাউন্টে দিয়েছেন'],
  'wal.topup.chooseAccount': [
    'Choose the account you paid into',
    'যে অ্যাকাউন্টে টাকা দিয়েছেন সেটি বেছে নিন',
  ],
  'wal.topup.amount': ['Amount (₹)', 'পরিমাণ (₹)'],
  'wal.topup.ifsc': [' · IFSC ', ' · IFSC '],
  'wal.topup.ref': ['Bank reference / UTR', 'ব্যাংক রেফারেন্স / UTR'],
  'wal.topup.refHint': [
    'This, or a receipt below — one of the two.',
    'এটি, অথবা নিচের একটি রসিদ — দুটির একটি দিন।',
  ],
  'wal.topup.receipt': ['Receipt (optional)', 'রসিদ (ঐচ্ছিক)'],
  'wal.topup.receiptHint': ['JPEG, PNG, WEBP or PDF.', 'JPEG, PNG, WEBP বা PDF।'],
  'wal.topup.chooseFile': ['Choose a file', 'ফাইল বেছে নিন'],
  'wal.topup.tell': ['Tell Skydrop', 'Skydrop-কে জানান'],
  'wal.topup.sending': ['Sending…', 'পাঠানো হচ্ছে…'],
  'wal.topup.toast': [
    'Sent to Skydrop. Your wallet is credited once they see the money arrive.',
    'Skydrop-কে পাঠানো হয়েছে। টাকা এসেছে দেখলে তবেই আপনার ওয়ালেটে জমা হবে।',
  ],
  'wal.topup.confirmTitle': [
    'Tell Skydrop you paid {amount}?',
    'Skydrop-কে জানাবেন যে আপনি {amount} দিয়েছেন?',
  ],
  'wal.topup.accountFallback': ['The account you chose', 'আপনার বেছে নেওয়া অ্যাকাউন্ট'],
  'wal.topup.consequence': [
    'Nothing is credited until Skydrop sees the money on their statement.',
    'Skydrop তাদের স্টেটমেন্টে টাকা না দেখা পর্যন্ত কিছুই জমা হয় না।',
  ],
  'wal.topup.consequenceRef': [
    'Reference {ref}. Nothing is credited until Skydrop sees the money on their statement.',
    'রেফারেন্স {ref}। Skydrop তাদের স্টেটমেন্টে টাকা না দেখা পর্যন্ত কিছুই জমা হয় না।',
  ],

  'wal.req.topups': ['Top-ups you told us about', 'আপনার জানানো টপ-আপ'],
  'wal.req.topupsLoading': ['Loading top-ups', 'টপ-আপ লোড হচ্ছে'],
  'wal.req.none': ['None yet', 'এখনও কিছু নেই'],
  'wal.req.noneTopups': [
    'Use Top up above once you have sent money.',
    'টাকা পাঠানোর পর উপরের টপ-আপ ব্যবহার করুন।',
  ],
  'wal.req.col.told': ['Told us', 'জানিয়েছেন'],
  'wal.req.col.paidInto': ['Paid into', 'যেখানে দিয়েছেন'],
  'wal.req.col.amount': ['Amount', 'পরিমাণ'],
  'wal.req.col.reference': ['Reference', 'রেফারেন্স'],
  'wal.req.col.state': ['State', 'অবস্থা'],
  'wal.req.viewReceipt': ['View receipt', 'রসিদ দেখুন'],
  'wal.req.state.PENDING': ['Waiting for Skydrop to see it', 'Skydrop দেখার অপেক্ষায়'],
  'wal.req.state.ACCEPTED': ['Credited', 'জমা হয়েছে'],
  'wal.req.state.REJECTED': ['Not credited', 'জমা হয়নি'],
  'wal.req.withdrawals': ['Withdrawals you asked for', 'আপনার অনুরোধ করা উত্তোলন'],
  'wal.req.withdrawalsLoading': ['Loading withdrawals', 'উত্তোলন লোড হচ্ছে'],
  'wal.req.wcol.asked': ['Asked', 'অনুরোধ'],
  'wal.req.wcol.to': ['To', 'যাকে'],

  'walwd.title': ['Withdraw', 'উত্তোলন'],
  'walwd.sub.plain': [
    'Ask Skydrop to pay out your balance.',
    'Skydrop-কে আপনার ব্যালেন্স পরিশোধ করতে বলুন।',
  ],
  'walwd.sub.upTo': [
    'Ask Skydrop to pay out up to {amount}. Nothing leaves the wallet until they pay it.',
    'Skydrop-কে সর্বোচ্চ {amount} পরিশোধ করতে বলুন। তারা পরিশোধ না করা পর্যন্ত ওয়ালেট থেকে কিছুই বেরোয় না।',
  ],
  'walwd.amount': ['Amount (₹)', 'পরিমাণ (₹)'],
  'walwd.payee': ['Name on the account', 'অ্যাকাউন্টে নাম'],
  'walwd.account': ['Account number', 'অ্যাকাউন্ট নম্বর'],
  'walwd.bank': ['Bank', 'ব্যাংক'],
  'walwd.note': ['Note (optional)', 'নোট (ঐচ্ছিক)'],
  'walwd.ask': ['Ask to withdraw', 'উত্তোলনের অনুরোধ করুন'],
  'walwd.asking': ['Asking…', 'অনুরোধ হচ্ছে…'],
  'walwd.toast': [
    'Asked. Skydrop pays it and the wallet shows it when they do.',
    'অনুরোধ করা হয়েছে। Skydrop পরিশোধ করলে ওয়ালেটে তা দেখা যাবে।',
  ],
  'walwd.confirmTitle': [
    'Ask Skydrop to pay {amount} to {payee} · {account}?',
    'Skydrop-কে {payee} · {account}-কে {amount} পরিশোধ করতে বলবেন?',
  ],
  'walwd.consequence': [
    '{bank} · IFSC {ifsc}. Check the account number — money sent to the wrong one is very hard to get back.',
    '{bank} · IFSC {ifsc}। অ্যাকাউন্ট নম্বরটি যাচাই করুন — ভুল অ্যাকাউন্টে গেলে টাকা ফেরত পাওয়া খুব কঠিন।',
  ],

  'walled.title': ['Every movement', 'প্রতিটি লেনদেন'],
  'walled.note': ['Newest first.', 'নতুনটি আগে।'],
  'walled.loading': ['Loading the ledger', 'খতিয়ান লোড হচ্ছে'],
  'walled.empty': ['Nothing has moved yet', 'এখনও কিছুই নড়েনি'],
  'walled.caption': ['Wallet ledger', 'ওয়ালেটের খতিয়ান'],
  'walled.col.when': ['When', 'কখন'],
  'walled.col.what': ['What', 'কী'],
  'walled.col.amount': ['Amount', 'পরিমাণ'],
  'walled.col.balance': ['Balance after', 'পরের ব্যালেন্স'],
  'walled.seeOrder': ['See the order', 'অর্ডারটি দেখুন'],
  'walled.showingLatest': [
    'Showing the latest {n} movements.',
    'সর্বশেষ {n}টি লেনদেন দেখানো হচ্ছে।',
  ],
  'walled.showingAll': ['Showing all {n} movements.', 'মোট {n}টি লেনদেনই দেখানো হচ্ছে।'],
  'walled.older': ['Show older', 'পুরোনো দেখুন'],
  'walled.olderLoading': ['Loading…', 'লোড হচ্ছে…'],
});
