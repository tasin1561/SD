'use client';

import type { ReactElement } from 'react';
import { AddressCheckPanel } from '@skydrop/ui/app/address-check';
import { useOrderAddressCheck } from '@/lib/address-check-hooks';

/**
 * The address-check verdict on an order that already exists.
 *
 * Display only: no check, no re-check, no apply — the shared panel is
 * rendered `readOnly` with none of its handlers, so its suggestions are
 * plain chips and nothing on it is pressable. Reading material, never a
 * gate (FE-2): whether a verdict stops an order is the server's call.
 *
 * An order with NO stored check renders NOTHING — not a card, not a
 * heading, not an error. That is the common case (every order placed
 * before the integration existed) and the same choice the admin console
 * made, so the three consoles agree: a panel appears when there is
 * something to read and is absent when there is not. A failed read is
 * also silent, for the same reason — this is advice about a delivery,
 * and an error box about advice is worse than no advice.
 */
export function OrderAddressCheckPanel({
  orderId,
}: {
  readonly orderId: string;
}): ReactElement | null {
  const q = useOrderAddressCheck(orderId);
  if (q.data === undefined || q.data === null) return null;
  return <AddressCheckPanel result={q.data} readOnly />;
}
