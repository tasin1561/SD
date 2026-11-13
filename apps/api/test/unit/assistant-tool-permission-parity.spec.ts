import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_SELLER_PERMISSION_KEYS } from '../../src/common/auth/seller-permissions';
import { ALL_STORE_PERMISSION_KEYS } from '../../src/common/auth/store-permissions';
import { ALL_PERMISSION_KEYS } from '../../src/common/auth/permissions';
import { fakeRegistry } from '../helpers/assistant-fixtures';

/**
 * A tool is OFFERED only to a caller who holds the permission key the
 * equivalent HTTP route requires. If the two ever differ — a route is
 * tightened and its tool is forgotten — the assistant becomes a way
 * AROUND the permission. Read from the controller SOURCE, the honest
 * place to read "what does this route require" (same technique as
 * confirm-without-call-permissions.spec.ts).
 */
const MODULES = join(__dirname, '../../src/modules');
const DECORATOR = /@Require(?:Seller|Store)?Permissions\(([^)]*)\)/g;

function keysIn(text: string): string[] {
  const found = [...text.matchAll(DECORATOR)];
  const last = found[found.length - 1]?.[1] ?? '';
  return [...last.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
}

/** Handler-level key if the handler declares one, else the class-level default. */
export function routeGate(controller: string, handler: string): { keys: string[]; guard: string } {
  const src = readFileSync(join(MODULES, controller), 'utf8');
  const classStart = src.indexOf('\n@Controller(');
  expect(classStart).toBeGreaterThan(0);
  const classKeys = keysIn(src.slice(0, classStart));
  const guard = /@UseGuards\((\w+)\)/.exec(src.slice(0, classStart))?.[1] ?? '';

  const at = src.search(new RegExp(`\\n  (?:async )?${handler}\\(`));
  expect(at).toBeGreaterThan(classStart);
  const before = src.slice(0, at);
  const verb = Math.max(
    ...['Get', 'Post', 'Patch', 'Put', 'Delete'].map((v) => before.lastIndexOf(`\n  @${v}(`)),
  );
  expect(verb).toBeGreaterThan(classStart);
  const own = keysIn(src.slice(verb, at));
  return { keys: own.length > 0 ? own : classKeys, guard };
}

const GUARD_FOR: Record<string, string> = {
  SELLER: 'SellerJwtGuard',
  STAFF: 'StaffJwtGuard',
  STORE: 'StoreJwtGuard',
  ASSOCIATE: 'StoreJwtGuard',
};
const CATALOGUE: Record<string, readonly string[]> = {
  SELLER: ALL_SELLER_PERMISSION_KEYS,
  STAFF: ALL_PERMISSION_KEYS,
  STORE: ALL_STORE_PERMISSION_KEYS,
  ASSOCIATE: ALL_STORE_PERMISSION_KEYS,
};

describe('assistant tool permission parity', () => {
  const tools = fakeRegistry().all();

  it('reads real route gates (a parser that finds nothing would pass everything)', () => {
    expect(routeGate('order/controllers/seller-order.controller.ts', 'get').keys).toEqual([
      'orders.view',
    ]);
    expect(
      routeGate('order/controllers/seller-order.controller.ts', 'confirmWithoutCall').keys,
    ).toEqual(['orders.create']);
  });

  it.each(tools.filter((t) => t.mirrors !== null).map((t) => [t.name, t] as const))(
    '%s requires exactly what its route requires',
    (_n, tool) => {
      const gate = routeGate(tool.mirrors!.controller, tool.mirrors!.handler);
      // A route may list SEVERAL keys, which mean ANY of them. A tool may
      // then require ONE of those (stricter, never looser); a single-key
      // route must match exactly.
      if (gate.keys.length === 1) expect(gate.keys).toEqual([tool.permission]);
      else expect(gate.keys).toContain(tool.permission);
      for (const aud of tool.audience) expect(gate.guard).toBe(GUARD_FOR[aud]);
    },
  );

  it('a tool without a route declares no permission, and every other tool declares one', () => {
    for (const t of tools) {
      if (t.mirrors === null) expect(t.permission).toBeNull();
      else expect(t.permission).not.toBeNull();
    }
  });

  it('every declared key exists in its audience’s permission catalogue', () => {
    for (const t of tools) {
      if (t.permission === null) continue;
      for (const aud of t.audience) expect(CATALOGUE[aud]).toContain(t.permission);
    }
  });
});
