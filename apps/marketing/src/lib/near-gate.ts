/**
 * A promise a `dynamic()` factory can AWAIT so a below-fold island's chunk is
 * not fetched — and its subtree not hydrated — until the island is near the
 * viewport. On the server the gate is already open (the island is rendered
 * into the HTML as usual); on the client `NearGate` opens it from an
 * IntersectionObserver on the island's own wrapper. React keeps the
 * server-rendered markup on screen until the chunk arrives (selective
 * hydration), so nothing flashes; what moves is the main-thread work, off the
 * first seconds. Phase 5 measured TBT 1.0–1.35 s with the three islands
 * hydrating eagerly, against 0.3–0.5 s before them.
 */
const gates = new Map<string, { promise: Promise<void>; open: () => void }>();

export function nearGate(id: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  return gateFor(id).promise;
}

function gateFor(id: string): { promise: Promise<void>; open: () => void } {
  let g = gates.get(id);
  if (!g) {
    let open = (): void => {};
    const promise = new Promise<void>((resolve) => {
      open = resolve;
    });
    g = { promise, open };
    gates.set(id, g);
  }
  return g;
}

/** Observe `el`; the gate opens when it comes within `margin` of the viewport (or at once if IO is missing). */
export function openWhenNear(id: string, el: Element | null, margin = '600px 0px'): () => void {
  const g = gateFor(id);
  if (!el || typeof IntersectionObserver === 'undefined') {
    g.open();
    return () => {};
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        g.open();
        io.disconnect();
      }
    },
    { rootMargin: margin },
  );
  io.observe(el);
  return () => io.disconnect();
}
