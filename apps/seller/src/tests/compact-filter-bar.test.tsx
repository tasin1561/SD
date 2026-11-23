import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { LocaleProvider } from '@skydrop/ui/app/i18n-client';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { FilterBar, FilterField } from '@skydrop/ui/app/filter-bar';
import { DateRangeField, presetRange } from '@skydrop/ui/app/date-range';

function Page({
  initial = { search: '', from: '', to: '' },
  onUrl = () => undefined,
}: {
  readonly initial?: { search: string; from: string; to: string };
  readonly onUrl?: (next: { from: string; to: string }) => void;
}): ReactElement {
  const [state, setState] = useState(initial);
  const count = [state.search, state.from, state.to].filter((v) => v !== '').length;
  return (
    <LocaleProvider initialLocale="en">
      <main>
        <PageHeader title="Orders" meta={<span>204 orders</span>} action={<button>New</button>} />
        <FilterBar activeCount={count} onReset={() => setState({ search: '', from: '', to: '' })}>
          <FilterField wide>
            <label>
              Search
              <input
                value={state.search}
                onChange={(e) => setState((s) => ({ ...s, search: e.target.value }))}
              />
            </label>
          </FilterField>
          <FilterField>
            <DateRangeField
              label="Placed"
              from={state.from}
              to={state.to}
              onChange={(r) => {
                setState((s) => ({ ...s, ...r }));
                onUrl(r);
              }}
            />
          </FilterField>
        </FilterBar>
      </main>
    </LocaleProvider>
  );
}

afterEach(() => vi.useRealTimers());

describe('compact page header', () => {
  it('puts the title, its count and the actions in one row', () => {
    render(<Page />);
    const h1 = screen.getByRole('heading', { level: 1, name: 'Orders' });
    const bar = h1.closest('.sk-ph__bar')!;
    expect(within(bar as HTMLElement).getByText('204 orders')).toBeInTheDocument();
    expect(within(bar as HTMLElement).getByRole('button', { name: 'New' })).toBeInTheDocument();
  });
});

describe('compact filter bar', () => {
  it('has no "Filters / None active" heading row and shows Reset only when something is filtered', () => {
    render(<Page />);
    expect(screen.queryByText('None active')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Reset/ })).toBeNull();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'asha' } });
    const reset = screen.getByRole('button', { name: 'Reset (1)' });
    fireEvent.click(reset);
    expect(screen.getByLabelText('Search')).toHaveValue('');
    expect(screen.queryByRole('button', { name: /^Reset/ })).toBeNull();
  });

  it('puts its phone "Filters (n)" button in the page header and renders the controls once', () => {
    render(<Page initial={{ search: 'asha', from: '', to: '' }} />);
    const toggle = screen.getByRole('button', { name: 'Filters (1)' });
    expect(toggle.closest('.sk-ph__slot')).not.toBeNull();
    expect(screen.getAllByLabelText('Search')).toHaveLength(1);
  });

  it('opens as a sheet, focuses the first control, and closes with Escape back to the button', () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    render(<Page />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(toggle);
    const sheet = screen.getByRole('dialog', { name: 'Filters' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(document.activeElement).toBe(screen.getByLabelText('Search'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });
});

describe('date range field', () => {
  it('reads "Any time", then the chosen range, and reports both ends at once', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 23, 12));
    const onUrl = vi.fn();
    render(<Page onUrl={onUrl} />);
    const field = screen.getByRole('button', { name: 'Placed' });
    expect(field).toHaveTextContent('Any time');
    fireEvent.click(field);
    const panel = screen.getByRole('dialog', { name: 'Placed' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Last 7 days' }));
    expect(onUrl).toHaveBeenLastCalledWith({ from: '2026-11-17', to: '2026-11-23' });
    expect(field).toHaveTextContent('17 Nov – 23 Nov');
    expect(within(panel).getByRole('button', { name: 'Last 7 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.change(within(panel).getByLabelText('From'), { target: { value: '2026-11-01' } });
    expect(onUrl).toHaveBeenLastCalledWith({ from: '2026-11-01', to: '2026-11-23' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Clear dates' }));
    expect(onUrl).toHaveBeenLastCalledWith({ from: '', to: '' });
    expect(field).toHaveTextContent('Any time');
  });

  it('closes on Escape and on a tap outside', () => {
    render(<Page />);
    const field = screen.getByRole('button', { name: 'Placed' });
    fireEvent.click(field);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Placed' })).toBeNull();
    expect(document.activeElement).toBe(field);
    fireEvent.click(field);
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(screen.queryByRole('dialog', { name: 'Placed' })).toBeNull();
  });

  it('counts the quick ranges on the local calendar', () => {
    const now = new Date(2026, 1, 3, 9);
    expect(presetRange('today', now)).toEqual({ from: '2026-02-03', to: '2026-02-03' });
    expect(presetRange('last30', now)).toEqual({ from: '2026-01-05', to: '2026-02-03' });
    expect(presetRange('thisMonth', now)).toEqual({ from: '2026-02-01', to: '2026-02-03' });
  });
});
