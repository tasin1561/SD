'use client';

import { useState, type ReactElement } from 'react';
import { Button, Card, CardBody } from '@skydrop/ui/components';
import type { WebhookEndpointWithSecret } from '@skydrop/api-client';

/**
 * One-shot secret reveal. Displays the plaintext `secretKey` returned
 * from CREATE / ROTATE; the seller must copy it now because the
 * server NEVER returns it again. The card stays visible until the
 * seller explicitly dismisses it (clicking "I've copied it").
 */
export function SecretRevealCard({
  endpoint,
  onDismiss,
}: {
  readonly endpoint: WebhookEndpointWithSecret;
  readonly onDismiss: () => void;
}): ReactElement {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(endpoint.secretKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_500);
    } catch {
      // Clipboard write can fail (insecure context, permission); fall
      // back to manual highlight via the input below.
    }
  }

  return (
    <div className="mb-4">
      <Card>
        <CardBody>
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <div className="text-accent text-xs uppercase tracking-wide mb-1">
                New secret — copy it now
              </div>
              <div className="text-text-bright font-medium text-sm">
                {endpoint.name ?? endpoint.url}
              </div>
              <p className="text-text-muted text-xs mt-1">
                This is the only time we&apos;ll show this value. The previous secret (if any)
                remains valid for 24 hours so you can switch without dropping events.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              I&apos;ve copied it
            </Button>
          </div>
          <div className="mt-3 flex items-stretch gap-2">
            <input
              readOnly
              value={endpoint.secretKey}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 px-3 py-1.5 rounded-[5px] bg-bg border border-border text-text-bright text-sm font-mono focus:border-accent focus:outline-none"
            />
            <Button type="button" variant="primary" size="md" onClick={() => void copy()}>
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
