import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
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

  it('never lets the model link into the app', () => {
    const { container } = view('[go](/wallet) [x](//evil.test)');
    expect(container.querySelector('a')).toBeNull();
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
