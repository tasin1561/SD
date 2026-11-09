'use client';

import type { ReactElement } from 'react';
import { AddressCheckPanel } from '@skydrop/ui/app/address-check';
import { useOrderAddressCheck } from '@/lib/address-check-hooks';

/**
 * Shadow-mode verdict on an existing order. Display only: no check, no
 * apply, no confirm — the shared panel is rendered `readOnly` with none
 * of its handlers. An order with no stored check (the common case) or a
 * failed read renders nothing rather than an empty card.
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
