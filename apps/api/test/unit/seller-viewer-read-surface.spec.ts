import { SELLER_VIEWER_READABLE_KEY } from '../../src/common/decorators/seller-viewer-readable.decorator';
import { SELLER_ROLES_KEY } from '../../src/common/decorators/seller-roles.decorator';
import { SellerOrderController } from '../../src/modules/order/controllers/seller-order.controller';
import { SellerProductController } from '../../src/modules/catalog-product/seller-product.controller';
import { SellerWalletController } from '../../src/modules/seller-wallet-read/seller-wallet.controller';
import { SellerProfileController } from '../../src/modules/seller-profile/seller-profile.controller';
import { SellerTeamController } from '../../src/modules/seller-team/seller-team.controller';
import { SellerApiKeyController } from '../../src/modules/seller-api-key/seller-api-key.controller';

/**
 * WHAT A VIEWER CAN READ — pinned as a list, not as a rule.
 *
 * `seller-jwt.guard.spec.ts` proves the guard honours
 * `@SellerViewerReadable()`. It cannot prove the decorator is on the
 * right controllers, and that is the half that decides what a real
 * VIEWER sees. Deleting the decorator from an order controller, or
 * pasting it onto the wallet, are both one-line changes that no
 * behavioural test would notice.
 *
 * VIEWER is the lowest-privilege seller account. Before this narrowing
 * it could read the wallet ledger, the profile's bank details, the team
 * list, API keys and the whole catalogue — "read-only" meant
 * read-EVERYTHING. If a controller is ever added to the allowed list
 * below, that should be a deliberate edit with a reason.
 */

/** Reads a class-level `@SellerViewerReadable()` marker. */
function isViewerReadable(controller: object): boolean {
  return Reflect.getMetadata(SELLER_VIEWER_READABLE_KEY, controller) === true;
}

/**
 * Every GET on a controller, with whether a handler-level
 * `@SellerRoles` closes it again (guard rule 1 — the handler wins).
 */
function viewerReadableGets(controller: { prototype: object }): string[] {
  const proto = controller.prototype;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .filter((name) => {
      const handler = (proto as Record<string, unknown>)[name];
      if (typeof handler !== 'function') return false;
      const method = Reflect.getMetadata('method', handler);
      // Nest encodes RequestMethod.GET as 0.
      if (method !== 0) return false;
      // A handler-level @SellerRoles overrides the class opt-in.
      return Reflect.getMetadata(SELLER_ROLES_KEY, handler) === undefined;
    })
    .sort();
}

describe('VIEWER read surface', () => {
  it('orders are readable — the list, the detail, and the event timeline', () => {
    // The tracking view is built from the order's events, so opening
    // this controller is what "orders and tracking" means in practice.
    expect(isViewerReadable(SellerOrderController)).toBe(true);
  });

  it('and ONLY those three — a new GET here does not quietly join them', () => {
    // The controller-level assertion above cannot see this. When
    // `customer-lookup` was added it became VIEWER-readable purely by
    // being a GET on an opted-in controller, and no test noticed: it is
    // a lookup TOOL that answers questions about arbitrary phone
    // numbers, not a view of orders the seller already has.
    //
    // So the list is pinned by NAME. Adding a GET here fails until
    // someone either adds it deliberately or closes it with a
    // handler-level @SellerRoles — which is the decision that was
    // missing the first time.
    expect(viewerReadableGets(SellerOrderController)).toEqual(['events', 'get', 'list']);
  });

  it.each([
    ['the wallet ledger', SellerWalletController],
    ['the profile, which carries bank details', SellerProfileController],
    ['the team list', SellerTeamController],
    ['API keys', SellerApiKeyController],
    ['the product catalogue', SellerProductController],
  ])('%s is NOT readable by a VIEWER', (_label, controller) => {
    expect(isViewerReadable(controller)).toBe(false);
  });
});
