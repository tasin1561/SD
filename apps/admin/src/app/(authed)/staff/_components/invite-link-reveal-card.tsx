'use client';

import { useState, type ReactElement } from 'react';
import { Button, Card, CardBody } from '@skydrop/ui/components';
import type { CreatedStaffInvitation } from '@skydrop/api-client';

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
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(invitation.inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_500);
    } catch {
      // Clipboard may fail (insecure context); URL is still selectable.
    }
  }

  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <div className="text-accent text-xs uppercase tracking-wide mb-1">
              Invitation link — copy + share
            </div>
            <div className="text-text-bright font-mono text-sm">
              {invitation.email} <span className="text-text-muted">· {invitation.role}</span>
            </div>
            <p className="text-text-muted text-xs mt-1">
              This is the only time we&apos;ll show this URL. Expires{' '}
              {new Date(invitation.expiresAt).toLocaleString()}.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
        <div className="mt-3 flex items-stretch gap-2">
          <input
            readOnly
            value={invitation.inviteUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 px-3 py-1.5 rounded-[5px] bg-bg border border-border text-text-bright text-sm font-mono focus:border-accent focus:outline-none"
          />
          <Button type="button" variant="primary" size="md" onClick={() => void copy()}>
            {copied ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
