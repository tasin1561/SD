import { CallOutcome, OrderStatus } from '@skydrop/db';
import { CallOutcomeMappingService } from '../../src/modules/call-center/services/call-outcome-mapping.service';

const svc = new CallOutcomeMappingService();
const NOT_CAP = { priorAttemptCount: 0, maxAttempts: 3 };

describe('CallOutcomeMappingService', () => {
  describe('base 9-outcome table (well below cap)', () => {
    it.each([
      [CallOutcome.CONFIRMED, OrderStatus.CONFIRMED, true, false, 'NONE'],
      [CallOutcome.CUSTOMER_DECLINED, OrderStatus.REJECTED_BY_CUSTOMER, true, false, 'NONE'],
      [CallOutcome.WRONG_NUMBER, OrderStatus.REJECTED_BY_CUSTOMER, true, false, 'NONE'],
      // NO_RESPONSE_DELAY, not IMMEDIATE: these two mean the CUSTOMER
      // did not pick up, and they are also the two that count toward the
      // NDR cap — so an instant redial spent a customer's three chances
      // inside a minute. The IMMEDIATE rows below are ours to retry (a
      // technical failure, a language mismatch): nobody was disturbed.
      [CallOutcome.NO_ANSWER, OrderStatus.CALL_NO_RESPONSE, true, true, 'NO_RESPONSE_DELAY'],
      [CallOutcome.BUSY, OrderStatus.CALL_NO_RESPONSE, true, true, 'BUSY_DELAY'],
      [CallOutcome.VOICEMAIL_LEFT, OrderStatus.CALL_NO_RESPONSE, true, true, 'NO_RESPONSE_DELAY'],
      [CallOutcome.CALLBACK_REQUESTED, OrderStatus.CALL_RESCHEDULED, false, true, 'AGENT_PROVIDED'],
      [CallOutcome.TECHNICAL_FAILURE, null, false, true, 'IMMEDIATE'],
      [CallOutcome.LANGUAGE_BARRIER, null, false, true, 'IMMEDIATE'],
    ])('%s → %s', (outcome, target, counts, requeue, reschedule) => {
      const r = svc.resolve(outcome, NOT_CAP);
      expect(r.targetStatus).toBe(target);
      expect(r.countsTowardCap).toBe(counts);
      expect(r.requeue).toBe(requeue);
      expect(r.reschedule).toBe(reschedule);
      expect(r.hitCap).toBe(false);
    });
  });

  describe('at-cap override (maxAttempts=3)', () => {
    // priorAttemptCount=2 → this counting attempt is the 3rd → at cap.
    const ATCAP = { priorAttemptCount: 2, maxAttempts: 3 };

    it.each([CallOutcome.NO_ANSWER, CallOutcome.BUSY, CallOutcome.VOICEMAIL_LEFT])(
      '%s at cap → REJECTED_NDR, no re-queue',
      (outcome) => {
        const r = svc.resolve(outcome, ATCAP);
        expect(r.targetStatus).toBe(OrderStatus.REJECTED_NDR);
        expect(r.requeue).toBe(false);
        expect(r.reschedule).toBe('NONE');
        expect(r.hitCap).toBe(true);
      },
    );

    it('CONFIRMED at cap still goes to CONFIRMED (edge case)', () => {
      const r = svc.resolve(CallOutcome.CONFIRMED, ATCAP);
      expect(r.targetStatus).toBe(OrderStatus.CONFIRMED);
      expect(r.hitCap).toBe(false);
    });

    it('CUSTOMER_DECLINED / WRONG_NUMBER at cap stay REJECTED_BY_CUSTOMER', () => {
      for (const o of [CallOutcome.CUSTOMER_DECLINED, CallOutcome.WRONG_NUMBER]) {
        const r = svc.resolve(o, ATCAP);
        expect(r.targetStatus).toBe(OrderStatus.REJECTED_BY_CUSTOMER);
        expect(r.hitCap).toBe(false);
      }
    });

    it('non-counting outcomes never trip the cap even past it', () => {
      const past = { priorAttemptCount: 9, maxAttempts: 3 };
      for (const o of [
        CallOutcome.CALLBACK_REQUESTED,
        CallOutcome.TECHNICAL_FAILURE,
        CallOutcome.LANGUAGE_BARRIER,
      ]) {
        const r = svc.resolve(o, past);
        expect(r.hitCap).toBe(false);
        expect(r.targetStatus).not.toBe(OrderStatus.REJECTED_NDR);
      }
    });

    it('boundary: 2nd of 3 (priorCount=1) is NOT yet at cap', () => {
      const r = svc.resolve(CallOutcome.NO_ANSWER, { priorAttemptCount: 1, maxAttempts: 3 });
      expect(r.targetStatus).toBe(OrderStatus.CALL_NO_RESPONSE);
      expect(r.hitCap).toBe(false);
    });

    it('honors a per-seller raised cap (maxAttempts=5)', () => {
      const r = svc.resolve(CallOutcome.NO_ANSWER, { priorAttemptCount: 2, maxAttempts: 5 });
      expect(r.targetStatus).toBe(OrderStatus.CALL_NO_RESPONSE); // 3 < 5
      const r2 = svc.resolve(CallOutcome.NO_ANSWER, { priorAttemptCount: 4, maxAttempts: 5 });
      expect(r2.targetStatus).toBe(OrderStatus.REJECTED_NDR); // 5 >= 5
    });
  });

  it('countsTowardCap matches the 6/9 list', () => {
    const counting: CallOutcome[] = [
      CallOutcome.CONFIRMED,
      CallOutcome.CUSTOMER_DECLINED,
      CallOutcome.WRONG_NUMBER,
      CallOutcome.NO_ANSWER,
      CallOutcome.BUSY,
      CallOutcome.VOICEMAIL_LEFT,
    ];
    for (const o of Object.values(CallOutcome)) {
      expect(svc.countsTowardCap(o)).toBe(counting.includes(o));
    }
  });
});
