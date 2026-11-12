import type {
  AuthenticatedSeller,
  AuthenticatedStaff,
  AuthenticatedStoreUser,
} from '../../common/types/request';
import { currentImpersonation } from '../../common/impersonation/impersonation-context';
import type { CallerScope } from './assistant.types';

/**
 * The ONLY places a CallerScope is made, one per portal, each from the
 * identity that portal's guard already resolved. The model is not an
 * input to any of them.
 *
 * Inside a support session the guards resolve the IMPERSONATED seller's
 * (or store's) owner user as the caller, so the scope is that user's —
 * the assistant acts as them — and `impersonatingStaffId` records who is
 * really at the keyboard, on every row the assistant writes.
 */
export function scopeFromStaff(staff: AuthenticatedStaff): CallerScope {
  return {
    audience: 'STAFF',
    userId: staff.id,
    sellerId: null,
    storeId: null,
    orderScope: null,
    permissions: staff.permissions,
    impersonatingStaffId: null,
  };
}

export function scopeFromSeller(seller: AuthenticatedSeller): CallerScope {
  return {
    audience: 'SELLER',
    userId: seller.userId,
    sellerId: seller.id,
    storeId: null,
    orderScope: null,
    permissions: seller.permissions,
    impersonatingStaffId: currentImpersonation()?.staffUserId ?? null,
  };
}

/** ASSOC-1: an OWN-scope store user is an associate; the audience follows the resolved scope. */
export function scopeFromStoreUser(user: AuthenticatedStoreUser): CallerScope {
  return {
    audience: user.orderScope === 'OWN' ? 'ASSOCIATE' : 'STORE',
    userId: user.id,
    sellerId: user.sellerId,
    storeId: user.storeId,
    orderScope: user.orderScope,
    permissions: user.permissions,
    impersonatingStaffId: currentImpersonation()?.staffUserId ?? null,
  };
}
