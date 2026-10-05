'use client';

import type { ReactElement } from 'react';
import { Link2 } from 'lucide-react';
import type { CreatedTeamInvitation } from '@skydrop/api-client';
import { RevealCard } from '../../settings/_components/settings-parts';
import { roleLine } from '@/lib/role-words';

/**
 * One-shot invitation-link reveal. The plaintext token is only
 * returned ONCE by the API; we surface it here for the seller to
 * copy + share via their preferred channel. Refreshing clears it.
 *
 * It sits above the two lists rather than inside them: it is a thing
 * that has just happened, not a standing part of the page.
 *
 * The note names EVERY role the invitation offers. `invitation.role` is
 * the legacy enum and is null whenever none of the offered roles has an
 * enum spelling — i.e. whenever the company invited somebody onto a
 * role it built itself — which printed the address followed by a bare
 * interpunct.
 */
export function InviteLinkRevealCard({
  invitation,
  onDismiss,
}: {
  readonly invitation: CreatedTeamInvitation;
  readonly onDismiss: () => void;
}): ReactElement {
  return (
    <RevealCard
      icon={<Link2 size={15} />}
      title="Invitation link — copy and share"
      note={`${invitation.email} · ${roleLine({ roleNames: invitation.roleNames })}`}
      body={`This is the only time we'll show this URL. Expires ${new Date(invitation.expiresAt).toLocaleString()}.`}
      value={invitation.inviteUrl}
      valueLabel="Invitation link"
      dismissLabel="Dismiss"
      onDismiss={onDismiss}
    />
  );
}
