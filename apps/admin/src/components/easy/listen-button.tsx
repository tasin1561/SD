'use client';

import { Square, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { Locale } from '@skydrop/ui/app/i18n';
import { useLocale, useT } from '@/i18n/client';
import './easy.css';

/** The speech tag each console language is read in. */
const SPEECH_LANG: Readonly<Record<Locale, string>> = {
  en: 'en-IN',
  bn: 'bn-BD',
  hi: 'hi-IN',
};

type VoiceState = 'unknown' | 'ready' | 'none';

/** The voice to read `tag` with, or null when this device has none for that language. */
function pickVoice(
  voices: readonly SpeechSynthesisVoice[],
  tag: string,
): SpeechSynthesisVoice | null {
  const base = tag.slice(0, 2).toLowerCase();
  const norm = (l: string): string => l.replace('_', '-').toLowerCase();
  return (
    voices.find((v) => norm(v.lang) === tag.toLowerCase()) ??
    voices.find((v) => norm(v.lang).startsWith(base)) ??
    null
  );
}

/**
 * Listen — reads a piece of the screen aloud with the browser's own
 * speech, for somebody who would rather hear it than read it.
 *
 * It renders NOTHING when the device cannot speak the language: a button
 * that stays silent, or reads Bangla with an English voice, is worse than
 * no button. No package, no network call, nothing recorded — the words
 * never leave the browser.
 *
 * `lang` overrides the console language for text that is not translated
 * (a server-written issue is English whatever the console is set to).
 */
export function ListenButton({
  text,
  lang,
  className,
}: {
  readonly text: string;
  readonly lang?: Locale | undefined;
  readonly className?: string | undefined;
}): ReactElement | null {
  const t = useT();
  const locale = useLocale();
  const tag = SPEECH_LANG[lang ?? locale];
  const [voice, setVoice] = useState<VoiceState>('unknown');
  const [speaking, setSpeaking] = useState(false);
  const mine = useRef<SpeechSynthesisUtterance | null>(null);

  // Voices arrive late on most browsers, so listen for them. Decided after
  // mount, never during render: the server has no speech at all.
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setVoice('none');
      return;
    }
    const synth = window.speechSynthesis;
    const check = (): void => {
      const voices = synth.getVoices();
      if (voices.length === 0) return;
      setVoice(pickVoice(voices, tag) === null ? 'none' : 'ready');
    };
    check();
    synth.addEventListener('voiceschanged', check);
    return () => synth.removeEventListener('voiceschanged', check);
  }, [tag]);

  // Leaving the screen, or the words changing, stops what this button started.
  useEffect(() => {
    return () => {
      if (mine.current !== null && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        mine.current = null;
      }
    };
  }, [text]);

  if (voice !== 'ready' || text.trim() === '') return null;

  const toggle = (): void => {
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      mine.current = null;
      setSpeaking(false);
      return;
    }
    // One voice at a time across the whole page.
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(synth.getVoices(), tag);
    u.lang = v?.lang ?? tag;
    if (v !== null) u.voice = v;
    u.rate = 0.95;
    const done = (): void => {
      if (mine.current === u) {
        mine.current = null;
        setSpeaking(false);
      }
    };
    u.onend = done;
    u.onerror = done;
    mine.current = u;
    setSpeaking(true);
    synth.speak(u);
  };

  return (
    <button
      type="button"
      className={className === undefined ? 'ez-listen' : `ez-listen ${className}`}
      aria-pressed={speaking}
      onClick={toggle}
    >
      {speaking ? <Square size={14} aria-hidden /> : <Volume2 size={16} aria-hidden />}
      {speaking ? t('easy.stop') : t('easy.listen')}
    </button>
  );
}
