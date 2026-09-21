import type { ReactElement } from 'react';

/**
 * A slim strip at the very TOP of the page saying the build carries
 * placeholder content. Static and first in the body — never a floating
 * pill, which covered swatch labels, drawer buttons and hero cards in
 * every review screenshot. Rendered ONLY when
 * `NEXT_PUBLIC_PLACEHOLDER_RIBBON=1` at BUILD time (`build:preview`): under
 * `output: 'export'` that is a constant the bundler folds away, so a
 * production build carries neither the element nor the string.
 */
export function PlaceholderRibbon(): ReactElement | null {
  if (process.env.NEXT_PUBLIC_PLACEHOLDER_RIBBON !== '1') return null;
  return (
    <div
      data-placeholder-ribbon
      role="status"
      className="w-full bg-saffron-fill px-3 py-1 text-center text-[12px] font-medium text-saffron-on-fill"
    >
      Preview build — placeholder content, not published figures
    </div>
  );
}
