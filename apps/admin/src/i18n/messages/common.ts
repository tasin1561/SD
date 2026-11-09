import { defineMessages } from '../define';

/** Words every screen shares. Screen-specific copy lives in that screen's namespace. */
export const common = defineMessages({
  'common.email': ['Email', 'ইমেইল', 'ईमेल'],
  'common.password': ['Password', 'পাসওয়ার্ড', 'पासवर्ड'],
  'common.loading': ['Loading…', 'লোড হচ্ছে…', 'लोड हो रहा है…'],
  'common.retry': ['Retry', 'আবার চেষ্টা করুন', 'फिर कोशिश करें'],
  'common.tryAgain': ['Try again', 'আবার চেষ্টা করুন', 'फिर कोशिश करें'],
  'common.cancel': ['Cancel', 'বাতিল', 'रद्द करें'],
  'common.back': ['Back', 'ফিরে যান', 'वापस'],
  'common.yes': ['Yes', 'হ্যাঁ', 'हाँ'],
  'common.no': ['No', 'না', 'नहीं'],
  'common.all': ['All', 'সব', 'सभी'],
  'common.search': ['Search', 'খুঁজুন', 'खोजें'],
  'common.save': ['Save', 'সংরক্ষণ করুন', 'सेव करें'],
  'common.saving': ['Saving…', 'সংরক্ষণ হচ্ছে…', 'सेव हो रहा है…'],
  'common.requestFailed': ['Request failed.', 'অনুরোধ ব্যর্থ হয়েছে।', 'रिक्वेस्ट नाकाम रही।'],
  'common.unreachable': [
    'Skydrop could not be reached just now ({status}). Nothing was changed — try again in a moment.',
    'এই মুহূর্তে Skydrop-এ পৌঁছানো যায়নি ({status})। কিছুই বদলায়নি — একটু পরে আবার চেষ্টা করুন।',
    'इस वक़्त Skydrop तक नहीं पहुँचा जा सका ({status})। कुछ भी नहीं बदला — ज़रा देर में फिर कोशिश करें।',
  ],
  // Shared "filter by client" control (the UI word is Client; the code word is seller).
  'clientFilter.label': ['Client', 'ক্লায়েন্ট', 'क्लाइंट'],
  'clientFilter.aria': [
    'Filter by client',
    'ক্লায়েন্ট দিয়ে ফিল্টার করুন',
    'क्लाइंट से फ़िल्टर करें',
  ],
  'clientFilter.all': ['All clients', 'সব ক্লায়েন্ট', 'सभी क्लाइंट'],
  'clientFilter.this': ['This client', 'এই ক্লায়েন্ট', 'यह क्लाइंट'],
  // Plural suffixes. English builds "issue" + "s"; neither Bangla nor Hindi has a plural
  // suffix, so both halves are empty ON PURPOSE (the catalogue spec exempts exactly these
  // keys from the non-empty rule).
  'common.pluralS': ['s', '', ''],
  'common.pluralEs': ['es', '', ''],
});
