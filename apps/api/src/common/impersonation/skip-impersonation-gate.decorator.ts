import { SetMetadata } from '@nestjs/common';

export const SKIP_IMPERSONATION_GATE_KEY = 'skipImpersonationGate';

/**
 * Exempts a route from `ImpersonationGuard`.
 *
 * ── THERE IS EXACTLY ONE LEGITIMATE USE ─────────────────────────────
 * The exchange endpoints, which are how a support session BEGINS. They
 * have to be reachable while the browser is still holding the cookie of
 * a session that has ended or expired — otherwise the last visit locks
 * the support engineer out of the next one, and the only way back is
 * clearing cookies by hand.
 *
 * It does NOT exempt anything from the deny list in any other sense: an
 * exchange request changes nothing in the subject's account, which is
 * the only reason skipping the gate on it is safe. Putting this on an
 * endpoint that touches a seller's data would make that endpoint
 * reachable from a read-only session, and no reason to want that has
 * ever turned out to be a good one.
 */
export const SkipImpersonationGate = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_IMPERSONATION_GATE_KEY, true);
