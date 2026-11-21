'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';

/** Where the person parked the launcher. A ratio, so it survives other screens and rotation. */
export interface LauncherPos {
  readonly side: 'left' | 'right';
  readonly yRatio: number;
}

/** Movement under this many px is still a tap. */
export const DRAG_THRESHOLD = 6;
export const EDGE_MARGIN = 12;
const KEY_STEP = 0.08;

export function launcherPosKey(consoleName: string, userId?: string | null): string {
  return userId ? `sk-ai-pos:${consoleName}:${userId}` : `sk-ai-pos:${consoleName}`;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export function parseLauncherPos(raw: string | null): LauncherPos | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (v === null || typeof v !== 'object') return null;
    const { side, yRatio } = v as { side?: unknown; yRatio?: unknown };
    if ((side !== 'left' && side !== 'right') || typeof yRatio !== 'number') return null;
    if (!Number.isFinite(yRatio)) return null;
    return { side, yRatio: clamp01(yRatio) };
  } catch {
    return null;
  }
}

export function readLauncherPos(key: string): LauncherPos | null {
  try {
    return parseLauncherPos(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeLauncherPos(key: string, pos: LauncherPos | null): void {
  try {
    if (pos === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(pos));
  } catch {
    /* blocked or full storage: the position just is not remembered */
  }
}

/** Nearest side by the button's centre, and a 0..1 ratio inside the usable height. */
export function placeFromRect(
  rect: { left: number; top: number; width: number; height: number },
  vw: number,
  vh: number,
  lift: number,
): LauncherPos {
  const side = rect.left + rect.width / 2 < vw / 2 ? 'left' : 'right';
  const range = vh - rect.height - 2 * EDGE_MARGIN - lift;
  const yRatio = range <= 0 ? 1 : clamp01((rect.top - EDGE_MARGIN) / range);
  return { side, yRatio };
}

export interface LauncherDrag {
  readonly pos: LauncherPos | null;
  readonly dragging: boolean;
  readonly style: CSSProperties;
  readonly handlers: {
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => void;
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => void;
    onPointerCancel: (e: PointerEvent<HTMLButtonElement>) => void;
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  };
  /** True once for the click that ends a drag, so a drag never opens the chat. */
  readonly consumeClick: () => boolean;
  readonly reset: () => void;
}

export function useLauncherDrag(
  ref: RefObject<HTMLButtonElement | null>,
  storageKey: string,
  lift: number,
): LauncherDrag {
  const [pos, setPos] = useState<LauncherPos | null>(null);
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const swallow = useRef(false);
  const liftRef = useRef(lift);
  liftRef.current = lift;
  const before = useRef<{ left: number; top: number } | null>(null);

  useEffect(() => {
    setPos(readLauncherPos(storageKey));
  }, [storageKey]);

  const commit = useCallback(
    (next: LauncherPos | null) => {
      const el = ref.current;
      if (el) {
        const r = el.getBoundingClientRect();
        before.current = { left: r.left, top: r.top };
      }
      setPos(next);
      writeLauncherPos(storageKey, next);
    },
    [ref, storageKey],
  );

  // Glide from where it was to where it now rests (transform only; not at all under reduced motion).
  useLayoutEffect(() => {
    const el = ref.current;
    const from = before.current;
    before.current = null;
    if (!el || !from) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const r = el.getBoundingClientRect();
    const dx = from.left - r.left;
    const dy = from.top - r.top;
    if (dx === 0 && dy === 0) return undefined;
    el.style.transition = 'none';
    el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    const id = window.requestAnimationFrame(() => {
      el.style.transition = '';
      el.style.transform = '';
    });
    return () => window.cancelAnimationFrame(id);
  }, [pos, ref]);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* not capturable: moves still arrive while over the button */
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>): void => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      s.moved = true;
      setDragging(true);
    }
    setOffset({ x: dx, y: dy });
  };

  const finish = (e: PointerEvent<HTMLButtonElement>, cancelled: boolean): void => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    start.current = null;
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* already released */
    }
    if (!s.moved) return;
    swallow.current = true;
    window.setTimeout(() => {
      swallow.current = false;
    }, 0);
    const el = ref.current;
    // The rect now (offset still applied) is where the person left it.
    const r = el?.getBoundingClientRect();
    setDragging(false);
    setOffset(null);
    if (cancelled || !r) return;
    commit(
      placeFromRect(
        { left: r.left, top: r.top, width: r.width, height: r.height },
        window.innerWidth,
        window.innerHeight,
        liftRef.current,
      ),
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (!e.altKey) return;
    const el = ref.current;
    if (!el) return;
    const cur =
      pos ?? placeFromRect(el.getBoundingClientRect(), window.innerWidth, window.innerHeight, lift);
    let next: LauncherPos | null = null;
    if (e.key === 'ArrowLeft') next = { side: 'left', yRatio: cur.yRatio };
    else if (e.key === 'ArrowRight') next = { side: 'right', yRatio: cur.yRatio };
    else if (e.key === 'ArrowUp') next = { side: cur.side, yRatio: clamp01(cur.yRatio - KEY_STEP) };
    else if (e.key === 'ArrowDown')
      next = { side: cur.side, yRatio: clamp01(cur.yRatio + KEY_STEP) };
    if (!next) return;
    e.preventDefault();
    commit(next);
  };

  const style: Record<string, string> = {};
  if (pos) style['--sk-ai-y'] = String(pos.yRatio);
  if (offset) style.transform = `translate3d(${offset.x}px, ${offset.y}px, 0)`;

  return {
    pos,
    dragging,
    style: style as CSSProperties,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e) => finish(e, false),
      onPointerCancel: (e) => finish(e, true),
      onKeyDown,
    },
    consumeClick: () => {
      if (!swallow.current) return false;
      swallow.current = false;
      return true;
    },
    reset: () => commit(null),
  };
}
