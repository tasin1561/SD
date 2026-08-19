import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA = join(__dirname, '../../../../packages/db/prisma/schema.prisma');

/**
 * A one-sided relation is not a compile error, and it is not a validation
 * error either. It is a silently invented COLUMN.
 *
 * Leave a relation field pointing at a model that does not point back and
 * `prisma format` makes it legal the only way it can: it adds the missing
 * back-relation, and on the side that needs a foreign key it invents a
 * scalar. `prisma validate` then passes, because the schema IS internally
 * consistent — it just describes a column no migration ever created. The
 * client asks for it, Postgres refuses, and the symptom is dozens of
 * failures pointing at whatever insert happened to run first.
 *
 * That happened three times in one afternoon while the freight bill moved
 * from the goods receipt to the consignment, and twice the two sides
 * regenerated each other so removing one alone did nothing.
 *
 * The fingerprint is exact. Every FK written on purpose in this schema
 * carries `@map("..._id")`, because the column convention is snake_case
 * (see CLAUDE.md → Naming). An INVENTED one has no `@map` — format uses
 * the camelCase field name verbatim. So a scalar `*Id` with no `@map` is
 * either an invented relation or a naming-convention breach, and both are
 * worth stopping here rather than fifteen minutes away in CI.
 */
describe('Prisma schema — relation hygiene', () => {
  const schema = readFileSync(SCHEMA, 'utf8');

  it('has no scalar foreign key without an @map — the invented-relation fingerprint', () => {
    const offenders: string[] = [];
    let model = '(top level)';
    for (const raw of schema.split('\n')) {
      const line = raw.trim();
      const modelStart = /^model\s+(\w+)\s*\{/.exec(line);
      if (modelStart?.[1] !== undefined) model = modelStart[1];
      // `foo   String?   @db.Uuid` and nothing else on the line.
      if (/^[a-z]\w*Id\s+String\??\s+@db\.Uuid\s*$/.test(line)) {
        offenders.push(`${model}.${line.split(/\s+/)[0] ?? line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every model that declares a relation LIST is pointed back at', () => {
    // The other half of the same trap. `Warehouse.consignments
    // Consignment[]` with nothing on Consignment naming a warehouse is
    // what made format invent `warehouseId` there — and that list was a
    // typo in the first place, landing on Warehouse because
    // `goodsReceipts GoodsReceipt[]` appears on Seller AND Warehouse and
    // a single-occurrence replace took the wrong one.
    const models = new Map<string, string>();
    for (const m of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
      const name = m[1];
      const body = m[2];
      if (name !== undefined && body !== undefined) models.set(name, body);
    }

    const unmatched: string[] = [];
    for (const [name, body] of models) {
      for (const line of body.split('\n')) {
        const list = /^\s*(\w+)\s+(\w+)\[\]/.exec(line);
        const target = list?.[2];
        if (target === undefined) continue;
        const targetBody = models.get(target);
        // An enum array or an unknown model is not this test's business.
        if (targetBody === undefined) continue;
        // Somewhere in the target, a field of this model's type. Either a
        // singular relation or a list (implicit many-to-many).
        const pointsBack = new RegExp(`^\\s*\\w+\\s+${name}(\\?|\\[\\])?(\\s|$)`, 'm').test(
          targetBody,
        );
        if (!pointsBack) unmatched.push(`${name}.${list?.[1] ?? '?'} -> ${target}`);
      }
    }
    expect(unmatched).toEqual([]);
  });
});
