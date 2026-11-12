import type { AssistantAudience } from '@skydrop/db';

export type ReplyLanguage = 'en' | 'bn' | 'hi';

/**
 * Which script the person wrote in. Banglish and Hinglish are Latin
 * script and fall to English here — the fixed notices below are the only
 * text this decides (everything else the model writes itself, in the
 * user's own language and script).
 */
export function detectReplyLanguage(text: string): ReplyLanguage {
  if (/[ঀ-৿]/.test(text)) return 'bn';
  if (/[ऀ-ॿ]/.test(text)) return 'hi';
  return 'en';
}

export type NoticeCode =
  | 'DISABLED'
  | 'NOT_CONFIGURED'
  | 'RESTING_BUDGET'
  | 'RESTING_DAILY'
  | 'REFUSED'
  | 'TRUNCATED'
  | 'FAILED';

const TEXT: Record<NoticeCode, Record<ReplyLanguage, string>> = {
  DISABLED: {
    en: 'The assistant is resting right now. Please use the help links below.',
    bn: 'অ্যাসিস্ট্যান্ট এখন বিশ্রামে আছে। নিচের হেল্প লিঙ্কগুলো ব্যবহার করুন।',
    hi: 'असिस्टेंट अभी आराम कर रहा है। कृपया नीचे दिए गए हेल्प लिंक देखें।',
  },
  NOT_CONFIGURED: {
    en: 'The assistant is not configured yet. Please use the help links below.',
    bn: 'অ্যাসিস্ট্যান্ট এখনও চালু করা হয়নি। নিচের হেল্প লিঙ্কগুলো ব্যবহার করুন।',
    hi: 'असिस्टेंट अभी सेट नहीं है। कृपया नीचे दिए गए हेल्प लिंक देखें।',
  },
  RESTING_BUDGET: {
    en: 'The assistant is resting for now. Please use the help links below.',
    bn: 'অ্যাসিস্ট্যান্ট এখন বিশ্রামে আছে। নিচের হেল্প লিঙ্কগুলো ব্যবহার করুন।',
    hi: 'असिस्टेंट अभी आराम कर रहा है। कृपया नीचे दिए गए हेल्प लिंक देखें।',
  },
  RESTING_DAILY: {
    en: 'You have used all your assistant questions for today. They come back tomorrow. Please use the help links below until then.',
    bn: 'আজকের জন্য অ্যাসিস্ট্যান্টের সব প্রশ্ন শেষ হয়েছে। কাল আবার পাবেন। তার মধ্যে নিচের হেল্প লিঙ্কগুলো ব্যবহার করুন।',
    hi: 'आज के लिए असिस्टेंट के सारे सवाल पूरे हो गए। कल फिर मिलेंगे। तब तक नीचे दिए गए हेल्प लिंक देखें।',
  },
  REFUSED: {
    en: "I can't help with that one.",
    bn: 'এই বিষয়ে আমি সাহায্য করতে পারছি না।',
    hi: 'इस बारे में मैं मदद नहीं कर सकता।',
  },
  TRUNCATED: {
    en: 'That answer got too long. Please ask a shorter or narrower question.',
    bn: 'উত্তরটি অনেক লম্বা হয়ে গেছে। ছোট বা নির্দিষ্ট করে প্রশ্ন করুন।',
    hi: 'जवाब बहुत लंबा हो गया। कृपया छोटा या सीधा सवाल पूछें।',
  },
  FAILED: {
    en: 'Something went wrong on my side. Please try again in a moment.',
    bn: 'আমার দিকে একটা সমস্যা হয়েছে। একটু পরে আবার চেষ্টা করুন।',
    hi: 'मेरी तरफ से कुछ गड़बड़ हो गई। थोड़ी देर में फिर कोशिश करें।',
  },
};

export function noticeText(code: NoticeCode, lang: ReplyLanguage): string {
  return TEXT[code][lang];
}

const LINK_LABEL: Record<ReplyLanguage, string> = {
  en: 'Support tickets',
  bn: 'সাপোর্ট টিকিট',
  hi: 'सपोर्ट टिकट',
};
const ISSUES_LABEL: Record<ReplyLanguage, string> = {
  en: 'System issues',
  bn: 'সিস্টেম সমস্যা',
  hi: 'सिस्टम समस्याएँ',
};

/** Paths that exist in each console (each console's authed tickets page; admin also system-issues). */
export function helpLinks(
  audience: AssistantAudience,
  lang: ReplyLanguage,
): ReadonlyArray<{ label: string; path: string }> {
  if (audience === 'STAFF') {
    return [
      { label: LINK_LABEL[lang], path: '/tickets' },
      { label: ISSUES_LABEL[lang], path: '/system-issues' },
    ];
  }
  return [{ label: LINK_LABEL[lang], path: '/tickets' }];
}
