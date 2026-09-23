'use client';

import type { ReactElement } from 'react';
import { Link2 } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import type { CreatedStaffInvitation } from '@skydrop/api-client';
import { AcCallout, AcRevealValue } from '../../settings/_components/ac-parts';

/**
 * One-shot invitation-link reveal. The plaintext token is only
 * returned ONCE by the API; we surface it here for the operator to
 * copy + share via their preferred channel (Slack/email/etc.).
 * Refreshing the page clears it.
 */
export function InviteLinkRevealCard({
  invitation,
  onDismiss,
}: {
  readonly invitation: CreatedStaffInvitation;
  readonly onDismiss: () => void;
}): ReactElement {
  return (
    <section className="ac-card" data-tone="warn" aria-live="polite">
      <div className="ac-card__head">
        <div className="ac-card__titles">
          <h2 className="ac-card__title">Invitation link — copy + share</h2>
          <div className="ac-text">
            {invitation.email} <span className="ac-faint">· {invitation.role}</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      <AcCallout tone="warn" icon={<Link2 size={15} />}>
        This is the only time we&apos;ll show this URL. Expires{' '}
        {new Date(invitation.expiresAt).toLocaleString()}.
      </AcCallout>
      <AcRevealValue value={invitation.inviteUrl} label="Invitation link" />
    </section>
  );
}
