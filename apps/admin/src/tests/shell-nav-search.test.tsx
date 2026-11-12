import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Shell, type LinkLike, type NavGroup } from '@skydrop/ui/app/shell';

/**
 * The sidebar's menu search. It filters what is rendered and must never
 * touch the stored collapse state: clearing the box restores the nav.
 */
const onLink = vi.fn();
const FakeLink: LinkLike = ({ href, className, children, onClick, ...rest }) => (
  <a
    href={href}
    className={className}
    aria-current={rest['aria-current']}
    onClick={(e) => {
      e.preventDefault();
      onLink(href);
      onClick();
    }}
  >
    {children}
  </a>
);

const groups: NavGroup[] = [
  {
    heading: 'Operations',
    items: [
      { href: '/orders', label: 'Orders' },
      { href: '/call-queue', label: 'Call queue' },
    ],
  },
  {
    heading: 'Money',
    items: [
      { href: '/wallets', label: 'Seller wallets' },
      { href: '/remittances', label: 'Remittances' },
    ],
  },
];

function ui(): ReactElement {
  return (
    <Shell
      subtitle="Admin"
      sectionLabel="Staff"
      navGroups={groups}
      identityPrimary="Ana"
      identitySecondary="ana@x.test"
      pathname="/orders"
      Link={FakeLink}
      onSignOut={() => undefined}
    >
      <p>body</p>
    </Shell>
  );
}

// The shell mounts the nav twice (rail + drawer content is only mounted
// when open), so the rail is the one box.
function box(): HTMLInputElement {
  return screen.getByPlaceholderText('Search menu') as HTMLInputElement;
}
function rail(): HTMLElement {
  return document.querySelector('[data-slot="nav-rail"]') as HTMLElement;
}
function labels(): string[] {
  return Array.from(rail().querySelectorAll('.sk-nav__label')).map((n) => n.textContent ?? '');
}
function visibleLabels(): string[] {
  return Array.from(rail().querySelectorAll('.sk-nav__items:not([hidden]) .sk-nav__label')).map(
    (n) => n.textContent ?? '',
  );
}

describe('menu search', () => {
  beforeEach(() => {
    window.localStorage.clear();
    onLink.mockClear();
  });

  it('typing filters the items, case-insensitively, anywhere in the label', () => {
    render(ui());
    fireEvent.change(box(), { target: { value: 'QUE' } });
    expect(labels()).toEqual(['Call queue']);
    // Headings of the surviving groups stay so the location is clear.
    expect(rail().textContent).toContain('Operations');
    expect(rail().textContent).not.toContain('Money');
  });

  it('finds a match inside a COLLAPSED group, and clearing restores the collapse', () => {
    window.localStorage.setItem('sk-nav-collapsed:Money', '1');
    render(ui());
    expect(visibleLabels()).toEqual(['Orders', 'Call queue']);

    fireEvent.change(box(), { target: { value: 'remit' } });
    expect(visibleLabels()).toEqual(['Remittances']);

    fireEvent.change(box(), { target: { value: '' } });
    expect(visibleLabels()).toEqual(['Orders', 'Call queue']);
    // Searching never wrote the collapse storage.
    expect(window.localStorage.getItem('sk-nav-collapsed:Money')).toBe('1');
    expect(window.localStorage.getItem('sk-nav-collapsed:Operations')).toBeNull();
  });

  it('shows a line when nothing matches', () => {
    render(ui());
    fireEvent.change(box(), { target: { value: 'zzzz' } });
    expect(labels()).toEqual([]);
    expect(screen.getByText('Nothing in the menu matches.')).toBeInTheDocument();
  });

  it('Enter goes to the first match; Escape clears', () => {
    render(ui());
    fireEvent.change(box(), { target: { value: 'wallet' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onLink).toHaveBeenCalledWith('/wallets');

    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(box().value).toBe('');
    expect(labels()).toHaveLength(4);
  });

  it('keeps the active highlight while filtering', () => {
    render(ui());
    fireEvent.change(box(), { target: { value: 'ord' } });
    const active = rail().querySelector('[aria-current="page"]');
    expect(active?.textContent).toContain('Orders');
  });
});
