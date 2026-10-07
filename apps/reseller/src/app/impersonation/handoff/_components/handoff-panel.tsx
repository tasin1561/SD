'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { AccessTokenStore, ApiClient, type ImpersonationSessionView } from '@skydrop/api-client';
import { ButtonLink } from '@skydrop/ui/app/button';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Spends the handoff token for a session cookie, then leaves.
 *
 * Same shape as `VerifyEmailPanel`: act on mount, because the staff
 * member already expressed intent by verifying the code, and a second
 * click would add nothing. FE-2 — the server's verdict is shown
 * verbatim.
 *
 * ── WHY IT RUNS EXACTLY ONCE ────────────────────────────────────────
 * The token is single-use and lives sixty seconds. React double-invokes
 * effects in development, and the second run would spend a token that
 * had already been burned and show "UNAUTHORIZED" for a handoff that in
 * fact worked. The ref guard is not tidiness; it is the difference
 * between the feature working in dev and appearing broken.
 *
 * ── AND WHY THE FRAGMENT IS CLEARED FIRST ───────────────────────────
 * From the moment the request is in flight the token is either spent or
 * useless, and in both cases it has no business sitting in the address
 * bar — readable over a shoulder, and in whatever the browser syncs.
 * The onward navigation is a `replace` for the same reason: Back must
 * not return to a URL whose fragment still carries it.
 */
export function HandoffPanel(): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const token = tokenFromFragment(window.location.hash);
    if (token === null) {
      setError(
        'This link has no handoff token in it. Links are single-use and good for one minute, so open the session again from the staff console rather than re-using this address.',
      );
      return;
    }
    window.history.replaceState(null, '', window.location.pathname);

    void (async () => {
      try {
        const client = new ApiClient({
          identityKind: 'store',
          tokenStore: new AccessTokenStore(),
        });
        // The cookie the API sets comes back through the same-origin
        // proxy, so it is bound to THIS origin — which is the only way a
        // `__Host-` cookie can be set for the reseller app at all. The
        // endpoint is `@Public`: the token IS the credential, and the
        // empty token store above is the honest statement that this
        // browser has no store login.
        await client.request<ImpersonationSessionView>('/api/auth/store/impersonation/exchange', {
          method: 'POST',
          body: { handoffToken: token },
        });
        window.location.replace('/dashboard');
      } catch (err) {
        setError(serverVerdict(err, 'The support session could not be opened.'));
      }
    })();
  }, []);

  if (error === null) {
    return (
      <p className="text-text-muted text-xs" role="status">
        Opening… do not reload this page.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div
        role="alert"
        className="text-critical border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] rounded-[var(--radius-2)] border px-2.5 py-1.5 text-xs"
      >
        {error}
      </div>
      <p className="text-text-muted text-xs">
        Nothing has been opened in anybody&rsquo;s account. Go back to the staff console and start
        the session again — the reason you typed is already recorded, so a reviewer will see the
        attempt either way.
      </p>
      <ButtonLink href="/login" variant="secondary" fullWidth>
        Store sign-in
      </ButtonLink>
    </div>
  );
}

/**
 * The token out of `#token=…`.
 *
 * `URLSearchParams` rather than a split, so a fragment carrying anything
 * else alongside it still works and the value is percent-decoded exactly
 * the way the API encoded it.
 */
function tokenFromFragment(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw === '') return null;
  const token = new URLSearchParams(raw).get('token');
  return token === null || token === '' ? null : token;
}
