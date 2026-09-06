import type { ReactElement } from 'react';
import { Bot, Hand } from 'lucide-react';

/**
 * WHO is carrying a ticket to the courier.
 *
 * The distinction is operational, not cosmetic: only Delhivery has
 * ticket automation, so a Shiprocket or manually-placed parcel's issue
 * moves ONLY when a person moves it. A ticket that does not say so sits
 * in a queue nobody is watching, because everybody assumes software has
 * it — which is the exact failure this makes visible.
 *
 * MANUAL is the loud one, deliberately. AUTO needs nothing from anybody
 * and should read as background; MANUAL is a piece of work waiting for a
 * human, and it is the reason somebody opened this list.
 *
 * NONE renders NOTHING. A scrap ticket raised by RTO inspection has no
 * courier to be carried to — it is neither waiting on software nor on a
 * person — and a dash there would read as "unassigned".
 */
export function TicketHandlingBadge({
  handling,
}: {
  readonly handling: 'NONE' | 'AUTO' | 'MANUAL';
}): ReactElement | null {
  if (handling === 'NONE') return null;
  if (handling === 'AUTO') {
    return (
      <span
        className="text-text-muted inline-flex items-center gap-1 text-xs"
        title="Skydrop is raising this with the courier automatically"
      >
        <Bot aria-hidden className="h-3.5 w-3.5" />
        Auto
      </span>
    );
  }
  return (
    <span
      // The 'pending' status tokens, not a `warning` colour: there is no
      // such token, and Tailwind generates nothing for a colour name it
      // does not know — the class would simply do nothing, which is how
      // the courier bubbles on the ticket page ended up untinted.
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        background: 'var(--status-pending-bg)',
        color: 'var(--status-pending-fg)',
      }}
      title="No automation for this courier, or the automated attempt failed — somebody has to raise this by hand"
    >
      <Hand aria-hidden className="h-3.5 w-3.5" />
      Manual
    </span>
  );
}
