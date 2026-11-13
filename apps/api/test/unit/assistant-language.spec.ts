/**
 * The bot's own fixed notices ("something went wrong", "resting", the
 * refusal) follow the person's language — all five the owner named:
 * English, Bangla, Hindi, Banglish, Hinglish. Before 2026-11-13 Banglish
 * and Hinglish fell to English.
 */
import {
  detectReplyLanguage,
  helpLinks,
  noticeText,
  type NoticeCode,
  type ReplyLanguage,
} from '../../src/modules/assistant/assistant-language';

describe('detectReplyLanguage', () => {
  it.each<[string, ReplyLanguage]>([
    ['How do I find a parcel by its AWB number?', 'en'],
    ['AWB নম্বর দিয়ে একটা পার্সেল কিভাবে খুঁজব?', 'bn'],
    ['AWB number diye parcel kivabe khujbo?', 'bnLatn'],
    ['AWB नंबर से पार्सल कैसे ढूंढें?', 'hi'],
    ['AWB number se parcel kaise dhundhe?', 'hiLatn'],
    ['tmi k?', 'en'],
    ['parcel kivbe book korbo?', 'bnLatn'],
    ['mera paisa kab milega?', 'hiLatn'],
    ['amar taka kobe pabo?', 'bnLatn'],
    ['Explain my balance', 'en'],
  ])('%s → %s', (text, lang) => {
    expect(detectReplyLanguage(text)).toBe(lang);
  });

  it('script wins over Latin words in the same message', () => {
    expect(detectReplyLanguage('kivabe করব?')).toBe('bn');
    expect(detectReplyLanguage('kaise करें?')).toBe('hi');
  });
});

/** Devanagari (U+0900–097F) or Bangla (U+0980–09FF) anywhere in the text. */
const indicScript = (text: string): boolean =>
  [...text].some((ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    return cp >= 0x0900 && cp <= 0x09ff;
  });

describe('every fixed notice exists in all five languages', () => {
  const codes: NoticeCode[] = [
    'DISABLED',
    'NOT_CONFIGURED',
    'RESTING_BUDGET',
    'RESTING_DAILY',
    'REFUSED',
    'TRUNCATED',
    'ATTACHMENTS_TOO_LARGE',
    'ATTACHMENT_UNAVAILABLE',
    'FAILED',
  ];
  const langs: ReplyLanguage[] = ['en', 'bn', 'hi', 'bnLatn', 'hiLatn'];

  it.each(codes)('%s', (code) => {
    const texts = langs.map((l) => noticeText(code, l));
    for (const t of texts) expect(t.trim().length).toBeGreaterThan(0);
    // Banglish and Hinglish are their own words, not the English copy.
    expect(noticeText(code, 'bnLatn')).not.toBe(noticeText(code, 'en'));
    expect(noticeText(code, 'hiLatn')).not.toBe(noticeText(code, 'en'));
    // and written in Latin letters, never Bangla or Devanagari script
    expect(indicScript(noticeText(code, 'bnLatn'))).toBe(false);
    expect(indicScript(noticeText(code, 'hiLatn'))).toBe(false);
  });

  it('help links carry a label in every language', () => {
    for (const l of langs) {
      for (const link of helpLinks('STAFF', l)) expect(link.label.trim()).not.toBe('');
    }
  });
});
