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
];

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

  it('the shared service is stock-free by construction', () => {
    const src = read('order-post-commit-hooks.service.ts');
    expect(src).not.toMatch(/inventory-stock|inventory-shared/);
    expect(src).not.toMatch(/StockReservationService|StockMutationService/);
    // prisma, audit, callQueue, shipmentProvision, chargesRefund, bus,
    // settings (the per-seller default courier for the provision, SET-1 —
    // a settings read, not a stock collaborator).
    expect(OrderPostCommitHooksService.length).toBe(7);
  });
});
