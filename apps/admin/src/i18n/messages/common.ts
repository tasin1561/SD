import { defineMessages } from '../define';

/** Words every screen shares. Screen-specific copy lives in that screen's namespace. */
export const common = defineMessages({
  'common.email': ['Email', 'ইমেইল'],
  'common.password': ['Password', 'পাসওয়ার্ড'],
  'common.loading': ['Loading…', 'লোড হচ্ছে…'],
  'common.retry': ['Retry', 'আবার চেষ্টা করুন'],
  'common.tryAgain': ['Try again', 'আবার চেষ্টা করুন'],
  'common.cancel': ['Cancel', 'বাতিল'],
  'common.back': ['Back', 'ফিরে যান'],
  'common.yes': ['Yes', 'হ্যাঁ'],
  'common.no': ['No', 'না'],
  'common.all': ['All', 'সব'],
  'common.search': ['Search', 'খুঁজুন'],
  'common.save': ['Save', 'সংরক্ষণ করুন'],
  'common.saving': ['Saving…', 'সংরক্ষণ হচ্ছে…'],
  'common.requestFailed': ['Request failed.', 'অনুরোধ ব্যর্থ হয়েছে।'],
  'common.unreachable': [
    'Skydrop could not be reached just now ({status}). Nothing was changed — try again in a moment.',
    'এই মুহূর্তে Skydrop-এ পৌঁছানো যায়নি ({status})। কিছুই বদলায়নি — একটু পরে আবার চেষ্টা করুন।',
  ],
  // Plural suffixes. English builds "issue" + "s"; Bangla has no plural suffix, so its half is
  // empty ON PURPOSE (the catalogue spec exempts exactly these keys from the non-empty rule).
  'common.pluralS': ['s', ''],
  'common.pluralEs': ['es', ''],
});
