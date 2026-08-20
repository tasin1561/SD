import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrderReadService } from '../../src/modules/order/services/order-read.service';

/**
 * The shape of the order snapshot an agent is shown.
 *
 * `OrderReadService.resolve` NESTS the recipient block — `recipient.name`,
 * `recipient.phoneE164` — while the database columns are flat
 * (`recipient_name`, `recipient_phone_e164`). The call-centre station
 * cast the payload, typed `unknown`, to those flat COLUMN names, so
 * every recipient field rendered "—": an agent was told to phone a
 * customer whose number the screen would not show, on the one screen
 * whose entire purpose is phoning customers.
 *
 * A cast from `unknown` type-checks against any shape at all, which is
 * precisely the check that should have caught it. Two guards, because
 * the contract has two sides and either can drift:
 *   1. the server really does nest (this would fail if resolve flattened);
 *   2. the client type declares the same nesting.
 */
describe('agent call order snapshot', () => {
  const row = {
    id: 'o1',
    orderNumber: 'SD-1',
    sellerId: 's1',
    customerId: 'c1',
    sellerOrderRef: null,
    source: 'seller_manual',
    status: 'pending_confirmation',
    isUrgent: false,
    isHighRisk: false,
    hasAdminOverride: false,
    recipientName: 'MSt Tasin',
    recipientPhoneE164: '+919876543210',
    recipientAltPhoneE164: null,
    recipientEmail: null,
    recipientAddressLine1: 'Cosmic Bags',
    recipientAddressLine2: 'Pallabi',
    recipientLandmark: null,
    recipientCity: '',
    recipientStateProvince: '',
    recipientPostalCode: '560001',
    recipientCountryCode: 'IN',
    paymentMode: 'COD',
    codAmountInr: null,
    declaredValueInr: null,
    totalWeightGrams: 1000,
    placedAt: new Date(),
    confirmedAt: null,
    cancelledAt: null,
    items: [],
  };

  it('nests the recipient — the flat column names are NOT on the payload', async () => {
    const svc = new OrderReadService({
      client: { order: { findFirst: jest.fn().mockResolvedValue(row) } },
    } as never);
    const out = await svc.getById('o1');

    // What the agent's screen must read.
    expect(out?.recipient.name).toBe('MSt Tasin');
    expect(out?.recipient.phoneE164).toBe('+919876543210');

    // What it must NOT read. This is the assertion that fails if anyone
    // "helpfully" flattens the block back onto the root.
    expect(out as unknown as Record<string, unknown>).not.toHaveProperty('recipientPhoneE164');
    expect(out as unknown as Record<string, unknown>).not.toHaveProperty('recipientName');
  });

  it('the client type declares the same nesting', () => {
    const src = readFileSync(
      join(__dirname, '../../../../packages/api-client/src/endpoints/admin-call-center.ts'),
      'utf8',
    );
    // The snapshot must be a real declared shape, never `unknown` — the
    // cast is what let the mismatch compile.
    expect(src).not.toMatch(/readonly order: unknown/);
    expect(src).toMatch(/readonly recipient: \{/);
    expect(src).toMatch(/readonly phoneE164: string/);
  });
});
