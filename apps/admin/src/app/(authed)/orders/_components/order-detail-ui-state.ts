'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * What the order detail remembers between visits: which cards are open and
 * which activity filter was last used. localStorage, because it is a
 * personal layout preference and not data (FE-1 is about the access token,
 * which never goes near this).
 *
 * ── SSR-SAFE ──────────────────────────────────────────────────────────
 * The server renders DEFAULTS. The stored value is read in an effect
 * AFTER mount, so the first client render is identical to the server's and
 * there is no hydration mismatch; a stored layout then swaps in. Every
 * storage access is wrapped in try/catch: private browsing, blocked site
 * data and a full quota all THROW, and none of them may break the page.
 */
export const ORDER_DETAIL_UI_KEY = 'sd.admin.orderDetail.ui.v1';

export type CardId = 'recipient' | 'shipment' | 'payment' | 'items' | 'activity' | 'parsed';
export type ActivityFilter = 'all' | 'milestones' | 'courier' | 'warehouse';

export interface OrderDetailUiState {
  readonly open: Readonly<Record<CardId, boolean>>;
  readonly filter: ActivityFilter;
}

export const DEFAULT_UI_STATE: OrderDetailUiState = {
  open: {
    recipient: true,
    shipment: true,
    payment: true,
    items: true,
    activity: true,
    parsed: false,
  },
  filter: 'all',
};

const FILTERS: readonly ActivityFilter[] = ['all', 'milestones', 'courier', 'warehouse'];

/** Tolerant: anything malformed falls back to the default for that field. */
export function parseUiState(raw: string | null): OrderDetailUiState {
  if (raw === null) return DEFAULT_UI_STATE;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_UI_STATE;
    const obj = parsed as { open?: unknown; filter?: unknown };
    const open = { ...DEFAULT_UI_STATE.open };
    if (typeof obj.open === 'object' && obj.open !== null) {
      for (const id of Object.keys(open) as CardId[]) {
        const v = (obj.open as Record<string, unknown>)[id];
        if (typeof v === 'boolean') open[id] = v;
      }
    }
    const filter = FILTERS.find((f) => f === obj.filter) ?? DEFAULT_UI_STATE.filter;
    return { open, filter };
  } catch {
    return DEFAULT_UI_STATE;
  }
}

export function readUiState(): OrderDetailUiState {
  try {
    return parseUiState(window.localStorage.getItem(ORDER_DETAIL_UI_KEY));
  } catch {
    return DEFAULT_UI_STATE;
  }
}

function writeUiState(state: OrderDetailUiState): void {
  try {
    window.localStorage.setItem(ORDER_DETAIL_UI_KEY, JSON.stringify(state));
  } catch {
    /* nowhere to remember it — the page still works */
  }
}

export interface OrderDetailUi {
  readonly state: OrderDetailUiState;
  readonly setOpen: (id: CardId, open: boolean) => void;
  readonly setFilter: (filter: ActivityFilter) => void;
}

export function useOrderDetailUi(): OrderDetailUi {
  const [state, setState] = useState<OrderDetailUiState>(DEFAULT_UI_STATE);
  // Nothing is written until the stored value has been read, or the
  // defaults would overwrite the very thing we are about to load.
  const loaded = useRef(false);

  useEffect(() => {
    setState(readUiState());
    loaded.current = true;
  }, []);

  const commit = useCallback((next: (prev: OrderDetailUiState) => OrderDetailUiState): void => {
    setState((prev) => {
      const value = next(prev);
      if (loaded.current) writeUiState(value);
      return value;
    });
  }, []);

  const setOpen = useCallback(
    (id: CardId, open: boolean): void => commit((p) => ({ ...p, open: { ...p.open, [id]: open } })),
    [commit],
  );
  const setFilter = useCallback(
    (filter: ActivityFilter): void => commit((p) => ({ ...p, filter })),
    [commit],
  );
  return { state, setOpen, setFilter };
}
