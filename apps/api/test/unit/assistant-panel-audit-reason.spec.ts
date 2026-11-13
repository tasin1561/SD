/**
 * CodeQL js/type-confusion-through-parameter-tampering on PR #34: a repeated
 * `?reason=` arrives as an array. Only a plain string reaches the audit row.
 */
import { auditReason } from '../../src/modules/assistant/controllers/admin-assistant-panel.controller';

describe('auditReason', () => {
  it('keeps a plain string, trimmed to 300 characters', () => {
    expect(auditReason('checking a complaint')).toBe('checking a complaint');
    expect(auditReason('x'.repeat(400))).toHaveLength(300);
  });
  it('drops an array, an object, a number and nothing', () => {
    expect(auditReason(['a', 'b'])).toBeUndefined();
    expect(auditReason({ length: 5 })).toBeUndefined();
    expect(auditReason(7)).toBeUndefined();
    expect(auditReason(undefined)).toBeUndefined();
  });
});
