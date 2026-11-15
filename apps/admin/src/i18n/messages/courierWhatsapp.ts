import { defineMessages } from '../define';

/**
 * The courier's WhatsApp messages to the customer (order page, Activity area).
 */
export const courierWhatsapp = defineMessages({
  'courierWhatsapp.title': [
    'WhatsApp messages from the courier',
    'কুরিয়ারের পাঠানো হোয়াটসঅ্যাপ বার্তা',
    'कूरियर के भेजे व्हाट्सऐप संदेश',
  ],
  'courierWhatsapp.note': [
    "What the courier sent your customer on WhatsApp, copied from the courier's own screen. It can be a little behind.",
    'কুরিয়ার আপনার গ্রাহককে হোয়াটসঅ্যাপে যা পাঠিয়েছে, তাদের নিজেদের স্ক্রিন থেকে নেওয়া। একটু দেরিতে আসতে পারে।',
    'कूरियर ने आपके ग्राहक को व्हाट्सऐप पर जो भेजा, उनकी अपनी स्क्रीन से लिया गया। थोड़ी देर से आ सकता है।',
  ],
  'courierWhatsapp.checked': [
    'Last checked {when}',
    'সর্বশেষ দেখা হয়েছে {when}',
    'आखिरी बार देखा गया {when}',
  ],
  'courierWhatsapp.refresh': [
    'Refresh WhatsApp messages',
    'হোয়াটসঅ্যাপ বার্তা আবার আনুন',
    'व्हाट्सऐप संदेश दोबारा लाएँ',
  ],
  'courierWhatsapp.refreshing': [
    "Asking the courier's screen…",
    'কুরিয়ারের স্ক্রিনে জিজ্ঞেস করা হচ্ছে…',
    'कूरियर की स्क्रीन से पूछा जा रहा है…',
  ],
  'courierWhatsapp.queued': [
    'Asked again. New messages show up within a few minutes.',
    'আবার জিজ্ঞেস করা হয়েছে। নতুন বার্তা কয়েক মিনিটের মধ্যে আসবে।',
    'दोबारा पूछा गया है। नए संदेश कुछ मिनट में दिखेंगे।',
  ],
  'courierWhatsapp.tooSoon': [
    'Checked a moment ago. Try again in a couple of minutes.',
    'একটু আগেই দেখা হয়েছে। কয়েক মিনিট পরে আবার চেষ্টা করুন।',
    'अभी-अभी देखा गया था। कुछ मिनट बाद फिर कोशिश करें।',
  ],
  'courierWhatsapp.off': [
    'Reading these is switched off.',
    'এই বার্তা আনা এখন বন্ধ আছে।',
    'इन्हें लाना अभी बंद है।',
  ],
});
