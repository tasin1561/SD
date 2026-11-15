'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useParams } from 'next/navigation';
import { useApiClient } from '@skydrop/auth/client';
import { CourierWhatsappMessages } from '@skydrop/ui/app/courier-whatsapp';
import { useLocale, useT } from '@/i18n/client';
import { formatDateTime } from '@/i18n/format';

interface CourierMessagesView {
  readonly enabled: boolean;
  readonly shipmentId: string | null;
  readonly lastCheckedAt: string | null;
  readonly messages: readonly { text: string; sentLabel: string; sentAt: string | null }[];
}

/**
 * The WhatsApp messages the courier sent this order's customer, read off
 * the courier's own screen. Hidden until there is at least one. The server
 * scopes the read to this console's own orders; a foreign order is a 404
 * and simply shows nothing.
 */
export function CourierWhatsappSection({
  orderId,
}: {
  readonly orderId?: string;
}): ReactElement | null {
  const t = useT();
  const locale = useLocale();
  const client = useApiClient();
  const routeId = useParams<{ id: string }>()?.id ?? '';
  const id = orderId ?? routeId;
  const q = useQuery({
    queryKey: ['seller-orders', 'courier-messages', id],
    queryFn: () => client.request<CourierMessagesView>(`/api/seller/orders/${id}/courier-messages`),
    enabled: /^[0-9a-f-]{36}$/i.test(id),
    retry: false,
  });
  const data = q.data;
  if (data === undefined) return null;
  const when = data.lastCheckedAt === null ? null : formatDateTime(data.lastCheckedAt, locale);
  if (data.messages.length === 0) return null;
  return (
    <section aria-label={t('courierWhatsapp.title')}>
      <h4 className="sk-cwa__title">{t('courierWhatsapp.title')}</h4>
      <CourierWhatsappMessages
        messages={data.messages}
        note={t('courierWhatsapp.note')}
        footer={when === null ? null : t('courierWhatsapp.checked', { when })}
      />
    </section>
  );
}
