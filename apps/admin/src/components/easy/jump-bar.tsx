import type { ReactElement } from 'react';

/**
 * A row of links to the sections of a long page. Each `id` is the id of a
 * section on the same page; the row scrolls sideways inside itself when
 * the links do not fit, so it never widens the page.
 */
export function JumpBar({
  label,
  items,
}: {
  /** Names the row for a screen reader ("Jump to a section"). */
  readonly label: string;
  readonly items: ReadonlyArray<readonly [id: string, label: string]>;
}): ReactElement {
  return (
    <nav className="ez-jump" aria-label={label}>
      {items.map(([id, text]) => (
        <a key={id} className="ez-jump__link" href={`#${id}`}>
          {text}
        </a>
      ))}
    </nav>
  );
}
