import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SELLER_ROLES } from '../../src/common/auth/seller-permissions';
import { STAFF_ROLE_PRESETS } from '../../src/common/auth/staff-role-presets';

/**
 * Who may press "Confirm now, no call".
 *
 * The act commits stock and books a waybill, so a read-only login must
 * not reach it. Reads source for the declared gate — the honest thing to
 * read for "what does this endpoint require" — and reads the seeded roles
 * for "and who actually holds that".
 */
const SRC = join(__dirname, '../../src/modules/order/controllers');

function gateOf(file: string, handler: string): string[] {
  const src = readFileSync(join(SRC, file), 'utf8');
  const idx = src.indexOf(`  ${handler}(`);
  expect(idx).toBeGreaterThan(0);
  // The decorator block immediately above the handler.
  const block = src.slice(Math.max(0, idx - 1200), idx);
  const found = [...block.matchAll(/@Require(?:Seller)?Permissions\(([^)]*)\)/g)];
  const decorator = found[found.length - 1]?.[1] ?? '';
  return [...decorator.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
}

describe('confirm-without-call permissions', () => {
  it('the client console requires `orders.create` — the same gate as sending for a call', () => {
    expect(gateOf('seller-order.controller.ts', 'confirmWithoutCall')).toEqual(['orders.create']);
    expect(gateOf('seller-order.controller.ts', 'sendConfirmationCalls')).toEqual([
      'orders.create',
    ]);
  });

  it('a VIEWER is refused: the narrowest seller login does not hold that key', () => {
    const viewer = DEFAULT_SELLER_ROLES.find((r) => r.key === 'viewer');
    expect(viewer).toBeDefined();
    expect(viewer!.permissions).toEqual(['orders.view']);
    expect(viewer!.permissions).not.toContain('orders.create');
  });

  it('the admin console requires `callcenter.queue.manage` — the call-queue authority', () => {
    expect(gateOf('admin-order.controller.ts', 'confirmWithoutCall')).toEqual([
      'callcenter.queue.manage',
    ]);
    expect(gateOf('admin-order.controller.ts', 'sendConfirmationCalls')).toEqual([
      'callcenter.queue.manage',
    ]);
  });

  it('no read-only staff preset holds the admin gate', () => {
    const holders = STAFF_ROLE_PRESETS.filter((p) =>
      (p.permissions as readonly string[]).includes('callcenter.queue.manage'),
    ).map((p) => p.key);
    expect(holders).toEqual(['admin']);
  });
});
