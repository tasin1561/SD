import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Every path that can put an order in DELIVERED must take the money a
 * delivery owes — the ORDER_CHARGES debit, the Instant Pay COD credit and
 * the inbound-freight share (`DeliveredAccrualService`).
 *
 * That money used to hang off the lifecycle bus alone, and the bus is
 * emitted by `OrderWriteService.transitionStatus` and nothing else. God
 * mode writes `orders.status` directly and emits nothing, so an order
 * forced to DELIVERED was carried for free until somebody ran the
 * backfill (SD-TEST-SR-9711128000, 2026-09-11). Nothing failed; a charge
 * simply did not happen.
 *
 * A behavioural test cannot see the NEXT writer of `orders.status` — it
 * does not exist yet. So this reads the sources: it finds every
 * `order.update` / `order.updateMany` / `order.upsert` whose `data` sets
 * `status` (or is an opaque variable that might), and requires the set of
 * files to be exactly the known writers below, each with the reason it is
 * covered. A new one fails here until somebody decides what it owes.
 */

const SRC = join(__dirname, '../../src');

/** file (relative to src) → why its status writes cannot skip delivery money. */
const KNOWN_STATUS_WRITERS: Readonly<Record<string, string>> = {
  'modules/order/services/order-write.service.ts':
    'transitionStatus — emits to the lifecycle bus post-commit; OrderDeliveredAccrualListener bills DELIVERED',
  'modules/order/services/order-admin-override.service.ts':
    'god mode — emits nothing, so it calls DeliveredAccrualService itself when it lands on DELIVERED',
  'modules/order/services/order.service.ts':
    'create / submit — orders are born DRAFT or PENDING_CONFIRMATION, never DELIVERED',
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** The balanced (...) or {...} span starting at `open`. */
function balanced(src: string, open: number): string {
  const openCh = src[open];
  const closeCh = openCh === '(' ? ')' : '}';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === openCh) depth++;
    else if (src[i] === closeCh) {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

/** Does this call's argument write `status` — or hide what it writes? */
function writesStatus(args: string): boolean {
  const m = /\bdata\b\s*(:\s*)?/.exec(args);
  if (m === null) return false;
  const after = args.slice(m.index + m[0].length);
  if (m[1] === undefined) return true; // `{ where, data }` shorthand — opaque
  if (!after.startsWith('{')) return true; // `data: someVariable` — opaque
  return /\bstatus\s*:/.test(balanced(after, 0));
}

function statusWriters(): Map<string, number> {
  const found = new Map<string, number>();
  for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8');
    const call = /\.order\.(update|updateMany|upsert)\(/g;
    let m: RegExpExecArray | null;
    while ((m = call.exec(src)) !== null) {
      const args = balanced(src, m.index + m[0].length - 1);
      if (writesStatus(args)) {
        const rel = relative(SRC, file).split('\\').join('/');
        found.set(rel, (found.get(rel) ?? 0) + 1);
      }
    }
  }
  return found;
}

describe('delivery-time money follows EVERY writer of orders.status', () => {
  it('the files that write orders.status are exactly the known, covered ones', () => {
    const found = [...statusWriters().keys()].sort();
    expect(found).toEqual(Object.keys(KNOWN_STATUS_WRITERS).sort());
  });

  it('nothing writes orders.status in raw SQL', () => {
    const offenders = walk(SRC).filter((f) =>
      /UPDATE\s+"?orders"?\s+SET\s+[^;]*\bstatus\b/i.test(readFileSync(f, 'utf8')),
    );
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });

  it('transitionStatus emits every committed transition to the lifecycle bus', () => {
    const src = readFileSync(join(SRC, 'modules/order/services/order-write.service.ts'), 'utf8');
    expect(src).toMatch(/this\.emitLifecycleEvent\(order\.sellerId, result, input\)/);
    expect(src).toMatch(/this\.lifecycleBus\.emit\(/);
  });

  it('the bus listener hands DELIVERED to the shared accrual', () => {
    const src = readFileSync(
      join(
        SRC,
        'modules/seller-wallet-accrual/services/order-delivered-accrual-listener.service.ts',
      ),
      'utf8',
    );
    expect(src).toMatch(/event\.to !== OrderStatus\.DELIVERED/);
    expect(src).toMatch(/this\.delivered\.accrueForDelivered\(event\.orderId\)/);
  });

  it('god mode calls the same accrual when it lands on DELIVERED', () => {
    const src = readFileSync(
      join(SRC, 'modules/order/services/order-admin-override.service.ts'),
      'utf8',
    );
    expect(src).toMatch(
      /if \(to === OrderStatus\.DELIVERED && from !== OrderStatus\.DELIVERED\) \{\s*await this\.accrueDelivered\(/,
    );
    expect(src).toMatch(/this\.deliveredAccrual\.accrueForDelivered\(orderId\)/);
  });
});
