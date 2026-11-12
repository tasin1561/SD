/**
 * The order detail remembers which cards are open and the activity
 * filter in localStorage — read AFTER mount (so the server's defaults and
 * the first client render agree), and never allowed to break the page when
 * storage throws.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  DEFAULT_UI_STATE,
  ORDER_DETAIL_UI_KEY,
  parseUiState,
  useOrderDetailUi,
} from '@/app/(authed)/orders/_components/order-detail-ui-state';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('parseUiState', () => {
  it('falls back to defaults field by field on malformed input', () => {
    expect(parseUiState(null)).toEqual(DEFAULT_UI_STATE);
    expect(parseUiState('{not json')).toEqual(DEFAULT_UI_STATE);
    const mixed = parseUiState(
      JSON.stringify({ open: { recipient: false, items: 'x' }, filter: 'nope' }),
    );
    expect(mixed.open.recipient).toBe(false);
    expect(mixed.open.items).toBe(true);
    expect(mixed.filter).toBe('all');
  });
});

describe('useOrderDetailUi', () => {
  it('renders DEFAULTS first and applies the stored layout in an effect after mount', () => {
    window.localStorage.setItem(
      ORDER_DETAIL_UI_KEY,
      JSON.stringify({ open: { activity: false, parsed: true }, filter: 'courier' }),
    );
    const seen: Array<{ activity: boolean; filter: string }> = [];
    const { result } = renderHook(() => {
      const ui = useOrderDetailUi();
      seen.push({ activity: ui.state.open.activity, filter: ui.state.filter });
      return ui;
    });
    // the FIRST render — what the server would have produced — is the defaults
    expect(seen[0]).toEqual({ activity: true, filter: 'all' });
    // and the stored value lands once the effect has run
    expect(result.current.state.open.activity).toBe(false);
    expect(result.current.state.open.parsed).toBe(true);
    expect(result.current.state.filter).toBe('courier');
  });

  it('persists a change under the versioned key', () => {
    const { result } = renderHook(() => useOrderDetailUi());
    act(() => result.current.setOpen('shipment', false));
    act(() => result.current.setFilter('warehouse'));
    const saved = JSON.parse(window.localStorage.getItem(ORDER_DETAIL_UI_KEY) ?? '{}');
    expect(saved.open.shipment).toBe(false);
    expect(saved.filter).toBe('warehouse');
  });

  it('does not overwrite a stored layout with defaults before it has been read', () => {
    window.localStorage.setItem(
      ORDER_DETAIL_UI_KEY,
      JSON.stringify({ open: { payment: false }, filter: 'all' }),
    );
    renderHook(() => useOrderDetailUi());
    const saved = JSON.parse(window.localStorage.getItem(ORDER_DETAIL_UI_KEY) ?? '{}');
    expect(saved.open.payment).toBe(false);
  });

  it('keeps working when reading AND writing storage throw', () => {
    // Replace the whole object: a spy on Storage.prototype does not reach
    // happy-dom's localStorage, which made an earlier version of this test
    // pass with no try/catch in the code at all.
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('quota');
        },
      },
    });
    try {
      const { result } = renderHook(() => useOrderDetailUi());
      expect(result.current.state).toEqual(DEFAULT_UI_STATE);
      act(() => result.current.setOpen('items', false));
      expect(result.current.state.open.items).toBe(false);
      act(() => result.current.setFilter('milestones'));
      expect(result.current.state.filter).toBe('milestones');
    } finally {
      if (real !== undefined) Object.defineProperty(window, 'localStorage', real);
    }
  });
});
