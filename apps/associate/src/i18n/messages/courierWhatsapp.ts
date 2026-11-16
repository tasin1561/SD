import { defineMessages } from '../define';

/**
 * The courier's WhatsApp messages to the customer (order page, Activity area).
 */
export const courierWhatsapp = defineMessages({
  'courierWhatsapp.title': [
    'WhatsApp messages from the courier',
    'কুরিয়ারের পাঠানো হোয়াটসঅ্যাপ বার্তা',
  ],
  'courierWhatsapp.note': [
    "What the courier sent your customer on WhatsApp, copied from the courier's own screen. It can be a little behind.",
    'কুরিয়ার আপনার গ্রাহককে হোয়াটসঅ্যাপে যা পাঠিয়েছে, তাদের নিজেদের স্ক্রিন থেকে নেওয়া। একটু দেরিতে আসতে পারে।',
  ],
  'courierWhatsapp.checked': ['Last checked {when}', 'সর্বশেষ দেখা হয়েছে {when}'],
  'courierWhatsapp.refresh': ['Refresh WhatsApp messages', 'হোয়াটসঅ্যাপ বার্তা আবার আনুন'],
  'courierWhatsapp.refreshing': [
    "Asking the courier's screen…",
    'কুরিয়ারের স্ক্রিনে জিজ্ঞেস করা হচ্ছে…',
  ],
  'courierWhatsapp.queued': [
    'Asked again. New messages show up within a few minutes.',
    'আবার জিজ্ঞেস করা হয়েছে। নতুন বার্তা কয়েক মিনিটের মধ্যে আসবে।',
  ],
  'courierWhatsapp.tooSoon': [
    'Checked a moment ago. Try again in a couple of minutes.',
    'একটু আগেই দেখা হয়েছে। কয়েক মিনিট পরে আবার চেষ্টা করুন।',
  ],
  'courierWhatsapp.off': ['Reading these is switched off.', 'এই বার্তা আনা এখন বন্ধ আছে।'],
  'courierWhatsapp.checking': ['Checking for new messages…', 'নতুন বার্তা দেখা হচ্ছে…'],
  'courierWhatsapp.paused': [
    'WhatsApp check paused — showing messages up to {when}',
    'হোয়াটসঅ্যাপ দেখা সাময়িক বন্ধ — {when} পর্যন্ত বার্তা দেখানো হচ্ছে',
  ],
  'courierWhatsapp.closed': [
    'Conversation closed — Delhivery no longer shows it. This is our saved copy.',
    'কথোপকথন বন্ধ — Delhivery আর এটি দেখাচ্ছে না। এটি আমাদের সংরক্ষিত কপি।',
  ],
});
