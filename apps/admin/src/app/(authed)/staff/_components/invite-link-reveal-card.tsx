'use client';

import type { ReactElement } from 'react';
import { Link2 } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import type { CreatedStaffInvitation } from '@skydrop/api-client';
import { AcCallout, AcRevealValue } from '../../settings/_components/ac-parts';
import { useT } from '@/i18n/client';

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
  const t = useT();
  return (
    <section className="ac-card" data-tone="warn" aria-live="polite">
      <div className="ac-card__head">
        <div className="ac-card__titles">
          <h2 className="ac-card__title">
            {t('staffInviteLinkRevealCard.invitationLinkCopyShare')}
          </h2>
          <div className="ac-text">
            {invitation.email}{' '}
            {/* Every role the invitation offers. Naming one of them
                would be naming one of several, and the field that used
                to hold "the role" printed "null" for an access tier and
                for anything invented here anyway. */}
            <span className="ac-faint">· {invitation.roleNames.join(', ')}</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          {t('staffInviteLinkRevealCard.dismiss')}
        </Button>
      </div>
      <AcCallout tone="warn" icon={<Link2 size={15} />}>
        {t('staffInviteLinkRevealCard.thisIsTheOnlyTime', {
          value: new Date(invitation.expiresAt).toLocaleString(),
        })}
      </AcCallout>
      <AcRevealValue
        value={invitation.inviteUrl}
        label={t('staffInviteLinkRevealCard.invitationLink')}
      />
    </section>
  );
}
