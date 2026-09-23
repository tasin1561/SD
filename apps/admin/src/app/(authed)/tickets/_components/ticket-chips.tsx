import { Bot, Hand } from 'lucide-react';
import type { ReactElement } from 'react';
import type { TicketStatus } from '@skydrop/db';
import { ticketStatusKind, ticketStatusLabel } from '@skydrop/ui/status';
import { StatusChip } from '@skydrop/ui/app/status-chip';

/** The ticket's status: kind and word from `@skydrop/ui/status`, unchanged. */
export function TicketStatusChip({
  status,
  size,
}: {
  readonly status: TicketStatus;
  readonly size?: 'sm' | 'md';
}): ReactElement {
  return (
    <StatusChip
      kind={ticketStatusKind(status)}
      label={ticketStatusLabel(status)}
      size={size ?? 'md'}
    />
  );
}

/**
 * WHO is carrying a ticket — the same three answers and the same titles
 * as the legacy handling badge. NONE draws nothing: a scrap ticket has no
 * courier to be carried to.
 */
export function TicketHandlingChip({
  handling,
}: {
  readonly handling: 'NONE' | 'AUTO' | 'MANUAL';
}): ReactElement | null {
  if (handling === 'NONE') return null;
  if (handling === 'AUTO') {
    return (
      <span className="tk-handling" title="Skydrop is raising this with the courier automatically">
        <Bot size={14} aria-hidden />
        Auto
      </span>
    );
  }
  return (
    <span
      className="tk-handling"
      data-manual="1"
      title="No automation for this courier, or the automated attempt failed — somebody has to raise this by hand"
    >
      <Hand size={14} aria-hidden />
      Manual
    </span>
  );
}
