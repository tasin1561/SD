import type { StatusKind } from './index';

/**
 * The PUBLIC tracking vocabulary — the coarse, customer-safe statuses the
 * `GET /public/tracking/:awb` projection returns (TRK-8). It is its own
 * union (not a Prisma enum), so this module is dependency-free: apps/track
 * reads it without pulling `@skydrop/db` into a public page.
 *
 * F2-exhaustive like every other mapper here: a new public status fails to
 * compile until somebody decides its kind.
 */
export type PublicTrackingStatus =
  | 'processing'
  | 'dispatched'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivery_attempted'
  | 'delivered'
  | 'return_initiated'
  | 'returning'
  | 'returned'
  | 'lost'
  | 'damaged'
  | 'cancelled';

/**
 * A delivery attempt is 'pending' (amber): it is the one state a customer
 * may need to act on, not a failure. Lost and damaged are 'failed'; the
 * whole return chain is 'rto'.
 */
export function publicTrackingStatusKind(status: PublicTrackingStatus): StatusKind {
  switch (status) {
    case 'processing':
      return 'draft';
    case 'dispatched':
      return 'confirmed';
    case 'in_transit':
    case 'out_for_delivery':
      return 'in-transit';
    case 'delivery_attempted':
      return 'pending';
    case 'delivered':
      return 'delivered';
    case 'return_initiated':
    case 'returning':
    case 'returned':
      return 'rto';
    case 'lost':
    case 'damaged':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled public tracking status: ${String(exhaustive)}`);
    }
  }
}
