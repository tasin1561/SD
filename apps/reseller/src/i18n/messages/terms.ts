import { defineMessages } from '../define';

/**
 * The store's terms (`/terms`) and the banner that shows while they are
 * unaccepted. The fee sentences, examples and the seller's note arrive from
 * the server already written, and stay as the server wrote them.
 */
export const terms = defineMessages({
  'terms.title': ['Terms', 'শর্তাবলী'],
  'terms.subtitle.loading': [
    'Who pays which Skydrop fee on your orders, and when you and your client are paid.',
    'আপনার অর্ডারে কোন Skydrop ফি কে দেবে, এবং আপনি ও আপনার ক্লায়েন্ট কখন টাকা পাবেন।',
  ],
  'terms.loading': ['Loading the terms', 'শর্তাবলী লোড হচ্ছে'],
  'terms.subtitle': [
    'What {seller} and {store} have agreed about Skydrop’s fees and when each of you is paid.',
    'Skydrop-এর ফি এবং আপনাদের প্রত্যেকে কখন টাকা পাবেন, সে বিষয়ে {seller} ও {store} যা সম্মত হয়েছে।',
  ],
  'terms.none.title': ['No terms yet', 'এখনও কোনো শর্তাবলী নেই'],
  'terms.none.body': [
    '{seller} has not published terms for your store. You can place orders once they have, and you have accepted them.',
    '{seller} আপনার স্টোরের জন্য শর্তাবলী প্রকাশ করেনি। তারা প্রকাশ করলে এবং আপনি সেগুলো গ্রহণ করলে তবেই অর্ডার দিতে পারবেন।',
  ],
  'terms.accepted.toast': ['Version {version} accepted.', 'সংস্করণ {version} গৃহীত হয়েছে।'],
  'terms.version': ['Version {version}', 'সংস্করণ {version}'],
  'terms.sub.notAccepted': [
    'Published by {seller} on {when} — not accepted yet. Your store cannot place new orders until it is.',
    '{seller} {when} তারিখে প্রকাশ করেছে — এখনও গৃহীত হয়নি। গৃহীত না হওয়া পর্যন্ত আপনার স্টোর নতুন অর্ডার দিতে পারবে না।',
  ],
  'terms.sub.accepted': ['Accepted by {name} on {when}.', '{name} {when} তারিখে গ্রহণ করেছেন।'],
  'terms.chip.notAccepted': ['Not accepted yet', 'এখনও গৃহীত হয়নি'],
  'terms.chip.accepted': ['Accepted', 'গৃহীত'],
  'terms.block.fees': ['Who pays which fee', 'কোন ফি কে দেবে'],
  'terms.block.credit': ['When each of you is credited', 'আপনাদের প্রত্যেকের টাকা কখন জমা হয়'],
  'terms.says': ['{seller} says:', '{seller} বলছে:'],
  'terms.examples.caption': [
    'What each fee would cost, for example',
    'উদাহরণস্বরূপ, প্রতিটি ফিতে কত খরচ হবে',
  ],
  'terms.col.fee': ['Fee', 'ফি'],
  'terms.col.example': ['For example', 'উদাহরণ'],
  'terms.col.youPay': ['You pay', 'আপনি দেবেন'],
  'terms.col.sellerPays': ['{seller} pays', '{seller} দেবে'],
  'terms.acceptVersion': ['Accept version {version}', 'সংস্করণ {version} গ্রহণ করুন'],
  'terms.needsAdmin': [
    'Somebody at your store who may accept terms (an owner or admin) needs to accept this version.',
    'আপনার স্টোরের যিনি শর্তাবলী গ্রহণ করতে পারেন (মালিক বা অ্যাডমিন) তাঁকে এই সংস্করণটি গ্রহণ করতে হবে।',
  ],
  'terms.confirm.title': [
    'Accept version {version} for {store}?',
    '{store}-এর জন্য সংস্করণ {version} গ্রহণ করবেন?',
  ],
  'terms.confirm.entity': [
    '{store} · version {version} from {seller}',
    '{store} · {seller}-এর সংস্করণ {version}',
  ],
  'terms.confirm.consequence': [
    'Every order your store places from now on is priced and paid under these terms. Your name, the time and where you accepted from are recorded.',
    'এখন থেকে আপনার স্টোরের দেওয়া প্রতিটি অর্ডারের দাম ও পরিশোধ এই শর্তাবলী অনুযায়ী হবে। আপনার নাম, সময় এবং কোথা থেকে গ্রহণ করেছেন তা নথিভুক্ত হয়।',
  ],
  'terms.confirm.accept': ['Accept', 'গ্রহণ করুন'],
  'terms.history.title': ['Every version', 'প্রতিটি সংস্করণ'],
  'terms.history.note': [
    'Newest first. A version is never changed once published.',
    'নতুনটি আগে। প্রকাশের পর কোনো সংস্করণ কখনও বদলানো হয় না।',
  ],
  'terms.history.empty': ['Nothing yet', 'এখনও কিছু নেই'],
  'terms.history.col.version': ['Version', 'সংস্করণ'],
  'terms.history.col.published': ['Published', 'প্রকাশিত'],
  'terms.history.col.accepted': ['Accepted', 'গৃহীত'],

  'termsbar.none': [
    '{seller} has not published terms for your store yet. You can place orders once they have and you have accepted them.',
    '{seller} এখনও আপনার স্টোরের জন্য শর্তাবলী প্রকাশ করেনি। তারা প্রকাশ করলে এবং আপনি সেগুলো গ্রহণ করলে তবেই অর্ডার দিতে পারবেন।',
  ],
  'termsbar.unaccepted': [
    '{seller} published version {version} of your terms. Your store cannot place new orders until it is accepted.',
    '{seller} আপনার শর্তাবলীর সংস্করণ {version} প্রকাশ করেছে। গৃহীত না হওয়া পর্যন্ত আপনার স্টোর নতুন অর্ডার দিতে পারবে না।',
  ],
  'termsbar.read': ['Read the terms', 'শর্তাবলী পড়ুন'],
});
