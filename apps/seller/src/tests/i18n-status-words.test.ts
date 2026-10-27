import { describe, expect, it } from 'vitest';
import {
  BulkUploadStatus,
  DeliveryActionStatus,
  OrderStatus,
  ShipmentStatus,
  TicketStatus,
} from '@skydrop/db';
import {
  deliveryActionStatusLabel,
  statusLabel,
  STATUS_LABEL_BN,
  STATUS_LABEL_BN_SOURCES,
  ticketStatusLabel,
  uploadStatusLabel,
} from '@skydrop/ui/status';

/*
  Status wording is translated in ONE place, `@skydrop/ui/status`, and never
  per component. These pin the three things that can go wrong there:
  English changing under an existing caller, a value with no Bangla, and two
  enums that share a value (PENDING, REJECTED, PICKED …) reading two ways.
*/
const BENGALI_DIGIT = /[০-৯]/;

describe('status labels', () => {
  it('leave English exactly as it was when no locale is passed', () => {
    expect(statusLabel(OrderStatus.OUT_FOR_DELIVERY)).toBe('Out For Delivery');
    expect(statusLabel(OrderStatus.AWAITING_SELLER_DECISION)).toBe('Awaiting client decision');
    expect(ticketStatusLabel(TicketStatus.RESOLVED_REFUND)).toBe('Closed · refunded');
    expect(uploadStatusLabel(BulkUploadStatus.COMPLETED_WITH_ERRORS)).toBe(
      'Done, some rows failed',
    );
    expect(deliveryActionStatusLabel(DeliveryActionStatus.EXPIRED)).toBe('Not answered in time');
    expect(statusLabel(OrderStatus.DELIVERED, 'en')).toBe(statusLabel(OrderStatus.DELIVERED));
  });

  it('give every order, shipment, ticket, upload and delivery-action status a Bangla word', () => {
    const all: string[] = [];
    for (const v of Object.values(OrderStatus)) all.push(statusLabel(v, 'bn'));
    for (const v of Object.values(ShipmentStatus)) all.push(statusLabel(v, 'bn'));
    for (const v of Object.values(TicketStatus)) all.push(ticketStatusLabel(v, 'bn'));
    for (const v of Object.values(BulkUploadStatus)) all.push(uploadStatusLabel(v, 'bn'));
    for (const v of Object.values(DeliveryActionStatus))
      all.push(deliveryActionStatusLabel(v, 'bn'));
    for (const w of all) {
      expect(w.trim()).not.toBe('');
      expect(BENGALI_DIGIT.test(w)).toBe(false);
      // Bangla, not a derived English word: it carries at least one Bengali letter.
      expect(/[ঀ-৿]/.test(w), w).toBe(true);
    }
  });

  it('read a value that several enums share the same way in all of them', () => {
    const seen = new Map<string, string>();
    for (const table of STATUS_LABEL_BN_SOURCES) {
      for (const [value, word] of Object.entries(table)) {
        const prior = seen.get(value);
        // CANCELLED/REJECTED etc. must not mean two things; ticket generic words are the
        // only sanctioned difference and they are never a shared value.
        if (prior !== undefined) expect(word, value).toBe(prior);
        seen.set(value, word);
      }
    }
    expect(Object.keys(STATUS_LABEL_BN).length).toBe(seen.size);
  });
});
