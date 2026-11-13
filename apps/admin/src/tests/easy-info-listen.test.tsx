import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Locale } from '@skydrop/ui/app/i18n';
import { LocaleProvider } from '@skydrop/ui/app/i18n-client';
import { InfoButton } from '@/components/easy/info-button';
import { ListenButton } from '@/components/easy/listen-button';

/*
  The two shared "easy pages" pieces.

  InfoButton: explanations moved off the page live in its bubble, so the
  bubble must open on a PRESS (not hover), carry every word it was given,
  and close again without stranding keyboard focus.

  ListenButton: it must not exist on a device that cannot speak the
  language — a silent button, or Bangla read by an English voice, is worse
  than none — and what it speaks must be the text it was handed, in the
  right language.
*/

interface FakeUtterance {
  text: string;
  lang: string;
  onend: (() => void) | null;
}

function installSpeech(langs: readonly string[]): { spoken: FakeUtterance[]; cancel: () => void } {
  const spoken: FakeUtterance[] = [];
  const cancel = vi.fn();
  class Utterance implements FakeUtterance {
    lang = '';
    voice: unknown = null;
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public text: string) {}
  }
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      getVoices: () => langs.map((lang) => ({ lang, name: lang })),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      cancel,
      speak: (u: FakeUtterance) => spoken.push(u),
    },
  });
  return { spoken, cancel };
}

function mount(ui: React.ReactElement, locale: Locale = 'en'): void {
  render(<LocaleProvider initialLocale={locale}>{ui}</LocaleProvider>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'speechSynthesis');
});

describe('InfoButton', () => {
  it('is closed until pressed, then shows the title, the text and every fact', () => {
    mount(
      <InfoButton
        title="Chargeable weight"
        text="The weight the courier bills for."
        facts={[{ label: 'Came from', value: 'courier-pickup.auto' }]}
      />,
    );
    const button = screen.getByRole('button', { name: 'About: Chargeable weight' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const bubble = screen.getByRole('dialog', { name: 'Chargeable weight' });
    expect(bubble.textContent).toContain('The weight the courier bills for.');
    expect(bubble.textContent).toContain('Came from');
    expect(bubble.textContent).toContain('courier-pickup.auto');
  });

  it('does not open on hover — a bubble that vanishes when the pointer slips cannot be read', () => {
    mount(<InfoButton title="Urgent" text="Do these first." />);
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'About: Urgent' }));
    fireEvent.mouseOver(screen.getByRole('button', { name: 'About: Urgent' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Escape closes it and hands focus back to the button', () => {
    mount(<InfoButton title="Urgent" text="Do these first." />);
    const button = screen.getByRole('button', { name: 'About: Urgent' });
    fireEvent.click(button);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('a press anywhere else closes it; a press inside does not', () => {
    mount(
      <>
        <InfoButton title="Urgent" text="Do these first." />
        <p>elsewhere</p>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'About: Urgent' }));
    fireEvent.pointerDown(screen.getByText('Do these first.'));
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.pointerDown(screen.getByText('elsewhere'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names itself in the console language', () => {
    mount(<InfoButton title="জরুরি" text="এগুলো আগে করুন।" />, 'bn');
    expect(screen.getByRole('button', { name: 'জরুরি সম্পর্কে' })).toBeTruthy();
  });
});

describe('ListenButton', () => {
  it('renders nothing when the browser has no speech at all', () => {
    mount(<ListenButton text="Hello" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing when there is no voice for the language', () => {
    installSpeech(['en-US']);
    mount(<ListenButton text="হ্যালো" />, 'bn');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('speaks the text it was given, in the console language, and can be stopped', () => {
    const { spoken, cancel } = installSpeech(['en-IN', 'bn-BD']);
    mount(<ListenButton text="এগুলো আগে করুন।" />, 'bn');
    const button = screen.getByRole('button', { name: 'শুনুন' });
    fireEvent.click(button);
    expect(spoken).toHaveLength(1);
    expect(spoken[0]?.text).toBe('এগুলো আগে করুন।');
    expect(spoken[0]?.lang).toBe('bn-BD');
    expect(button.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'থামান' }));
    expect(cancel).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'শুনুন' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('`lang` overrides the console language for untranslated text', () => {
    const { spoken } = installSpeech(['en-IN', 'bn-BD']);
    mount(<ListenButton text="Delhivery refused a parcel" lang="en" />, 'bn');
    fireEvent.click(screen.getByRole('button'));
    expect(spoken[0]?.lang).toBe('en-IN');
  });

  it('goes back to idle when the voice finishes', () => {
    const { spoken } = installSpeech(['en-IN']);
    mount(<ListenButton text="Done" />);
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    act(() => spoken[0]?.onend?.());
    expect(screen.getByRole('button', { name: 'Listen' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });
});
