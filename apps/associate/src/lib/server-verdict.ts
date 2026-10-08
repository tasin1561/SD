import { ApiError } from '@skydrop/api-client';

/**
 * FE-2 — render the server's verdict VERBATIM as `[CODE] message`.
 *
 * The server is the security boundary; the UI is reading material. When
 * a guardrail refuses something, the operator sees the guardrail's own
 * words and its machine code — never a paraphrase, and never a
 * client-side prediction of what the server would have said. The code
 * is what makes a support conversation ("it says
 * RTO_RESTOCK_WAREHOUSE_MISMATCH") resolvable.
 *
 * This was open-coded in a dozen components before it was extracted;
 * new call sites should use it rather than re-deriving the shape.
 */
export function serverVerdict(err: unknown, fallback = 'Request failed.'): string {
  if (err instanceof ApiError) {
    const body = err.body as { code?: unknown; message?: unknown } | null;
    const code = typeof body?.code === 'string' ? body.code : err.code;
    const message = typeof body?.message === 'string' ? body.message : err.message;
    return code === undefined || code === '' ? message : `[${code}] ${message}`;
  }
  return err instanceof Error ? err.message : fallback;
}
