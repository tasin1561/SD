import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SellerStoreKind } from '@skydrop/db';
import {
  HIDDEN_RECIPIENT_NAME,
  maskResellerRecipient,
} from '../../src/modules/order/reseller-privacy';

/**
 * RS-5 (ORD-7 generalised) — the ONE place a reseller store customer's
 * identity is taken off an order before its SELLER reads it.
 */
describe('maskResellerRecipient (RS-5)', () => {
  const full = {
    id: 'o1',
    orderNumber: 'SD-2026-26-000001',
    customerId: 'c1',
    recipientName: 'Asha Verma',
    recipientPhoneE164: '+919876543210',
    recipientAltPhoneE164: '+919812345678',
    recipientEmail: 'asha@example.com',
    recipientAddressLine1: '12 MG Road',
    recipientAddressLine2: 'Near City Hospital',
    recipientLandmark: 'Opposite the temple',
    recipientCity: 'Bengaluru',
    recipientStateProvince: 'Karnataka',
    recipientPostalCode: '560001',
    recipientCountryCode: 'IN',
  };

  it('a CHANNEL order passes through untouched', () => {
    const out = maskResellerRecipient({ ...full, storeKind: SellerStoreKind.CHANNEL });
    expect(out).toEqual({ ...full, storeKind: SellerStoreKind.CHANNEL, recipientMasked: false });
  });

  it('a RESELLER order loses who it is going to, and keeps where it is going', () => {
    const out = maskResellerRecipient({ ...full, storeKind: SellerStoreKind.RESELLER });
    expect(out.recipientMasked).toBe(true);
    expect(out.recipientName).toBe(HIDDEN_RECIPIENT_NAME);
    expect(out.recipientPhoneE164).toBe('');
    expect(out.recipientAltPhoneE164).toBeNull();
    expect(out.recipientEmail).toBeNull();
    expect(out.recipientAddressLine1).toBe('');
    expect(out.recipientAddressLine2).toBeNull();
    expect(out.recipientLandmark).toBeNull();
    expect(out.customerId).toBeNull();
    // Where it is going stays: the seller's stock and courier depend on it.
    expect(out.recipientCity).toBe('Bengaluru');
    expect(out.recipientStateProvince).toBe('Karnataka');
    expect(out.recipientPostalCode).toBe('560001');
    expect(out.recipientCountryCode).toBe('IN');
    // Nothing of the original identity survives anywhere in the object.
    const text = JSON.stringify(out);
    for (const secret of ['Asha', '9876543210', '9812345678', 'asha@', 'MG Road', 'temple']) {
      expect(text).not.toContain(secret);
    }
  });

  it('does not ADD fields a projection did not carry', () => {
    const out = maskResellerRecipient({
      storeKind: SellerStoreKind.RESELLER,
      recipientName: 'Asha',
      recipientCity: 'Pune',
    });
    expect(Object.keys(out).sort()).toEqual(
      ['recipientCity', 'recipientMasked', 'recipientName', 'storeKind'].sort(),
    );
  });

  it('is applied on EVERY seller read of an order (list, detail, cancel response)', () => {
    // Structural: the seller controller must never hand back the unmasked
    // mutators' load. A source scan, because a behavioural test would need
    // every seller endpoint enumerated and would miss a new one.
    const src = readFileSync(
      join(__dirname, '../../src/modules/order/controllers/seller-order.controller.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/this\.svc\.loadOwned\(/);
    const svc = readFileSync(
      join(__dirname, '../../src/modules/order/services/order.service.ts'),
      'utf8',
    );
    expect(svc).toMatch(/maskResellerRecipient\(await this\.loadOwned\(sellerId, id\)\)/);
    expect(svc).toMatch(/items: items\.map\(\(o\) => maskResellerRecipient\(o\)\)/);
  });
});
