'use client';

import { useState, type ReactElement } from 'react';
import { Copy, KeyRound } from 'lucide-react';
import { BandBody, Button, Input, SectionBand } from '@skydrop/ui/components';
import type { WebhookEndpointWithSecret } from '@skydrop/api-client';

/**
 * One-shot secret reveal. Displays the plaintext `secretKey` returned
 * from CREATE / ROTATE; the seller must copy it now because the
 * server NEVER returns it again. The card stays visible until the
 * seller explicitly dismisses it (clicking "I've copied it").
 *
 * It gets a band of its own rather than sitting in the register,
 * because it is not a row — it is a thing that has just happened and
 * will not happen again, and the numbered bands are the page's reading
 * order rather than its inventory.
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
      // back to manual highlight via the field below.
    }
  }

  return (
    <div>
      <SectionBand
        title={
          <span className="inline-flex items-center gap-1.5">
            <KeyRound size={12} aria-hidden /> New secret — copy it now
          </span>
        }
        note={endpoint.name ?? endpoint.url}
        action={
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            I&apos;ve copied it
          </Button>
        }
      />
      <BandBody>
        <p className="text-text-muted text-xs leading-relaxed">
          This is the only time we&apos;ll show this value. The previous secret (if any) remains
          valid for 24 hours so you can switch without dropping events.
        </p>
        <div className="mt-3 flex items-stretch gap-2">
          <Input
            readOnly
            aria-label="Webhook signing secret"
            value={endpoint.secretKey}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 font-mono"
          />
          <Button type="button" variant="primary" size="md" onClick={() => void copy()}>
            <Copy size={12} aria-hidden /> {copied ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </BandBody>
    </div>
  );
}
