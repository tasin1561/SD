import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CallOutcome } from '@skydrop/db';
import { CallOutcomeMappingService } from '../../src/modules/call-center/services/call-outcome-mapping.service';

/**
 * Who gets called next, and how soon a customer may be redialled.
 *
 * Two rules that have to hold TOGETHER, because either alone is wrong:
 *
 *  1. An entry that was pulled and came back WITHOUT a call jumps the
 *     queue. That customer already waited through an agent claiming
 *     their order and doing nothing with it; making them queue again
 *     behind fresh orders charges them twice for our failure.
 *
 *  2. A customer who did not pick up is NOT redialled immediately.
 *
 * Rule 1 is safe only because of how rule 2's re-queue works: a re-queue
 * after a real attempt creates a BRAND NEW entry (locked decision #2), so
 * it starts at scheduled_attempts = 0 and sorts as the fresh entry it is.
 * Without that, "returned entries first" would be an instant redial loop.
 */
describe('call queue priority', () => {
  it('orders returned-without-a-call entries first, then strict FIFO', () => {
    const src = readFileSync(
      join(__dirname, '../../src/modules/call-center/services/call-assignment.service.ts'),
      'utf8',
    );
    // Read from the source because the ordering lives in raw SQL — there
    // is no Prisma argument object to assert against.
    expect(src).toMatch(
      /ORDER BY \(scheduled_attempts > 0\) DESC, available_at ASC, created_at ASC/,
    );
    // The claim and the hold must be one transaction, or a hold can
    // exist for a claim that did not happen.
    expect(src).toMatch(/tx\.callAssignmentHold\.create/);
  });
});

describe('re-queue cooldown', () => {
  const mapping = new CallOutcomeMappingService();

  it('delays a redial when the CUSTOMER did not pick up', () => {
    // These are also the two that count toward the NDR cap, so an
    // instant redial burned a customer's three chances in a minute.
    for (const outcome of [CallOutcome.NO_ANSWER, CallOutcome.VOICEMAIL_LEFT]) {
      const rule = mapping.resolve(outcome, { priorAttemptCount: 0, maxAttempts: 3 });
      expect(rule.reschedule).toBe('NO_RESPONSE_DELAY');
      expect(rule.requeue).toBe(true);
    }
  });

  it('still retries immediately when the failure was OURS', () => {
    // The customer was never disturbed; neither counts toward the cap,
    // so there is nobody to protect from a redial.
    for (const outcome of [CallOutcome.TECHNICAL_FAILURE, CallOutcome.LANGUAGE_BARRIER]) {
      const rule = mapping.resolve(outcome, { priorAttemptCount: 0, maxAttempts: 3 });
      expect(rule.reschedule).toBe('IMMEDIATE');
      expect(rule.countsTowardCap).toBe(false);
    }
  });

  it('BUSY keeps its own shorter delay', () => {
    const rule = mapping.resolve(CallOutcome.BUSY, { priorAttemptCount: 0, maxAttempts: 3 });
    expect(rule.reschedule).toBe('BUSY_DELAY');
  });

  it('resolves the delay PER SELLER, not globally', () => {
    const src = readFileSync(
      join(__dirname, '../../src/modules/call-center/services/call-attempt.service.ts'),
      'utf8',
    );
    // Through SettingsResolverService (SET-1), never a bare
    // systemSetting lookup — how hard we chase a customer is a decision
    // about that seller's business, exactly like the NDR cap beside it.
    expect(src).toMatch(/noResponseDelayHours\(sellerId\)/);
    expect(src).toMatch(/resolveIntWithLegacy\([\s\S]{0,120}SETTING_NO_RESPONSE_DELAY_HOURS/);
  });

  it('cannot be overridden back to an instant redial', () => {
    const seed = readFileSync(join(__dirname, '../../../../packages/db/prisma/seed.ts'), 'utf8');
    const block = seed.slice(seed.indexOf("key: 'ops.call_retry_interval_hours'"));
    const entry = block.slice(0, block.indexOf('},'));
    // SET-1 clamps overrides AT WRITE TIME, so a minimum of 1 hour makes
    // the bug this delay exists to fix unrepresentable per seller —
    // nobody reintroduces it by typing 0 into a form.
    expect(entry).toMatch(/sellerOverridable: true/);
    expect(entry).toMatch(/overrideMinInt: 1\b/);
    expect(entry).toMatch(/overrideMaxInt: 72\b/);
  });

  it('reads the setting that was written for it', () => {
    const src = readFileSync(
      join(__dirname, '../../src/modules/call-center/services/call-attempt.service.ts'),
      'utf8',
    );
    // ops.call_retry_interval_hours was seeded, described as "hours
    // between no-response retries", surfaced in the settings UI — and
    // read by nothing, so editing it did nothing at all.
    expect(src).toMatch(/ops\.call_retry_interval_hours/);
    expect(src).toMatch(/case 'NO_RESPONSE_DELAY'/);
  });
});
