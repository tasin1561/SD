import { ResellerCreditTrigger } from '@skydrop/db';
import {
  TermsRuleError,
  assertTiming,
  creditTriggerLabel,
  percentWords,
  shareWords,
  timingWords,
  usesAfterConfirmation,
} from '../../src/modules/reseller-store-terms/terms/terms-rules';

describe('reseller terms rules (RS-4)', () => {
  const code = (fn: () => unknown): string => {
    try {
      fn();
    } catch (err) {
      return err instanceof TermsRuleError ? err.code : 'OTHER';
    }
    return 'NONE';
  };

  it('accepts every trigger with sensible days', () => {
    expect(
      code(() => assertTiming({ trigger: ResellerCreditTrigger.ON_PAYOUT, days: 0 }, 'store')),
    ).toBe('NONE');
    expect(
      code(() => assertTiming({ trigger: ResellerCreditTrigger.ON_PAYOUT, days: 3 }, 'store')),
    ).toBe('NONE');
    expect(
      code(() =>
        assertTiming({ trigger: ResellerCreditTrigger.AFTER_DELIVERY, days: 7 }, 'seller'),
      ),
    ).toBe('NONE');
    expect(
      code(() => assertTiming({ trigger: ResellerCreditTrigger.INSTANT, days: 0 }, 'seller')),
    ).toBe('NONE');
    expect(
      code(() =>
        assertTiming({ trigger: ResellerCreditTrigger.AFTER_CONFIRMATION, days: 0 }, 'store'),
      ),
    ).toBe('NONE');
    expect(
      code(() => assertTiming({ trigger: ResellerCreditTrigger.ON_PAYOUT, days: 365 }, 'store')),
    ).toBe('NONE');
  });

  it('refuses days outside 0–365 or not whole', () => {
    expect(
      code(() => assertTiming({ trigger: ResellerCreditTrigger.ON_PAYOUT, days: -1 }, 'store')),
    ).toBe('CREDIT_DAYS_INVALID');
    expect(
      code(() => assertTiming({ trigger: ResellerCreditTrigger.ON_PAYOUT, days: 366 }, 'store')),
    ).toBe('CREDIT_DAYS_INVALID');
    expect(
      code(() => assertTiming({ trigger: ResellerCreditTrigger.ON_PAYOUT, days: 1.5 }, 'store')),
    ).toBe('CREDIT_DAYS_INVALID');
  });

  it('INSTANT takes no days; AFTER_DELIVERY needs at least one (zero would be Instant without its fee)', () => {
    expect(
      code(() => assertTiming({ trigger: ResellerCreditTrigger.INSTANT, days: 2 }, 'store')),
    ).toBe('INSTANT_TAKES_NO_DAYS');
    expect(
      code(() => assertTiming({ trigger: ResellerCreditTrigger.AFTER_DELIVERY, days: 0 }, 'store')),
    ).toBe('AFTER_DELIVERY_NEEDS_DAYS');
  });

  it('refuses a trigger that is not one', () => {
    expect(
      code(() => assertTiming({ trigger: 'SOMETIME' as ResellerCreditTrigger, days: 0 }, 'store')),
    ).toBe('CREDIT_TRIGGER_INVALID');
  });

  it('knows when a version fronts money after confirmation', () => {
    expect(
      usesAfterConfirmation([
        { trigger: ResellerCreditTrigger.ON_PAYOUT, days: 0 },
        { trigger: ResellerCreditTrigger.AFTER_CONFIRMATION, days: 2 },
      ]),
    ).toBe(true);
    expect(usesAfterConfirmation([{ trigger: ResellerCreditTrigger.INSTANT, days: 0 }])).toBe(
      false,
    );
  });

  it('says every trigger in words (F2)', () => {
    for (const t of Object.values(ResellerCreditTrigger)) {
      expect(creditTriggerLabel(t).length).toBeGreaterThan(0);
      const days = t === ResellerCreditTrigger.INSTANT ? 0 : 2;
      expect(timingWords({ trigger: t, days }, 'Acme Store')).toMatch(/^Acme Store is credited/);
    }
    expect(timingWords({ trigger: ResellerCreditTrigger.ON_PAYOUT, days: 1 }, 'X')).toContain(
      '1 day after',
    );
    expect(
      timingWords({ trigger: ResellerCreditTrigger.AFTER_CONFIRMATION, days: 3 }, 'X'),
    ).toContain('before the customer has paid');
  });

  it('writes shares the way people read them', () => {
    expect(percentWords('80.00')).toBe('80%');
    expect(percentWords('33.30')).toBe('33.3%');
    expect(percentWords('0.00')).toBe('0%');
    const names = { store: 'Acme', seller: 'Menev' };
    expect(shareWords('DELIVERY_FEE', '80.00', '20.00', names)).toBe(
      'Delivery fee: Acme pays 80%, Menev pays 20%.',
    );
    expect(shareWords('COD_FEE', '0.00', '100.00', names)).toBe('COD fee: Menev pays all of it.');
    expect(shareWords('RETURN_FEE', '100.00', '0.00', names)).toMatch(/Acme pays all of it\.$/);
  });
});
