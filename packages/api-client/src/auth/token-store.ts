/**
 * In-memory access token store. Module-scope state — NEVER persisted
 * to localStorage / sessionStorage / IndexedDB (FE-1). XSS-exfiltrating
 * code cannot reach this; on a page reload the store is empty and the
 * SSR cookie→/me path (packages/auth) re-hydrates identity.
 *
 * Identity-parameterized: a single store instance handles ONE
 * identity (staff OR seller), not both. apps/admin instantiates one
 * for staff; apps/seller will instantiate one for seller. The store
 * doesn't know which identity it is — that's the consumer's
 * responsibility.
 *
 * Subscription model: TanStack Query (and any other UI consumer) can
 * subscribe to know when the token changes (e.g., after a refresh,
 * or after logout). This is how the UI knows to reflect "logged in"
 * state without polling.
 */

export interface AccessTokenSnapshot {
  readonly token: string | null;
  readonly expiresAt: number | null; // epoch ms
}

export type AccessTokenListener = (snapshot: AccessTokenSnapshot) => void;

export class AccessTokenStore {
  private token: string | null = null;
  private expiresAt: number | null = null;
  private readonly listeners = new Set<AccessTokenListener>();

  get(): AccessTokenSnapshot {
    return { token: this.token, expiresAt: this.expiresAt };
  }

  /** Replace the token; broadcast the change. expiresAt in epoch ms. */
  set(token: string | null, expiresAt: number | null): void {
    this.token = token;
    this.expiresAt = expiresAt;
    this.emit();
  }

  /** Clear on logout / refresh failure. */
  clear(): void {
    this.set(null, null);
  }

  /**
   * Subscribe to token changes. Returns an unsubscribe fn. Used by
   * the React `useAuth()` hook (packages/auth) to re-render on
   * silent-refresh-completed events.
   */
  subscribe(listener: AccessTokenListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * True if the current token is non-null and not within `bufferMs`
   * of its expiry. Use as a pre-emptive check before firing a
   * request whose round-trip would race the expiry; not required
   * for correctness (the on-401 path handles real expiry).
   */
  isFresh(bufferMs = 5_000): boolean {
    if (this.token === null || this.expiresAt === null) return false;
    return this.expiresAt - Date.now() > bufferMs;
  }

  private emit(): void {
    const snapshot = this.get();
    for (const l of this.listeners) {
      try {
        l(snapshot);
      } catch {
        // Listener faults must not poison the store; swallow.
      }
    }
  }
}
