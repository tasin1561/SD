'use client';

import type { ReactElement } from 'react';
import { Link2 } from 'lucide-react';
import type { CreatedTeamInvitation } from '@skydrop/api-client';
import { RevealCard } from '../../settings/_components/settings-parts';
import { roleLine } from '@/lib/role-words';
import { useT, useLocale } from '@/i18n/client';
import { dateTag } from '@/i18n/format';

/**
 * One-shot invitation-link reveal. The plaintext token is only
 * returned ONCE by the API; we surface it here for the seller to
 * copy + share via their preferred channel. Refreshing clears it.
 *
 * It sits above the two lists rather than inside them: it is a thing
 * that has just happened, not a standing part of the page.
 *
 * The note names EVERY role the invitation offers. The single field
 * that used to hold "the role" was null whenever none of the offered
 * roles had an enum spelling — i.e. whenever the company invited
 * somebody onto a role it built itself — which printed the address
 * followed by a bare interpunct.
 */
export function InviteLinkRevealCard({
  invitation,
  onDismiss,
}: {
  readonly invitation: CreatedTeamInvitation;
  readonly onDismiss: () => void;
}): ReactElement {
  const locale = useLocale();
  const t = useT();
  return (
    <RevealCard
      icon={<Link2 size={15} />}
      title={t('team.invitationLinkCopyAnd')}
      note={`${invitation.email} · ${roleLine({ roleNames: invitation.roleNames }, t('roleWords.noRole'))}`}
      body={t('team.thisIsTheOnly', {
        expiresAt: new Date(invitation.expiresAt).toLocaleString(dateTag(locale)),
      })}
      value={invitation.inviteUrl}
      valueLabel={t('team.invitationLink')}
      dismissLabel={t('team.dismiss')}
      onDismiss={onDismiss}
    />
  );
}
