import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { AssistantWidget, type AssistantTransport } from '@skydrop/ui/app/assistant';
import { launcherPosKey, placeFromRect } from '@skydrop/ui/app/assistant';

const transport: AssistantTransport = {
  request: async <T,>(): Promise<T> => ({ enabled: false }) as T,
  requestStream: async () => new Response(null, { status: 200 }),
};

const KEY = launcherPosKey('seller', 'u1');

function mountAt(rect: { left: number; top: number }, userId: string | null = 'u1') {
  const r = render(
    <AssistantWidget console="seller" pathname="/" transport={transport} userId={userId} />,
  );
  const btn = r.container.ownerDocument.querySelector<HTMLButtonElement>('.sk-ai-launcher');
  if (!btn) throw new Error('no launcher');
  btn.getBoundingClientRect = () => {
    const tx = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(btn.style.transform);
    const dx = tx ? Number(tx[1]) : 0;
    const dy = tx ? Number(tx[2]) : 0;
    return {
      left: rect.left + dx,
      top: rect.top + dy,
      width: 150,
      height: 44,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
  return { btn, ...r };
}

const ev = (x: number, y: number) => ({
  clientX: x,
  clientY: y,
  pointerId: 1,
  pointerType: 'touch',
});

function dragBy(btn: HTMLElement, dx: number, dy: number) {
  fireEvent.pointerDown(btn, ev(500, 500));
  fireEvent.pointerMove(btn, ev(500 + dx, 500 + dy));
  fireEvent.pointerUp(btn, ev(500 + dx, 500 + dy));
  fireEvent.click(btn);
}

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
});
afterEach(() => vi.restoreAllMocks());

describe('assistant launcher: drag to move', () => {
  it('a tap opens the chat', () => {
    const { btn } = mountAt({ left: 830, top: 700 });
    fireEvent.pointerDown(btn, ev(500, 500));
    fireEvent.pointerUp(btn, ev(500, 500));
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('a drag never opens the chat and snaps to the nearest side, saved per user', () => {
    const { btn } = mountAt({ left: 830, top: 700 });
    dragBy(btn, -700, -300); // centre ends left of the middle, top 400
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('data-placed')).toBe('left');
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
    expect(saved.side).toBe('left');
    expect(saved.yRatio).toBeCloseTo((400 - 12) / (800 - 44 - 24), 2);
    expect(window.localStorage.getItem(launcherPosKey('seller', 'u2'))).toBeNull();
  });

  it('a movement under the threshold is still a tap', () => {
    const { btn } = mountAt({ left: 830, top: 700 });
    dragBy(btn, 3, 3);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('clamps the ratio inside the viewport', () => {
    expect(placeFromRect({ left: 900, top: -500, width: 150, height: 44 }, 1000, 800, 0)).toEqual({
      side: 'right',
      yRatio: 0,
    });
    expect(placeFromRect({ left: 10, top: 5000, width: 150, height: 44 }, 1000, 800, 0)).toEqual({
      side: 'left',
      yRatio: 1,
    });
    // a bottom bar shrinks the range, so the same spot nudges above it
    const lifted = placeFromRect({ left: 10, top: 600, width: 150, height: 44 }, 1000, 800, 100);
    expect(lifted.yRatio).toBeCloseTo((600 - 12) / (800 - 44 - 24 - 100), 3);
  });

  it('restores the saved place, and the key is per user / per console', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ side: 'left', yRatio: 0.25 }));
    const { btn } = mountAt({ left: 0, top: 0 });
    expect(btn.getAttribute('data-placed')).toBe('left');
    expect(btn.style.getPropertyValue('--sk-ai-y')).toBe('0.25');
    expect(launcherPosKey('admin', null)).toBe('sk-ai-pos:admin');
    expect(launcherPosKey('admin', 'u9')).toBe('sk-ai-pos:admin:u9');
  });

  it('ignores a corrupt saved value', () => {
    window.localStorage.setItem(KEY, '{nope');
    const { btn } = mountAt({ left: 0, top: 0 });
    expect(btn.getAttribute('data-placed')).toBeNull();
  });

  it('blocked storage does not crash', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { btn } = mountAt({ left: 830, top: 700 });
    dragBy(btn, -700, 0);
    expect(btn.getAttribute('data-placed')).toBe('left');
  });

  it('Alt+Arrow keys move it and save; plain arrows do not', () => {
    const { btn } = mountAt({ left: 830, top: 700 });
    fireEvent.keyDown(btn, { key: 'ArrowLeft' });
    expect(btn.getAttribute('data-placed')).toBeNull();
    fireEvent.keyDown(btn, { key: 'ArrowLeft', altKey: true });
    expect(btn.getAttribute('data-placed')).toBe('left');
    const before = JSON.parse(window.localStorage.getItem(KEY) ?? '{}').yRatio;
    fireEvent.keyDown(btn, { key: 'ArrowUp', altKey: true });
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '{}').yRatio).toBeCloseTo(
      before - 0.08,
      3,
    );
  });

  it('reduced motion: places at once without a glide', () => {
    window.matchMedia = ((q: string) => ({
      matches: q.includes('reduce'),
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    const { btn } = mountAt({ left: 830, top: 700 });
    dragBy(btn, -700, 0);
    expect(btn.style.transform).toBe('');
    expect(btn.getAttribute('data-placed')).toBe('left');
  });
});
