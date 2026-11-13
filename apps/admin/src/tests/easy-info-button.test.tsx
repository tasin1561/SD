import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Locale } from '@skydrop/ui/app/i18n';
import { LocaleProvider } from '@skydrop/ui/app/i18n-client';
import { InfoButton } from '@/components/easy/info-button';

/*
  The shared "easy pages" piece.

  InfoButton: explanations moved off the page live in its bubble, so the
  bubble must open on a PRESS (not hover), carry every word it was given,
  and close again without stranding keyboard focus.
*/

function mount(ui: React.ReactElement, locale: Locale = 'en'): void {
  render(<LocaleProvider initialLocale={locale}>{ui}</LocaleProvider>);
}

afterEach(() => {
  cleanup();
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
