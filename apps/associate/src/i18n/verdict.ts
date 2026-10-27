import { ApiError } from '@skydrop/api-client';
import type { Translate } from '@skydrop/ui/app/i18n';
import { serverVerdict } from '@/lib/server-verdict';
import type { MessageKey } from './catalog';

/**
 * `serverVerdict` (FE-2) with this console's language on the sentences IT writes.
 *
 * `lib/server-verdict.ts` is pinned byte-identical across admin, associate,
 * reseller and seller (see `server-verdict.test.ts`), so the translation lives
 * here rather than in that file. What stays untouched, in every language:
 *
 *  - the server's own `[CODE] message` — the API owns those words and FE-2
 *    forbids paraphrasing them, so in Bangla mode a refusal still arrives in
 *    the server's English, with its code. That is correct, not a gap.
 *
 * What is translated: the fallback sentence and the one sentence the client
 * invents for a 5xx that carried no verdict at all.
 */
export function verdict(err: unknown, t: Translate<MessageKey>, fallback?: string): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | null;
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (message === '' && err.status >= 500) {
      return t('common.unreachable', { status: err.status });
    }
  }
  return serverVerdict(err, fallback ?? t('common.requestFailed'));
}
