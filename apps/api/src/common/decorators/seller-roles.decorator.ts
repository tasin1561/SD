import { SetMetadata } from '@nestjs/common';
import { SellerUserRole } from '@skydrop/db';

export const SELLER_ROLES_KEY = 'sellerRoles';

/** Every seller role — for endpoints each team member must be able to
 *  call FOR THEMSELVES regardless of role (logging out, requesting their
 *  own email verification). Spelled out at the call site via
 *  `@SellerRoles(...SELLER_ROLES_ALL)` so it greps as a deliberate
 *  widening, never as a forgotten annotation. */
export const SELLER_ROLES_ALL: readonly SellerUserRole[] = [
  SellerUserRole.OWNER,
  SellerUserRole.ADMIN,
  SellerUserRole.OPS,
  SellerUserRole.INVENTORY,
  SellerUserRole.FINANCE,
  SellerUserRole.VIEWER,
];

/**
 * Declares which seller roles may call an endpoint. Read by
 * `SellerJwtGuard`.
 *
 * Placement matters:
 *   - On the CLASS → the domain's WRITE allow-list. The controller's
 *     read-only endpoints stay open to every role (VIEWER included).
 *     This is the usual placement for a domain controller.
 *   - On a HANDLER → absolute for that endpoint, reads included. Use it
 *     to lock one endpoint down, or to open a self-service POST to
 *     every role via `@SellerRoles(...SELLER_ROLES_ALL)`.
 *
 * OMITTING this decorator is SAFE, not open: read-only methods stay open
 * to every role, and mutating methods fall back to OWNER + ADMIN. So a
 * new endpoint that forgets it is over-restrictive rather than a
 * security hole; widening is the deliberate act.
 *
 * Role intent (from the SellerUserRole schema comment):
 *   OWNER     — everything
 *   ADMIN     — everything except team-management on the OWNER row
 *   OPS       — orders, call-centre view, tracking
 *   INVENTORY — catalog, products, variants, images, goods receipts
 *   FINANCE   — wallet, invoices, remittances view, reports
 *   VIEWER    — read-only
 */
export const SellerRoles = (...roles: SellerUserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(SELLER_ROLES_KEY, roles);
