/**
 * React context for client-side auth state. Wraps:
 *   - the ApiClient (typed fetch + single-flight refresh)
 *   - the AccessTokenStore (in-memory access token, FE-1)
 *   - the current identity (hydrated by SSR via /me, then optionally
 *     refreshed on the client after a successful login mutation)
 *
 * The Provider is INTENTIONALLY thin: it does NOT poll, it does NOT
 * background-refresh, it does NOT manage redirects. Those concerns
 * live in the consuming app (apps/admin's authed layout decides
 * what to do with `notAuthenticated`).
 *
 * Identity-parameterized — the Provider takes a generic `Identity`
 * type so apps/admin can use StaffMe and apps/seller can use
 * SellerMe without ceremony. Each app exports a thin alias hook
 * around `useAuthCtx<StaffMe>()` for ergonomics.
 */
'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ApiClient, AccessTokenStore, type IdentityKind } from '@skydrop/api-client';

export interface AuthContextValue<Identity> {
  readonly client: ApiClient;
  readonly identity: Identity | null;
  readonly setIdentity: (next: Identity | null) => void;
  readonly hasAccessToken: boolean;
}

const AuthCtx = createContext<AuthContextValue<unknown> | null>(null);

export interface AuthProviderProps<Identity> {
  readonly identityKind: IdentityKind;
  /** SSR-hydrated identity (the value the Server Component resolved
   *  via the cookie→/me path). `null` means unauthenticated. */
  readonly initialIdentity: Identity | null;
  readonly children: ReactNode;
}

export function AuthProvider<Identity>(props: AuthProviderProps<Identity>): ReactElement {
  // Stable refs across re-renders: the store + client are mounted
  // exactly once per provider instance. (A nested AuthProvider would
  // get its own; apps must mount exactly one at the layout root.)
  const [store] = useState(() => new AccessTokenStore());
  const [client] = useState(
    () => new ApiClient({ identityKind: props.identityKind, tokenStore: store }),
  );
  const [identity, setIdentity] = useState<Identity | null>(props.initialIdentity);
  const [hasAccessToken, setHasAccessToken] = useState(false);

  // Reflect in-memory token presence so children can show
  // "establishing session" vs "logged in" states. Subscribed once.
  useEffect(() => {
    return store.subscribe((snap) => {
      setHasAccessToken(snap.token !== null);
    });
  }, [store]);

  const value = useMemo<AuthContextValue<Identity>>(
    () => ({ client, identity, setIdentity, hasAccessToken }),
    [client, identity, hasAccessToken],
  );

  return (
    <AuthCtx.Provider value={value as AuthContextValue<unknown>}>{props.children}</AuthCtx.Provider>
  );
}

/**
 * Typed access to the auth context. The caller asserts the Identity
 * shape (apps/admin → StaffMe; apps/seller → SellerMe). If the
 * provider isn't mounted, throws — surfaces wiring bugs immediately.
 */
export function useAuthCtx<Identity>(): AuthContextValue<Identity> {
  const v = useContext(AuthCtx);
  if (v === null) {
    throw new Error(
      '@skydrop/auth: useAuthCtx called outside <AuthProvider>. Mount one at the route-group layout root.',
    );
  }
  return v as AuthContextValue<Identity>;
}
