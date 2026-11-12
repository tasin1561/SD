import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { Markdown, orderSearchHref, type AssistantConsole } from '@skydrop/ui/app/assistant';

const view = (text: string, console_: AssistantConsole = 'admin') =>
  render(<Markdown text={text} entityHref={(v) => orderSearchHref(console_, v)} />);

describe('assistant markdown is inert', () => {
  it('renders <script> and <img onerror> as text, never as elements', () => {
    const { container } = view('<script>alert(1)</script> <img src=x onerror=alert(1)>');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('never makes a live link from javascript: or data: targets', () => {
    const { container } = view('[click](javascript:alert(1)) and [d](data:text/html,x)');
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('[click](javascript:alert(1))');
  });

  it('links https only, opening safely', () => {
    const { container } = view('[docs](https://skydrop.global/x) and http://insecure.test');
    const a = container.querySelectorAll('a');
    expect(a).toHaveLength(1);
    expect(a[0]?.getAttribute('href')).toBe('https://skydrop.global/x');
    expect(a[0]?.getAttribute('rel')).toContain('noopener');
  });

  it('makes a same-origin relative path a live in-app link', () => {
    const { container } = view('Open [Orders](/orders) or [one](/orders?search=SD-1).');
    const a = container.querySelectorAll('a');
    expect(a).toHaveLength(2);
    expect(a[0]?.getAttribute('href')).toBe('/orders');
    expect(a[0]?.textContent).toBe('Orders');
    expect(a[1]?.getAttribute('href')).toBe('/orders?search=SD-1');
    // It stays inside the console: no new tab, no external-link treatment.
    expect(a[0]?.getAttribute('target')).toBeNull();
  });

  it('navigates in the console (no reload) when a navigate handler is given, and lets modified clicks through', () => {
    const go = vi.fn();
    const { container } = render(
      <Markdown text="[Wallet](/wallet)" entityHref={(v) => v} onNavigate={go} />,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;
    fireEvent.click(a);
    expect(go).toHaveBeenCalledWith('/wallet');
    fireEvent.click(a, { ctrlKey: true });
    expect(go).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['protocol-relative', '[x](//evil.com)'],
    ['backslash host', '[x](/\\evil.com)'],
    ['javascript scheme', '[x](javascript:alert(1))'],
    ['encoded newline then scheme', '[x](/orders%0ajavascript:)'],
    ['data scheme', '[x](data:text/html,hi)'],
    ['http scheme', '[x](http://evil.com)'],
    ['scheme hidden in a path', '[x](/a:javascript:alert(1))'],
    ['encoded carriage return', '[x](/orders%0Dfoo)'],
    ['encoded null', '[x](/orders%00)'],
    ['bare root', '[x](/)'],
    ['relative without a slash', '[x](orders)'],
  ])('keeps %s inert text', (_n, md) => {
    const { container } = view(md);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain(md.slice(1, md.indexOf(']')));
  });

  it('renders bold, lists, inline code and paragraphs', () => {
    const { container } = view('Hello **world** `x`\n\n- a\n- b\n\n1. one\n2. two');
    expect(container.querySelector('strong')?.textContent).toBe('world');
    expect(container.querySelector('code')?.textContent).toBe('x');
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
  });
});

describe('order numbers and waybills link to THIS console', () => {
  const text = 'See SD-2026-26-000123 and waybill 38061110627373 (call 9876543210).';
  it.each(['admin', 'seller', 'reseller', 'associate'] as const)('%s', (c) => {
    const { container } = view(text, c);
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/orders?search=SD-2026-26-000123', '/orders?search=38061110627373']);
  });

  it('does not link a phone number or a lookalike', () => {
    const { container } = view('9876543210 SD-26-1 12345');
    expect(container.querySelector('a')).toBeNull();
  });
});
