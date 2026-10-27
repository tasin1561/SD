'use client';

import type { ReactElement } from 'react';
import { KeyRound } from 'lucide-react';
import type { WebhookEndpointWithSecret } from '@skydrop/api-client';
import { RevealCard } from '../../_components/settings-parts';
import { useT } from '@/i18n/client';

/**
 * One-shot secret reveal. Displays the plaintext `secretKey` returned
 * from CREATE / ROTATE; the seller must copy it now because the
 * server NEVER returns it again. The card stays visible until the
 * seller explicitly dismisses it (clicking "I've copied it").
 *
 * It sits above the endpoint list rather than inside it, because it is
 * not a row — it is a thing that has just happened and will not happen
 * again.
 */
export function SecretRevealCard({
  endpoint,
  onDismiss,
}: {
  readonly endpoint: WebhookEndpointWithSecret;
  readonly onDismiss: () => void;
}): ReactElement {
  const t = useT();
  return (
    <RevealCard
      icon={<KeyRound size={15} />}
      title={t('settingsWebhooks.newSecretCopyIt')}
      note={endpoint.name ?? endpoint.url}
      body={t('settingsWebhooks.thisIsTheOnly')}
      value={endpoint.secretKey}
      valueLabel={t('settingsWebhooks.webhookSigningSecret')}
      dismissLabel={t('settingsWebhooks.iVeCopiedIt')}
      onDismiss={onDismiss}
    />
  );
}
