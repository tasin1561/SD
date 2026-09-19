import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrderPostCommitHooksService } from '../../src/modules/order/services/order-post-commit-hooks.service';

/**
 * The two writers of `orders.status` — `OrderWriteService.transitionStatus`
 * (ORD-3) and god mode (`OrderAdminOverrideService.forceMutate`, ORD-2) —
 * run the SAME non-stock post-commit hooks through ONE method.
 *
 * Until 2026-09-12 the hooks lived inside transitionStatus and god mode ran
 * none of them: a forced CONFIRMED had no shipment, a forced cancel left a
 * live one, a forced exit from PENDING_CONFIRMATION stayed in the call
 * queue. A behavioural test proves what a hook does today; it cannot see
 * the NEXT hook being added to one writer and not the other. This reads the
 * sources, so that drift fails here:
 *  - both writers call `this.postCommit.runForStatusChange(`;
 *  - neither reaches a hook's collaborator itself (a copied hook);
 *  - the shared service stays stock-free — the stock saga belongs to
 *    transitionStatus alone, because god mode opts out of it.
 */

const ORDER = join(__dirname, '../../src/modules/order/services');
/** Source with comments stripped — the rules below are about CODE, and
 *  the doc comments deliberately name the collaborators they rule out. */
const read = (f: string): string =>
  readFileSync(join(ORDER, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const WRITERS = ['order-write.service.ts', 'order-admin-override.service.ts'] as const;

/** A writer touching any of these is running a hook outside the shared method. */
const HOOK_COLLABORATORS: readonly RegExp[] = [
  /\bCallQueueService\b/,
  /\bShipmentProvisionService\b/,
  /\bOrderLifecycleEventBus\b/,
  /\bOrderChargesRefundService\b/,
  /\.enqueueOrder\(/,
  /\.dequeueOrder\(/,
  /\.provisionFromSnapshot\(/,
  /\.voidForOrder\(/,
  /\.refundIfCharged\(/,
  /\.emit\(/,
  /'pack_queue\.eligible'/,
  // 2026-09-19: re-pricing a changed reseller order is a hook too.
  /\.recalculateAfterEdit\(/,
  /\bStoreRequestNotifier\b/,
];

/**
 * The writers of a MONEY-AFFECTING order field: the ordinary edit and god
 * mode. Both must reach the reseller re-pricing through the same hook.
 *
 * God mode may write `codAmountInr` and `paymentMode` and called nothing
 * at all until 2026-09-19 — the order said one figure while the credits
 * behind it were worked out from another, with nothing anywhere saying
 * so. A behavioural test proves what one writer does; only reading the
 * sources catches the next money hook being wired into one of them.
 */
const MONEY_WRITERS = ['order.service.ts', 'order-admin-override.service.ts'] as const;

describe('both writers of orders.status share ONE set of post-commit hooks', () => {
  it.each(WRITERS)('%s calls the shared method', (file) => {
    expect(read(file)).toMatch(/this\.postCommit\.runForStatusChange\(/);
  });

  it.each(WRITERS)('%s runs no hook of its own', (file) => {
    const src = read(file);
    expect(HOOK_COLLABORATORS.filter((re) => re.test(src)).map(String)).toEqual([]);
  });

  it('each writer says who it is, so the refund can judge "did it leave?" correctly', () => {
    expect(read('order-write.service.ts')).toMatch(/source: 'TRANSITION'/);
    expect(read('order-admin-override.service.ts')).toMatch(/source: ADMIN_OVERRIDE_SOURCE/);
  });

  it.each(MONEY_WRITERS)('%s re-prices a reseller order through the shared method', (file) => {
    expect(read(file)).toMatch(/this\.postCommit\.runForMoneyAffectingEdit\(/);
  });

  it.each(MONEY_WRITERS)('%s never calls the re-pricing itself', (file) => {
    // `OrderService` legitimately holds ResellerOrderMoneyService for the
    // PRE-edit guard (`assertEditKeepsMoneyCorrectable`), so the rule is
    // about the re-pricing call, not about holding the service.
    expect(read(file)).not.toMatch(/\.recalculateAfterEdit\(/);
  });

  it('the shared service is stock-free by construction', () => {
    const src = read('order-post-commit-hooks.service.ts');
    expect(src).not.toMatch(/inventory-stock|inventory-shared/);
    expect(src).not.toMatch(/StockReservationService|StockMutationService/);
    // prisma, audit, callQueue, shipmentProvision, chargesRefund, bus,
    // settings (the per-seller default courier for the provision, SET-1 —
    // a settings read, not a stock collaborator), endedMoney (the money an
    // order ending undelivered gives back) and issues (a provision that
    // failed is raised) — none of them stock.
    // + resellerMoney (the re-pricing of a changed reseller order — a
    // money collaborator) and storeNotifier (god mode has no notice of
    // its own, so the two parties are told from here). Neither is stock.
    expect(OrderPostCommitHooksService.length).toBe(11);
  });
});
