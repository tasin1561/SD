import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssistantWidget, type AssistantTransport } from '@skydrop/ui/app/assistant';

/**
 * On a phone (<640px) the chat panel is a FULL-SCREEN sheet, so it must be
 * modal: aria-modal, focus trapped, the page behind it inert. On a desktop
 * the side panel stays non-modal (the page beside it is still usable).
 */
const transport: AssistantTransport = {
  request: async <T,>() => [] as unknown as T,
  requestStream: async () => new Response(null, { status: 204 }),
};

type Listener = (e: { matches: boolean }) => void;
let phone = false;
let listeners: Listener[] = [];

function installMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes('640px') ? phone : false;
    },
    media: query,
    addEventListener: (_: string, l: Listener) => listeners.push(l),
    removeEventListener: (_: string, l: Listener) => {
      listeners = listeners.filter((x) => x !== l);
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
}

function mountPage(): { page: HTMLElement; nav: HTMLElement } {
  const nav = document.createElement('nav');
  nav.innerHTML = '<a href="/x">behind</a>';
  const page = document.createElement('main');
  page.innerHTML = '<button id="behind-btn">behind</button>';
  document.body.append(nav, page);
  return { page, nav };
}

async function openPanel(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<AssistantWidget console="seller" pathname="/orders" transport={transport} />);
  await user.click(screen.getByRole('button', { name: /ask skydrop/i }));
  await screen.findByLabelText('Ask a question');
  return user;
}

const panel = (): HTMLElement => screen.getByRole('dialog', { hidden: true });

beforeEach(() => {
  window.localStorage.clear();
  phone = false;
  listeners = [];
  installMatchMedia();
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('phone sheet is modal', () => {
  it('declares aria-modal and makes everything behind it inert', async () => {
    phone = true;
    const { page, nav } = mountPage();
    await openPanel();
    expect(panel().getAttribute('aria-modal')).toBe('true');
    expect(page.hasAttribute('inert')).toBe(true);
    expect(nav.hasAttribute('inert')).toBe(true);
    expect(panel().hasAttribute('inert')).toBe(false);
  });

  it('traps Tab: forward from the last control wraps to the first, backward from the first to the last', async () => {
    phone = true;
    mountPage();
    await openPanel();
    const focusables = Array.from(
      panel().querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    expect(first).not.toBe(last);

    last.focus();
    const fwd = fireEvent.keyDown(last, { key: 'Tab' });
    expect(fwd).toBe(false); // preventDefault was called
    expect(document.activeElement).toBe(first);

    first.focus();
    const back = fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(back).toBe(false);
    expect(document.activeElement).toBe(last);
  });

  it('pulls focus back in if it somehow sits behind the sheet', async () => {
    phone = true;
    const { page } = mountPage();
    await openPanel();
    const behind = page.querySelector('button') as HTMLButtonElement;
    behind.focus();
    fireEvent.keyDown(panel(), { key: 'Tab' });
    expect(panel().contains(document.activeElement)).toBe(true);
  });

  it('gives the page back when the sheet closes, and leaves what was already inert alone', async () => {
    phone = true;
    const { page, nav } = mountPage();
    nav.setAttribute('inert', '');
    const user = await openPanel();
    expect(page.hasAttribute('inert')).toBe(true);
    await user.keyboard('{Escape}');
    expect(page.hasAttribute('inert')).toBe(false);
    expect(nav.hasAttribute('inert')).toBe(true);
  });

  it('follows the viewport: rotating to a wide screen while open makes it non-modal again', async () => {
    phone = true;
    const { page } = mountPage();
    await openPanel();
    expect(page.hasAttribute('inert')).toBe(true);
    phone = false;
    act(() => listeners.forEach((l) => l({ matches: false })));
    expect(panel().getAttribute('aria-modal')).toBe('false');
    expect(page.hasAttribute('inert')).toBe(false);
  });
});

describe('phone sheet is a bottom sheet over a dimmed backdrop', () => {
  const backdrop = (): HTMLElement | null => document.querySelector('.sk-ai-backdrop');

  it('shows a backdrop and a grab handle, and the backdrop stays clickable (never inert)', async () => {
    phone = true;
    mountPage();
    await openPanel();
    const b = backdrop();
    expect(b).not.toBeNull();
    expect(b?.getAttribute('data-open')).toBe('1');
    expect(b?.hasAttribute('inert')).toBe(false);
    expect(b?.getAttribute('aria-hidden')).toBe('true');
    expect(panel().querySelector('.sk-ai-grab')).not.toBeNull();
  });

  it('a tap on the backdrop closes the sheet and gives the page back', async () => {
    phone = true;
    const { page } = mountPage();
    await openPanel();
    expect(page.hasAttribute('inert')).toBe(true);
    fireEvent.click(backdrop() as HTMLElement);
    expect(panel().getAttribute('data-open')).toBe('0');
    expect(backdrop()?.getAttribute('data-open')).toBe('0');
    expect(page.hasAttribute('inert')).toBe(false);
  });

  it('a desktop has no backdrop at all', async () => {
    mountPage();
    await openPanel();
    expect(backdrop()).toBeNull();
  });

  describe('the stylesheet', () => {
    const css = readFileSync(
      join(__dirname, '../../../../packages/ui/src/app/assistant/assistant.css'),
      'utf8',
    );
    const phoneBlock = css.slice(css.indexOf('@media (max-width: 640px)'));

    it('makes the phone panel about 85% tall with rounded top corners, sliding up from the bottom', () => {
      expect(phoneBlock).toMatch(/height:\s*85dvh/);
      expect(phoneBlock).toMatch(/border-radius:\s*var\(--r-lg\) var\(--r-lg\) 0 0/);
      expect(phoneBlock).toMatch(/inset:\s*auto 0 0 0/);
      expect(phoneBlock).toMatch(/translateY\(100%\)/);
      expect(phoneBlock).not.toMatch(/height:\s*100dvh/);
    });

    it('dims the page with the scrim token, honours safe areas, and respects reduced motion', () => {
      expect(phoneBlock).toContain('var(--scrim)');
      expect(phoneBlock).toContain('env(safe-area-inset-left)');
      expect(css).toContain('env(safe-area-inset-bottom)');
      expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.sk-ai-backdrop/);
    });

    it('leaves the desktop panel exactly as it was', () => {
      const desktop = css.slice(
        css.indexOf('.sk-ai-panel {'),
        css.indexOf('@media (max-width: 640px)'),
      );
      expect(desktop).toContain('right: var(--sp-4);');
      expect(desktop).toContain('bottom: var(--sp-4);');
      expect(desktop).toContain('width: min(420px, calc(100vw - 2 * var(--sp-4)));');
      expect(desktop).toContain('height: min(720px, calc(100dvh - 2 * var(--sp-4)));');
      expect(desktop).toContain('translateX(calc(100% + var(--sp-6)))');
    });
  });
});

describe('desktop panel stays non-modal', () => {
  it('is aria-modal=false, leaves the page usable and does not trap Tab', async () => {
    const { page, nav } = mountPage();
    await openPanel();
    expect(panel().getAttribute('aria-modal')).toBe('false');
    expect(page.hasAttribute('inert')).toBe(false);
    expect(nav.hasAttribute('inert')).toBe(false);
    const last = Array.from(panel().querySelectorAll<HTMLElement>('textarea'))[0]!;
    last.focus();
    const notPrevented = fireEvent.keyDown(last, { key: 'Tab' });
    expect(notPrevented).toBe(true);
  });
});
