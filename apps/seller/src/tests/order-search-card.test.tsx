/**
 * One omnisearch match, as a card. Pins the eight facts, the quiet
 * "not dispatched" state, and CUR-8: a manually-placed parcel shows the
 * real courier's name, never the literal `manual`.
 */
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import type { OrderListItem } from '@skydrop/api-client';

import { OrderSearchCard } from '@/app/(authed)/_components/order-search-card';
import { renderWithProviders } from './helpers';

const base = {
  id: 'o-1',
  orderNumber: 'SD-2026-26-000001',
  status: 'DISPATCHED',
  recipientName: 'Asha Rao',
  recipientPhoneE164: '+919800000000',
  placedAt: '2026-10-20T10:00:00.000Z',
  totalWeightGrams: 400,
} as unknown as OrderListItem;

const shipment = {
  awbNumber: 'AWB123456',
  courierCode: 'delhivery',
  courierDisplayName: 'Delhivery',
  manualCourierName: null,
  weightGrams: 1250,
  lengthCm: 10,
  widthCm: 8.5,
  heightCm: 5,
};

function renderCard(order: OrderListItem): void {
  renderWithProviders(<OrderSearchCard order={order} statusText="dispatched" />);
}

describe('OrderSearchCard', () => {
  it('shows all eight facts for an order with a parcel', () => {
    renderCard({ ...base, shipment } as OrderListItem);
    expect(screen.getByText('Asha Rao')).toBeTruthy();
    expect(screen.getByText('+919800000000')).toBeTruthy();
    expect(screen.getByText('SD-2026-26-000001')).toBeTruthy();
    expect(screen.getByText('20 Oct 2026')).toBeTruthy();
    expect(screen.getByText('dispatched')).toBeTruthy();
    expect(screen.getByText('1.25 kg')).toBeTruthy();
    expect(screen.getByText('10 × 8.5 × 5 cm')).toBeTruthy();
    expect(screen.getByText('AWB123456')).toBeTruthy();
    expect(screen.getByText('Delhivery')).toBeTruthy();
  });

  it('renders an order with no parcel quietly, without AWB, courier or size', () => {
    renderCard({ ...base, shipment: null } as OrderListItem);
    expect(screen.getByText('Not dispatched yet')).toBeTruthy();
    expect(screen.queryByText('Courier')).toBeNull();
    expect(screen.queryByText('AWB')).toBeNull();
    expect(screen.queryByText('Size')).toBeNull();
    expect(screen.getByText('400 g')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/null|undefined/);
  });

  it('names the real courier for a manually-placed parcel, never "manual" (CUR-8)', () => {
    renderCard({
      ...base,
      shipment: {
        ...shipment,
        courierCode: 'manual',
        courierDisplayName: 'Manual',
        manualCourierName: 'Pathao',
      },
    } as OrderListItem);
    expect(screen.getByText('Pathao')).toBeTruthy();
    expect(screen.queryByText(/^manual$/i)).toBeNull();
  });
});
