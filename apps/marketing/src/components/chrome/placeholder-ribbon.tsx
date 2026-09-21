import type { ReactElement } from 'react';

/**
 * A thin ribbon saying the page carries placeholder content.
 *
 * Rendered ONLY when `NEXT_PUBLIC_PLACEHOLDER_RIBBON=1` at BUILD time —
 * under `output: 'export'` there is no runtime env, so this is a
 * constant the bundler folds away, and a production build carries
 * neither the element nor the string. `e2e/export.spec.ts` proves both.
 */
export function PlaceholderRibbon(): ReactElement | null {
  if (process.env.NEXT_PUBLIC_PLACEHOLDER_RIBBON !== '1') return null;
  return (
    <div
      data-placeholder-ribbon
      role="status"
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] left-1/2 z-[60] -translate-x-1/2 rounded-full border border-saffron-line bg-saffron-tint px-3 py-1 text-[12px] font-medium text-saffron-on-tint shadow-[var(--shadow-2)] md:bottom-4"
    >
      Preview build — placeholder content, not published figures
    </div>
  );
}
