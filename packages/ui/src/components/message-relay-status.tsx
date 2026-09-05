import type { ReactElement } from 'react';
import { Check, CheckCheck } from 'lucide-react';

/**
 * TKT-2 — where one of the seller's ticket messages has got to.
 *
 * Two states, and the distinction is the whole point: SENT means the
 * words are with us; DELIVERED means an operator has passed them to the
 * courier. A seller asking "have you told them yet?" is asking exactly
 * this, and before it existed the only honest answer was to go and look
 * at the courier thread.
 *
 * ONE component, rendered on both sides, so the seller and the operator
 * are reading the same words about the same message. Two copies would
 * drift on the wording, and "Sent" meaning different things in the two
 * apps is worse than not showing it at all.
 *
 * Deliberately quiet: 11px, one tick or two. This sits under every
 * message the seller ever writes, so it has to be readable when looked
 * for and invisible when not — the same reason a messaging app puts it
 * there and at that size, and the reason the ticks read the way they do
 * everywhere else (one grey, two coloured).
 */
export function MessageRelayStatus({
  relayedAt,
}: {
  readonly relayedAt: string | null;
}): ReactElement {
  if (relayedAt === null) {
    return (
      <span className="text-text-muted inline-flex items-center gap-1 text-[11px]">
        <Check aria-hidden className="h-3 w-3" />
        Sent
      </span>
    );
  }
  const at = new Date(relayedAt);
  return (
    <span
      className="text-accent inline-flex items-center gap-1 text-[11px]"
      title={`Passed to the courier on ${at.toLocaleString('en-IN')}`}
    >
      <CheckCheck aria-hidden className="h-3 w-3" />
      Delivered ·{' '}
      {at.toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })}
    </span>
  );
}
