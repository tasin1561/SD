import { describe, expect, it } from 'vitest';
import { quickActionsFor } from '@skydrop/ui/app/assistant';

describe('quick actions', () => {
  it('differ by console on the same page', () => {
    const a = quickActionsFor('admin', '/orders');
    const s = quickActionsFor('seller', '/orders');
    const r = quickActionsFor('associate', '/orders');
    expect(a).not.toEqual(s);
    expect(s).not.toEqual(r);
  });

  it('differ by page within a console', () => {
    expect(quickActionsFor('admin', '/orders/0192')).toContain('ui.assistant.qa.stuck');
    expect(quickActionsFor('admin', '/warehouse/pack')).toContain('ui.assistant.qa.errorMeaning');
    expect(quickActionsFor('seller', '/wallet')).toContain('ui.assistant.qa.balance');
    expect(quickActionsFor('seller', '/wallet')).not.toContain('ui.assistant.qa.stuck');
    expect(quickActionsFor('admin', '/dashboard')).not.toContain('ui.assistant.qa.stuck');
  });

  it('does not treat /orders/new as an order page', () => {
    expect(quickActionsFor('seller', '/orders/new')).not.toContain('ui.assistant.qa.stuck');
  });

  it('offers the last error only when there is one, and first', () => {
    expect(quickActionsFor('admin', '/x', false)).not.toContain('ui.assistant.qa.lastError');
    expect(quickActionsFor('admin', '/x', true)[0]).toBe('ui.assistant.qa.lastError');
  });

  it('is at most four, and never empty', () => {
    for (const c of ['admin', 'seller', 'reseller', 'associate'] as const) {
      const q = quickActionsFor(c, '/orders/0192', true);
      expect(q.length).toBeGreaterThan(0);
      expect(q.length).toBeLessThanOrEqual(4);
    }
  });
});
