import type { ReactElement } from 'react';

/**
 * WHICH problem this is, in the courier's own vocabulary — the category
 * the seller picked when they raised it, and the subcategory under it.
 *
 * Sits under the ticket TYPE rather than in a field of its own: "seller
 * raised issue" says who is asking, and this says what about. Read
 * apart they are two half-answers; read together they are the sentence
 * an operator needs before opening the conversation.
 *
 * STACKED, not joined by a chevron on one line. Delhivery's own labels
 * run to eighty characters — "Reattempt or Delay in delivery /
 * consignee pickup / return" — and two of them inline in a third-width
 * column wrap into an unreadable block. On their own lines, with the
 * child indented under its parent, the shape says "inside" without
 * costing a word.
 *
 * Renders NOTHING when there is no category — a ticket raised before
 * the taxonomy existed, or one we opened ourselves off an RTO
 * inspection. An empty "—" would suggest somebody failed to fill
 * something in, when nobody was ever asked.
 */
export function IssueCategoryLine({
  categoryLabel,
  subcategoryLabel,
}: {
  readonly categoryLabel: string | null;
  readonly subcategoryLabel: string | null;
}): ReactElement | null {
  if (categoryLabel === null && subcategoryLabel === null) return null;
  return (
    <span className="mt-0.5 block text-xs">
      {categoryLabel === null ? null : (
        <span className="text-text-muted block">{categoryLabel}</span>
      )}
      {subcategoryLabel === null ? null : (
        <span className="text-text-body block">
          <span aria-hidden className="text-text-faint pr-1">
            ›
          </span>
          {subcategoryLabel}
        </span>
      )}
    </span>
  );
}
