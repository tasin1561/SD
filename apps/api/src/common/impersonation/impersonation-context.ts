import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who is really behind this request, carried for the length of it.
 *
 * ── WHY AMBIENT AND NOT A PARAMETER ─────────────────────────────────
 * `AuditLogService.log` is called from roughly two hundred places. If
 * each had to pass "and a staff member was impersonating", the ones that
 * forgot would write a row saying the SELLER did it — which is precisely
 * the row that must never exist, and the failure would be silent and
 * permanent (`audit_logs` is append-only: MUST NOT #3, there is no
 * correcting it afterwards).
 *
 * So the guard puts it here once, and the single audit writer reads it.
 * A caller cannot forget something it never has to remember, and a new
 * audited action inherits the behaviour by existing.
 *
 * ── WHY `AsyncLocalStorage` AND NOT A REQUEST-SCOPED PROVIDER ────────
 * A request-scoped Nest provider would make every service that touches
 * auditing request-scoped too, which is most of them — Nest rebuilds the
 * whole subtree per request and the queue workers, which have no
 * request, could not inject it at all. ALS crosses `await` boundaries
 * without changing a single constructor, and a worker simply reads
 * `null`, which is the truth: nobody is impersonating a cron.
 */
export interface ImpersonationContext {
  /** `impersonation_sessions.id`. */
  readonly sessionId: string;
  /** The staff member actually at the keyboard. */
  readonly staffUserId: string;
  /** Whose account they are inside. */
  readonly subject: { readonly kind: 'SELLER' | 'STORE'; readonly id: string };
  readonly mayWrite: boolean;
}

const storage = new AsyncLocalStorage<ImpersonationContext>();

/** Run `fn` with this request marked as impersonated. */
export function runImpersonated<T>(ctx: ImpersonationContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * The session behind this request, or null for every ordinary one.
 *
 * Null is the overwhelmingly common answer and means exactly what it
 * says: a real seller, a real store user, a staff member on their own
 * console, or a background job.
 */
export function currentImpersonation(): ImpersonationContext | null {
  return storage.getStore() ?? null;
}
