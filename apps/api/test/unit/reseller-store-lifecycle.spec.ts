import { ResellerStoreOrigin, ResellerStoreStatus } from '@skydrop/db';
import {
  acceptsInvitations,
  canTake,
  initialStatusFor,
  isTerminalStoreStatus,
  refusalFor,
  ruleFor,
  type ResellerStoreAction,
} from '../../src/modules/reseller-store/services/reseller-store-lifecycle';

/**
 * RS-1 — the reseller store life, pinned as a table.
 *
 * Every (action, from-status) pair is listed with the answer, so adding
 * a status or an action means deciding every cell — and a rule that
 * quietly widened (e.g. closing a PENDING store) fails here by name.
 */
const S = ResellerStoreStatus;
const ACTIONS: readonly ResellerStoreAction[] = ['APPROVE', 'REJECT', 'PAUSE', 'RESUME', 'CLOSE'];

const ALLOWED: Record<ResellerStoreAction, readonly ResellerStoreStatus[]> = {
  APPROVE: [S.PENDING_SELLER_APPROVAL],
  REJECT: [S.PENDING_SELLER_APPROVAL],
  PAUSE: [S.ACTIVE],
  RESUME: [S.PAUSED],
  // Paused first (owner, 2026-09-15): an ACTIVE store cannot be closed.
  CLOSE: [S.PAUSED],
};

describe('reseller store lifecycle (RS-1)', () => {
  it.each(ACTIONS.flatMap((a) => Object.values(S).map((s) => [a, s] as const)))(
    '%s from %s',
    (action, from) => {
      expect(canTake(action, from)).toBe(ALLOWED[action].includes(from));
    },
  );

  it('lands where RS-1 says', () => {
    expect(ruleFor('APPROVE').to).toBe(S.ACTIVE);
    expect(ruleFor('REJECT').to).toBe(S.REJECTED);
    expect(ruleFor('PAUSE').to).toBe(S.PAUSED);
    expect(ruleFor('RESUME').to).toBe(S.ACTIVE);
    expect(ruleFor('CLOSE').to).toBe(S.CLOSED);
  });

  it('audits approve, reject and close HIGH', () => {
    expect(ACTIONS.filter((a) => ruleFor(a).severity === 'HIGH').sort()).toEqual([
      'APPROVE',
      'CLOSE',
      'REJECT',
    ]);
  });

  it('asks for a reason before a store is rejected or closed', () => {
    expect(ACTIONS.filter((a) => ruleFor(a).needsReason).sort()).toEqual(['CLOSE', 'REJECT']);
  });

  it('a seller’s store opens at once; one Skydrop opens waits for the seller', () => {
    expect(initialStatusFor(ResellerStoreOrigin.SELLER)).toBe(S.ACTIVE);
    expect(initialStatusFor(ResellerStoreOrigin.ADMIN)).toBe(S.PENDING_SELLER_APPROVAL);
  });

  it('REJECTED and CLOSED are terminal: nothing leaves them', () => {
    for (const s of [S.REJECTED, S.CLOSED]) {
      expect(isTerminalStoreStatus(s)).toBe(true);
      for (const a of ACTIONS) expect(canTake(a, s)).toBe(false);
    }
    for (const s of [S.PENDING_SELLER_APPROVAL, S.ACTIVE, S.PAUSED]) {
      expect(isTerminalStoreStatus(s)).toBe(false);
    }
  });

  it('only an open store takes invitations', () => {
    expect(Object.values(S).filter(acceptsInvitations).sort()).toEqual([S.ACTIVE, S.PAUSED].sort());
  });

  it('a refusal names where the store is and where it would have to be', () => {
    expect(refusalFor('CLOSE', S.PENDING_SELLER_APPROVAL)).toBe(
      'A store that is pending seller approval cannot be closed — only one that is paused.',
    );
  });
});
