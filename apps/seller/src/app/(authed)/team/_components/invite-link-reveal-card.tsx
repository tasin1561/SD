'use client';

import { useState, type ReactElement } from 'react';
import { Copy, Link2 } from 'lucide-react';
import { BandBody, Button, Input, SectionBand } from '@skydrop/ui/components';
import type { CreatedTeamInvitation } from '@skydrop/api-client';

/**
 * One-shot invitation-link reveal. The plaintext token is only
 * returned ONCE by the API; we surface it here for the seller to
 * copy + share via their preferred channel. Refreshing clears it.
 *
 * Unnumbered on purpose: the page's `01` and `02` bands are its two
 * standing registers, and this is a thing that has just happened.
 * Numbering it would renumber the page every time somebody invites
 * somebody.
 */
export function InviteLinkRevealCard({
  invitation,
  onDismiss,
}: {
  readonly invitation: CreatedTeamInvitation;
  readonly onDismiss: () => void;
}): ReactElement {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(invitation.inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_500);
    } catch {
      // Clipboard may fail in insecure context; URL is still selectable.
    }
  }

  return (
    <div>
      <SectionBand
        title={
          <span className="inline-flex items-center gap-1.5">
            <Link2 size={12} aria-hidden /> Invitation link — copy and share
          </span>
        }
        note={`${invitation.email} · ${invitation.role}`}
        action={
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        }
      />
      <BandBody>
        <p className="text-text-muted text-xs leading-relaxed">
          This is the only time we&apos;ll show this URL. Expires{' '}
          {new Date(invitation.expiresAt).toLocaleString()}.
        </p>
        <div className="mt-3 flex items-stretch gap-2">
          <Input
            readOnly
            aria-label="Invitation link"
            value={invitation.inviteUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 font-mono"
          />
          <Button type="button" variant="primary" size="md" onClick={() => void copy()}>
            <Copy size={12} aria-hidden /> {copied ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </BandBody>
    </div>
  );
}
