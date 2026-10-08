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
 *
 * ── A FAILURE WITH NO VERDICT IN IT IS NOT A VERDICT ────────────────
 * `ApiError`'s own `message` is built as `API <status>[ (code)]: <body
 * message>` and appends the colon whether or not there is anything after
 * it — so a 500 with an empty body arrives as the literal string
 * `"API 500: "`, and this function used to put that on screen. A dangling
 * colon and no sentence, on the one failure where somebody most needs to
 * know whether their money moved.
 *
 * Substituting a sentence there does NOT weaken FE-2, and the difference
 * is worth stating because it looks like the thing FE-2 forbids: a 5xx
 * carries no guardrail's words to show verbatim. There is nothing being
 * paraphrased and nothing being pre-empted — the server did not refuse
 * the request, it failed to answer it. A 4xx always carries a `{code,
 * message}` body from the global exception filter, and that is still
 * shown exactly as it arrives.
 *
 * The status stays visible, because "it said 502" is what makes the
 * support conversation resolvable, exactly as a code does.
 */
export function serverVerdict(err: unknown, fallback = 'Request failed.'): string {
  if (err instanceof ApiError) {
    const body = err.body as { code?: unknown; message?: unknown } | null;
    const code = typeof body?.code === 'string' ? body.code : err.code;
    const message = typeof body?.message === 'string' ? body.message.trim() : '';

    if (message !== '') {
      return code === undefined || code === '' ? message : `[${code}] ${message}`;
    }

    // Nothing to quote. Say what happened, and whether to worry.
    if (err.status >= 500) {
      return `Skydrop could not be reached just now (${err.status}). Nothing was changed — try again in a moment.`;
    }
    return code === undefined || code === ''
      ? `${fallback} (${err.status})`
      : `[${code}] ${fallback} (${err.status})`;
  }
  return err instanceof Error && err.message.trim() !== '' ? err.message : fallback;
}
