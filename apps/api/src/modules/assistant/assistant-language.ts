import type { AssistantAudience } from '@skydrop/db';

/** `bnLatn` = Banglish, `hiLatn` = Hinglish (Bangla / Hindi in English letters). */
export type ReplyLanguage = 'en' | 'bn' | 'hi' | 'bnLatn' | 'hiLatn';

/**
 * Words that only show up in Banglish or only in Hinglish. Deliberately
 * leaves out words both share or English shares ("ki", "na", "se", "to").
 */
const BANGLISH = new Set(
  (
    'ami amar amake apni apnar apnake tumi tomar kivabe kibhabe kivbe keno kothay kobe ' +
    'korbo korte korchi korun kori hobe hoy hoyeche hoyni ache achhe nai nei ekta eta ' +
    'ota diye theke jonno khujbo khuji pabo pacchi dekhbo dekhte bolen bolun parbo parchi ' +
    'taka kmn kemon bhai vai'
  ).split(' '),
);
const HINGLISH = new Set(
  (
    'kaise kaisa kya kyun kyu kahan kab hai hain mera meri mere mujhe aap aapka aapki ' +
    'nahi nahin karna karu karun karein kariye chahiye dhundhe dhundhu dhoondhe milega ' +
    'kitna kitne hoga bhaiya paisa batao bataiye raha rahi'
  ).split(' '),
);

/**
 * Which language the bot's own fixed notices should use. Script first
 * (Bangla, Devanagari); then, for Latin text, Banglish or Hinglish when
 * the person used words only that one uses. Everything else the model
 * writes itself, in the person's own language and script.
 */
export function detectReplyLanguage(text: string): ReplyLanguage {
  if (/[ঀ-৿]/.test(text)) return 'bn';
  if (/[ऀ-ॿ]/.test(text)) return 'hi';
  let bn = 0;
  let hi = 0;
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (BANGLISH.has(word)) bn++;
    if (HINGLISH.has(word)) hi++;
  }
  if (bn > hi) return 'bnLatn';
  if (hi > bn) return 'hiLatn';
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
    bnLatn: 'Assistant ekhon bishrame ache. Nicher help link gulo use korun.',
    hiLatn: 'Assistant abhi aaram kar raha hai. Neeche diye gaye help links dekhiye.',
  },
  NOT_CONFIGURED: {
    en: 'The assistant is not configured yet. Please use the help links below.',
    bn: 'অ্যাসিস্ট্যান্ট এখনও চালু করা হয়নি। নিচের হেল্প লিঙ্কগুলো ব্যবহার করুন।',
    hi: 'असिस्टेंट अभी सेट नहीं है। कृपया नीचे दिए गए हेल्प लिंक देखें।',
    bnLatn: 'Assistant ekhono chalu kora hoyni. Nicher help link gulo use korun.',
    hiLatn: 'Assistant abhi set nahi hai. Neeche diye gaye help links dekhiye.',
  },
  RESTING_BUDGET: {
    en: 'The assistant is resting for now. Please use the help links below.',
    bn: 'অ্যাসিস্ট্যান্ট এখন বিশ্রামে আছে। নিচের হেল্প লিঙ্কগুলো ব্যবহার করুন।',
    hi: 'असिस्टेंट अभी आराम कर रहा है। कृपया नीचे दिए गए हेल्प लिंक देखें।',
    bnLatn: 'Assistant ekhon bishrame ache. Nicher help link gulo use korun.',
    hiLatn: 'Assistant abhi aaram kar raha hai. Neeche diye gaye help links dekhiye.',
  },
  RESTING_DAILY: {
    en: 'You have used all your assistant questions for today. They come back tomorrow. Please use the help links below until then.',
    bn: 'আজকের জন্য অ্যাসিস্ট্যান্টের সব প্রশ্ন শেষ হয়েছে। কাল আবার পাবেন। তার মধ্যে নিচের হেল্প লিঙ্কগুলো ব্যবহার করুন।',
    hi: 'आज के लिए असिस्टेंट के सारे सवाल पूरे हो गए। कल फिर मिलेंगे। तब तक नीचे दिए गए हेल्प लिंक देखें।',
    bnLatn:
      'Ajker jonno assistant er sob proshno shesh. Kal abar paben. Tar age nicher help link gulo use korun.',
    hiLatn:
      'Aaj ke liye assistant ke saare sawaal khatam ho gaye. Kal phir milenge. Tab tak neeche diye gaye help links dekhiye.',
  },
  REFUSED: {
    en: "I can't help with that one.",
    bn: 'এই বিষয়ে আমি সাহায্য করতে পারছি না।',
    hi: 'इस बारे में मैं मदद नहीं कर सकता।',
    bnLatn: 'Ei bishoye ami shahajjo korte parchi na.',
    hiLatn: 'Is baare mein main madad nahi kar sakta.',
  },
  TRUNCATED: {
    en: 'That answer got too long. Please ask a shorter or narrower question.',
    bn: 'উত্তরটি অনেক লম্বা হয়ে গেছে। ছোট বা নির্দিষ্ট করে প্রশ্ন করুন।',
    hi: 'जवाब बहुत लंबा हो गया। कृपया छोटा या सीधा सवाल पूछें।',
    bnLatn: 'Uttor ta onek lomba hoye geche. Chhoto ba nirdishto kore proshno korun.',
    hiLatn: 'Jawab bahut lamba ho gaya. Chhota ya seedha sawaal poochiye.',
  },
  FAILED: {
    en: 'Something went wrong on my side. Please try again in a moment.',
    bn: 'আমার দিকে একটা সমস্যা হয়েছে। একটু পরে আবার চেষ্টা করুন।',
    hi: 'मेरी तरफ से कुछ गड़बड़ हो गई। थोड़ी देर में फिर कोशिश करें।',
    bnLatn: 'Amar dike ekta shomossha hoyeche. Ektu pore abar cheshta korun.',
    hiLatn: 'Meri taraf se kuch gadbad ho gayi. Thodi der mein phir koshish kariye.',
  },
};

export function noticeText(code: NoticeCode, lang: ReplyLanguage): string {
  return TEXT[code][lang];
}

const LINK_LABEL: Record<ReplyLanguage, string> = {
  en: 'Support tickets',
  bn: 'সাপোর্ট টিকিট',
  hi: 'सपोर्ट टिकट',
  bnLatn: 'Support ticket',
  hiLatn: 'Support ticket',
};
const ISSUES_LABEL: Record<ReplyLanguage, string> = {
  en: 'System issues',
  bn: 'সিস্টেম সমস্যা',
  hi: 'सिस्टम समस्याएँ',
  bnLatn: 'System shomossha',
  hiLatn: 'System samasya',
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
