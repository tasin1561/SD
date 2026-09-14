import { ResellerStoreEventKind, ResellerStoreOrigin, ResellerStoreStatus } from '@skydrop/db';

/**
 * RS-1 — a reseller store's life, as data. Pure: no Prisma, no Nest.
 *
 *   created by the SELLER  → ACTIVE
 *   created by an ADMIN    → PENDING_SELLER_APPROVAL
 *   PENDING  —approve→ ACTIVE        (the seller)
 *   PENDING  —reject→  REJECTED      (terminal)
 *   ACTIVE   —pause→   PAUSED        (blocks NEW orders; in-flight finish)
 *   PAUSED   —resume→  ACTIVE
 *   ACTIVE | PAUSED —close→ CLOSED   (terminal; only with nothing in flight)
 *
 * Every rule names EXACTLY the states it may start from. The service
 * guards its write on the one it READ (`updateMany where status = <that>`),
 * so a rule with two sources still moves from exactly one.
 */

export type ResellerStoreAction = 'APPROVE' | 'REJECT' | 'PAUSE' | 'RESUME' | 'CLOSE';

export interface ResellerStoreRule {
  readonly from: readonly ResellerStoreStatus[];
  readonly to: ResellerStoreStatus;
  readonly event: ResellerStoreEventKind;
  /** RS-1: approve, reject and close are HIGH. */
  readonly severity: 'HIGH' | 'MEDIUM';
  /** A reason is required, not optional, for these. */
  readonly needsReason: boolean;
}

/** F2: a new action fails to compile until somebody writes its rule. */
export function ruleFor(action: ResellerStoreAction): ResellerStoreRule {
  switch (action) {
    case 'APPROVE':
      return {
        from: [ResellerStoreStatus.PENDING_SELLER_APPROVAL],
        to: ResellerStoreStatus.ACTIVE,
        event: ResellerStoreEventKind.APPROVED,
        severity: 'HIGH',
        needsReason: false,
      };
    case 'REJECT':
      return {
        from: [ResellerStoreStatus.PENDING_SELLER_APPROVAL],
        to: ResellerStoreStatus.REJECTED,
        event: ResellerStoreEventKind.REJECTED,
        severity: 'HIGH',
        needsReason: true,
      };
    case 'PAUSE':
      return {
        from: [ResellerStoreStatus.ACTIVE],
        to: ResellerStoreStatus.PAUSED,
        event: ResellerStoreEventKind.PAUSED,
        severity: 'MEDIUM',
        needsReason: false,
      };
    case 'RESUME':
      return {
        from: [ResellerStoreStatus.PAUSED],
        to: ResellerStoreStatus.ACTIVE,
        event: ResellerStoreEventKind.RESUMED,
        severity: 'MEDIUM',
        needsReason: false,
      };
    case 'CLOSE':
      return {
        from: [ResellerStoreStatus.ACTIVE, ResellerStoreStatus.PAUSED],
        to: ResellerStoreStatus.CLOSED,
        event: ResellerStoreEventKind.CLOSED,
        severity: 'HIGH',
        needsReason: true,
      };
  }
}

export function canTake(action: ResellerStoreAction, from: ResellerStoreStatus): boolean {
  return ruleFor(action).from.includes(from);
}

/** RS-1: the seller's own store starts open; an admin's waits for the seller. */
export function initialStatusFor(origin: ResellerStoreOrigin): ResellerStoreStatus {
  switch (origin) {
    case ResellerStoreOrigin.SELLER:
      return ResellerStoreStatus.ACTIVE;
    case ResellerStoreOrigin.ADMIN:
      return ResellerStoreStatus.PENDING_SELLER_APPROVAL;
  }
}

/** REJECTED and CLOSED never move again. */
export function isTerminalStoreStatus(status: ResellerStoreStatus): boolean {
  switch (status) {
    case ResellerStoreStatus.REJECTED:
    case ResellerStoreStatus.CLOSED:
      return true;
    case ResellerStoreStatus.PENDING_SELLER_APPROVAL:
    case ResellerStoreStatus.ACTIVE:
    case ResellerStoreStatus.PAUSED:
      return false;
  }
}

/** Whether a team can be invited into the store right now. */
export function acceptsInvitations(status: ResellerStoreStatus): boolean {
  return status === ResellerStoreStatus.ACTIVE || status === ResellerStoreStatus.PAUSED;
}

/** The sentence a refusal carries, so the verdict (FE-2) says why. */
export function refusalFor(action: ResellerStoreAction, from: ResellerStoreStatus): string {
  const allowed = ruleFor(action)
    .from.map((s) => s.toLowerCase().replace(/_/g, ' '))
    .join(' or ');
  return `A store that is ${from.toLowerCase().replace(/_/g, ' ')} cannot be ${verb(action)} — only one that is ${allowed}.`;
}

function verb(action: ResellerStoreAction): string {
  switch (action) {
    case 'APPROVE':
      return 'approved';
    case 'REJECT':
      return 'rejected';
    case 'PAUSE':
      return 'paused';
    case 'RESUME':
      return 'resumed';
    case 'CLOSE':
      return 'closed';
  }
}
