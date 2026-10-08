/**
 * The three languages the tutorials are published in, and the ONE place
 * that says which voice and which model each uses.
 *
 * ── WHY THE MODEL IS PER LANGUAGE AND NOT ONE CONSTANT ──────────────
 * Measured against this account on 2026-10-08, not assumed:
 *
 *     eleven_multilingual_v2 — 29 languages, hi YES, bn NO
 *     eleven_v3              — 74 languages, hi YES, bn YES
 *     eleven_v4              — 85 languages, hi YES, bn YES
 *
 * So Bangla cannot be spoken by the model the first 87 videos were made
 * with. The tempting fix is to move everything to v3 — and it would
 * silently re-bill every one of them: `fingerprint()` hashes the MODEL
 * into the cache key, so changing it globally invalidates ~199,000
 * characters of audio that has already been paid for, with no visible
 * error. English therefore STAYS on multilingual_v2 for ever, and only
 * the new languages take the new model.
 *
 * ── THE VOICE IS PER LANGUAGE FOR A PLAINER REASON ──────────────────
 * One English voice reading Bangla is an English voice reading Bangla.
 * A seller in Dhaka hears that immediately, and it is the first thing
 * they will judge the product by.
 *
 * ── THE GENDERS DO NOT MATCH, AND THAT IS A DECISION ────────────────
 * English is Sarah (female); Bangla and Hindi are male (owner's choice,
 * 2026-10-08, asked and confirmed). A brand would normally hold one
 * gender across its languages, so the mismatch is written down here
 * rather than left to look like an oversight.
 *
 * English is NOT changed to match, and must not be casually: Sarah is
 * the cached voice of 87 finished videos and ~199,000 characters of
 * paid-for audio. Moving her re-bills all of it and orphans every film —
 * that is a deliberate, expensive decision, never a tidy-up.
 */

/** English keeps the voice and model every existing clip was made with. */
export const LANGUAGES = {
  en: {
    code: 'en',
    label: 'English',
    model: 'eleven_multilingual_v2',
    voice: 'EXAVITQu4vr4xnSDxMaL',
    /** The narration field this language reads. */
    field: 'say',
    /** What a finished file is called: `<slug>.mp4` for English. */
    suffix: '',
  },
  bn: {
    code: 'bn',
    label: 'Bangla',
    // Bangla EXISTS only from v3 up — see the measurement above.
    model: 'eleven_v3',
    // "Ashwat — Calm, Pleasant Storyteller", the library's Bengali voice
    // (owner's choice, 2026-10-08; they wrote "Ashwant" and this is the
    // voice of that name that exists). Listed `language: bn`, male.
    voice: '1JOQMQINvsOLiEu2pZFd',
    field: 'sayBn',
    suffix: '-bn',
  },
  hi: {
    code: 'hi',
    label: 'Hindi',
    model: 'eleven_v3',
    // "Aman — Indian male", standard accent (owner's choice). The library
    // lists four Amans in Hindi; the other three are a Bihari accent, a
    // soft/expressive read and an ASMR whisper, none of which suits
    // instruction. Standard was chosen for that reason, not at random.
    voice: 'jOjeeDVKnAxGl1jZDUwy',
    field: 'sayHi',
    suffix: '-hi',
  },
};

export const LANGUAGE_CODES = Object.keys(LANGUAGES);

/**
 * The language a run is for, defaulting to English.
 *
 * Defaulting matters: every existing caller passes no language and must
 * keep producing byte-identical English audio from the cache.
 */
export function language(code = 'en') {
  const lang = LANGUAGES[code];
  if (lang === undefined) {
    throw new Error(`Unknown language "${code}". Known: ${LANGUAGE_CODES.join(', ')}`);
  }
  return lang;
}

/**
 * Refuse a run that would spend characters on something unusable.
 *
 * A missing voice id would otherwise be found after the API had been
 * billed for every clip — the failure arrives at playback, which is the
 * most expensive place to find it.
 */
export function assertReady(lang) {
  if (lang.voice === null || lang.voice === undefined || lang.voice === '') {
    throw new Error(
      `No voice is chosen for ${lang.label}. Set LANGUAGES.${lang.code}.voice in ` +
        `scripts/tutorials/lib/languages.mjs before generating ${lang.label} audio — ` +
        `generating it with the English voice would spend the characters and produce ` +
        `a clip nobody can ship.`,
    );
  }
  return lang;
}

/** The text this language speaks for a step, or null when untranslated. */
export function sayFor(step, lang) {
  const text = step[lang.field];
  return typeof text === 'string' && text.trim() !== '' ? text : null;
}
