import { Prisma } from '@skydrop/db';

/**
 * A small in-memory Prisma for the P&L specs.
 *
 * The P&L is a report over FILTERS — half-open date windows, relation
 * filters, `having` clauses, distinct — and a fake that answers every
 * query the same way cannot tell a window that tiles from one that
 * leaks, or a drill-down whose rows add up from one that does not. This
 * one evaluates the where clause on real rows, so two adjacent reports
 * can be added and compared with the report over both.
 *
 * It implements the subset of Prisma the report uses: findMany /
 * findFirst / findUnique / count / aggregate / groupBy; where with
 * equality, null, `in` / `notIn` / `not` / `lt` / `lte` / `gt` / `gte`,
 * AND / OR / NOT, and relation filters (to-one, and `some` / `every` /
 * `none` on to-many); select (nested for relations), orderBy, take and
 * distinct. Anything else THROWS rather than guessing, so a new query
 * shape fails loudly instead of passing on an answer nobody computed.
 */

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

interface Relation {
  readonly model: string;
  /** Field on THIS row. */
  readonly local: string;
  /** Field on the related row. */
  readonly foreign: string;
  readonly many: boolean;
}

const one = (model: string, local: string): Relation => ({
  model,
  local,
  foreign: 'id',
  many: false,
});

/** The relations the report walks, as the schema declares them. */
const RELATIONS: Record<string, Record<string, Relation>> = {
  sellerWalletEntry: {
    linkedOrder: one('order', 'linkedOrderId'),
    linkedEntry: one('sellerWalletEntry', 'linkedEntryId'),
    seller: one('seller', 'sellerId'),
  },
  inboundFreightCharge: {
    consignment: one('consignment', 'consignmentId'),
    seller: one('seller', 'sellerId'),
  },
  bankEntry: {
    account: one('platformBankAccount', 'accountId'),
    transfer: one('bankTransfer', 'transferId'),
    expenseCategory: one('expenseCategory', 'expenseCategoryId'),
    remittance: one('remittance', 'remittanceId'),
    inboundFreightCharge: one('inboundFreightCharge', 'inboundFreightChargeId'),
  },
  courierSettlementLine: {
    order: one('order', 'orderId'),
    settlement: one('courierSettlement', 'settlementId'),
  },
  orderShipment: {
    order: one('order', 'orderId'),
    shipment: one('shipment', 'shipmentId'),
  },
  orderEvent: { order: one('order', 'orderId') },
  shipment: {
    orderShipments: { model: 'orderShipment', local: 'id', foreign: 'shipmentId', many: true },
  },
  order: {
    orderShipments: { model: 'orderShipment', local: 'id', foreign: 'orderId', many: true },
    charges: { model: 'orderCharge', local: 'id', foreign: 'orderId', many: true },
    events: { model: 'orderEvent', local: 'id', foreign: 'orderId', many: true },
  },
  courierAccount: { courier: one('courier', 'courierId') },
};

const isDecimal = (v: unknown): v is Prisma.Decimal => Prisma.Decimal.isDecimal(v);
const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !(v instanceof Date) && !isDecimal(v) && !Array.isArray(v);

function compare(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (isDecimal(a) || isDecimal(b) || typeof a === 'number') {
    return new Prisma.Decimal(a as Prisma.Decimal.Value).cmp(
      new Prisma.Decimal(b as Prisma.Decimal.Value),
    );
  }
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function equal(a: unknown, b: unknown): boolean {
  if (a === undefined || a === null || b === undefined || b === null) {
    return (a ?? null) === (b ?? null);
  }
  return compare(a, b) === 0;
}

function matchValue(actual: unknown, cond: unknown): boolean {
  if (!isPlain(cond)) return equal(actual, cond);
  for (const [op, v] of Object.entries(cond)) {
    const missing = actual === undefined || actual === null;
    switch (op) {
      case 'equals':
        if (!equal(actual, v)) return false;
        break;
      case 'in':
        if (!(v as unknown[]).some((x) => equal(actual, x))) return false;
        break;
      case 'notIn':
        if ((v as unknown[]).some((x) => equal(actual, x))) return false;
        break;
      case 'not':
        if (matchValue(actual, v)) return false;
        break;
      case 'lt':
        if (missing || compare(actual, v) >= 0) return false;
        break;
      case 'lte':
        if (missing || compare(actual, v) > 0) return false;
        break;
      case 'gt':
        if (missing || compare(actual, v) <= 0) return false;
        break;
      case 'gte':
        if (missing || compare(actual, v) < 0) return false;
        break;
      default:
        throw new Error(`fake-db: unsupported filter operator "${op}"`);
    }
  }
  return true;
}

export class FakeDb {
  constructor(private readonly tables: Tables) {}

  rows(model: string): Row[] {
    return this.tables[model] ?? [];
  }

  private related(model: string, row: Row, name: string): { rel: Relation; rows: Row[] } | null {
    const rel = RELATIONS[model]?.[name];
    if (rel === undefined) return null;
    const rows = this.rows(rel.model).filter((r) => equal(r[rel.foreign], row[rel.local]));
    return { rel, rows };
  }

  matches(model: string, row: Row, where: Record<string, unknown> | undefined): boolean {
    if (where === undefined) return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === 'AND') {
        const all = Array.isArray(v) ? v : [v];
        if (!all.every((w) => this.matches(model, row, w as Record<string, unknown>))) return false;
        continue;
      }
      if (k === 'OR') {
        if (!(v as Record<string, unknown>[]).some((w) => this.matches(model, row, w)))
          return false;
        continue;
      }
      if (k === 'NOT') {
        if (this.matches(model, row, v as Record<string, unknown>)) return false;
        continue;
      }
      const r = this.related(model, row, k);
      if (r !== null) {
        const target = r.rel.model;
        if (r.rel.many) {
          const f = v as Record<string, Record<string, unknown>>;
          if (f['some'] !== undefined && !r.rows.some((x) => this.matches(target, x, f['some'])))
            return false;
          if (f['every'] !== undefined && !r.rows.every((x) => this.matches(target, x, f['every'])))
            return false;
          if (f['none'] !== undefined && r.rows.some((x) => this.matches(target, x, f['none'])))
            return false;
          continue;
        }
        const found = r.rows[0] ?? null;
        if (v === null) {
          if (found !== null) return false;
          continue;
        }
        const f = v as Record<string, unknown>;
        const inner = (f['is'] ?? f) as Record<string, unknown>;
        if (found === null || !this.matches(target, found, inner)) return false;
        continue;
      }
      if (!matchValue(row[k], v)) return false;
    }
    return true;
  }

  private project(model: string, row: Row, select: Record<string, unknown> | undefined): Row {
    if (select === undefined) return { ...row };
    const out: Row = {};
    for (const [k, v] of Object.entries(select)) {
      if (v === false || v === undefined) continue;
      const r = this.related(model, row, k);
      if (r !== null) {
        const sub = (v === true ? {} : v) as Record<string, unknown>;
        if (r.rel.many) {
          out[k] = this.shape(r.rel.model, r.rows, sub);
        } else {
          const found = r.rows[0];
          out[k] =
            found === undefined
              ? null
              : this.project(
                  r.rel.model,
                  found,
                  sub['select'] as Record<string, unknown> | undefined,
                );
        }
        continue;
      }
      out[k] = row[k] ?? null;
    }
    return out;
  }

  /** where → orderBy → distinct → take → select, as Prisma applies them. */
  shape(model: string, rows: Row[], args: Record<string, unknown> = {}): Row[] {
    let out = rows.filter((r) =>
      this.matches(model, r, args['where'] as Record<string, unknown> | undefined),
    );
    const orderBy = args['orderBy'];
    if (orderBy !== undefined) {
      const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Record<string, string>[];
      out = [...out].sort((a, b) => {
        for (const o of keys) {
          for (const [f, dir] of Object.entries(o)) {
            const av = a[f];
            const bv = b[f];
            if (av == null && bv == null) continue;
            if (av == null) return 1;
            if (bv == null) return -1;
            const c = compare(av, bv);
            if (c !== 0) return dir === 'desc' ? -c : c;
          }
        }
        return 0;
      });
    }
    const distinct = args['distinct'] as string[] | undefined;
    if (distinct !== undefined) {
      const seen = new Set<string>();
      out = out.filter((r) => {
        const key = JSON.stringify(distinct.map((f) => String(r[f] ?? null)));
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    const take = args['take'] as number | undefined;
    if (take !== undefined) out = out.slice(0, take);
    return out.map((r) =>
      this.project(model, r, args['select'] as Record<string, unknown> | undefined),
    );
  }

  private aggregates(rows: Row[], args: Record<string, unknown>): Row {
    const out: Row = {};
    const sumOf = args['_sum'] as Record<string, boolean> | undefined;
    if (sumOf !== undefined) {
      const s: Row = {};
      for (const f of Object.keys(sumOf)) {
        const vals = rows.map((r) => r[f]).filter((x) => x !== null && x !== undefined);
        s[f] =
          vals.length === 0
            ? null
            : vals.reduce<Prisma.Decimal>(
                (t, x) => t.add(new Prisma.Decimal(x as Prisma.Decimal.Value)),
                new Prisma.Decimal(0),
              );
      }
      out['_sum'] = s;
    }
    const countOf = args['_count'] as Record<string, boolean> | undefined;
    if (countOf !== undefined) {
      const c: Row = {};
      for (const f of Object.keys(countOf)) {
        c[f] = f === '_all' ? rows.length : rows.filter((r) => r[f] != null).length;
      }
      out['_count'] = c;
    }
    for (const agg of ['_min', '_max'] as const) {
      const of = args[agg] as Record<string, boolean> | undefined;
      if (of === undefined) continue;
      const m: Row = {};
      for (const f of Object.keys(of)) {
        const vals = rows.map((r) => r[f]).filter((x) => x !== null && x !== undefined);
        m[f] =
          vals.length === 0
            ? null
            : vals.reduce((best, x) =>
                agg === '_min'
                  ? compare(x, best) < 0
                    ? x
                    : best
                  : compare(x, best) > 0
                    ? x
                    : best,
              );
      }
      out[agg] = m;
    }
    return out;
  }

  delegate(model: string): Record<string, (args?: Record<string, unknown>) => Promise<unknown>> {
    const all = (): Row[] => this.rows(model);
    const filtered = (args: Record<string, unknown> = {}): Row[] =>
      all().filter((r) =>
        this.matches(model, r, args['where'] as Record<string, unknown> | undefined),
      );
    return {
      findMany: async (args = {}) => this.shape(model, all(), args),
      findFirst: async (args = {}) => this.shape(model, all(), { ...args, take: 1 })[0] ?? null,
      findUnique: async (args = {}) => this.shape(model, all(), { ...args, take: 1 })[0] ?? null,
      count: async (args = {}) => filtered(args).length,
      aggregate: async (args = {}) => this.aggregates(filtered(args), args),
      groupBy: async (args = {}) => {
        const by = args['by'] as string[];
        const groups = new Map<string, Row[]>();
        for (const r of filtered(args)) {
          const key = JSON.stringify(by.map((f) => String(r[f] ?? null)));
          groups.set(key, [...(groups.get(key) ?? []), r]);
        }
        const having = args['having'] as Record<string, Record<string, unknown>> | undefined;
        const out: Row[] = [];
        for (const rows of groups.values()) {
          const first = rows[0] ?? {};
          const g: Row = {};
          for (const f of by) g[f] = first[f] ?? null;
          Object.assign(g, this.aggregates(rows, args));
          if (having !== undefined) {
            let keep = true;
            for (const [field, aggs] of Object.entries(having)) {
              for (const [agg, cond] of Object.entries(aggs)) {
                const a = this.aggregates(rows, { [agg]: { [field]: true } })[agg] as Row;
                if (!matchValue(a[field], cond)) keep = false;
              }
            }
            if (!keep) continue;
          }
          out.push(g);
        }
        return out;
      },
    };
  }

  /** A `prisma.client` stand-in: every model name resolves to a delegate over its table. */
  client(): unknown {
    return new Proxy(
      {},
      {
        get: (_t, model: string) => this.delegate(model),
      },
    );
  }
}
