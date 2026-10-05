import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BinType } from '@skydrop/db';
import {
  NON_PICKABLE_BIN_TYPES,
  PICKABLE_BIN_TYPES,
  moveWouldMakeStockSellable,
} from '../../src/modules/inventory-shared/bin-policy.service';

/**
 * BIN-2's direction rule, and the one waiver of it.
 *
 * Two bin moves write an identical pair of TRANSFER_OUT/TRANSFER_IN rows
 * and differ only in which bin TYPES they name. Neither
 * `BinBulkTransferService` nor `StockTransferService` looked at the type
 * at all, so `warehouse.manage` and `inventory.transfers.manage` could
 * each carry a DAMAGED, QUARANTINE, RTO_HOLD or TRANSIT bin's whole
 * contents onto the sellable floor — the outcome BIN-4 excludes those
 * types from a collapse to prevent, reached by a different door.
 *
 * The behaviour against a real database is in
 * `bin-ops-flow.e2e-spec.ts`; a mocked Prisma has no bin types to filter
 * on, which is exactly why the gap survived the unit suite. What this
 * file can prove is the two things source IS the honest answer to: that
 * the predicate is derived rather than restated, and that the waiver has
 * exactly one caller.
 */

const SRC = join(__dirname, '../../src');

/**
 * Source with its comments removed.
 *
 * Not an optimisation. `RBAC-1` records a spec that asserted
 * `toContain('@SellerRoles')` and passed for weeks because the only
 * remaining occurrence was inside a comment EXPLAINING the rule, after
 * the decorator itself had been deleted. This file hit the same thing on
 * its first run: the controller's comment says why it does not write
 * `transfer(body, …)`, and the regex looking for that call matched the
 * sentence saying it was avoided. Prose about a rule reads exactly like
 * the rule to a regex, so every source assertion below reads the stripped
 * text.
 */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('a bin move may not make unsellable stock sellable', () => {
  it('refuses every non-pickable source paired with every pickable destination', () => {
    // Enumerated from the enum rather than spot-checked, so a bin type
    // added tomorrow is covered by whichever list it joins.
    expect(NON_PICKABLE_BIN_TYPES.length).toBeGreaterThan(0);
    expect(PICKABLE_BIN_TYPES.length).toBeGreaterThan(0);
    for (const source of NON_PICKABLE_BIN_TYPES) {
      for (const dest of PICKABLE_BIN_TYPES) {
        expect(moveWouldMakeStockSellable(source, dest)).toBe(true);
      }
    }
  });

  it('allows the three directions that are not the problem', () => {
    // Conservative: a shelf's goods found broken and carried to DAMAGED.
    for (const source of PICKABLE_BIN_TYPES) {
      for (const dest of NON_PICKABLE_BIN_TYPES) {
        expect(moveWouldMakeStockSellable(source, dest)).toBe(false);
      }
    }
    // Neutral: re-organising the quarantine corner.
    for (const source of NON_PICKABLE_BIN_TYPES) {
      for (const dest of NON_PICKABLE_BIN_TYPES) {
        expect(moveWouldMakeStockSellable(source, dest)).toBe(false);
      }
    }
    // Ordinary: shelf to shelf.
    for (const source of PICKABLE_BIN_TYPES) {
      for (const dest of PICKABLE_BIN_TYPES) {
        expect(moveWouldMakeStockSellable(source, dest)).toBe(false);
      }
    }
  });

  it('covers TRANSIT, which the collapse service once missed', () => {
    // The named regression: `BinCollapseService` restated the list as
    // `['RTO_HOLD', 'DAMAGED', 'QUARANTINE']` — correct before CNS-1
    // added TRANSIT — and would have swept goods in the air between
    // Dhaka and India onto the floor. Deriving from the one list is what
    // stops this predicate repeating it, and this assertion is what
    // would fail if somebody inlined a literal here.
    expect(moveWouldMakeStockSellable(BinType.TRANSIT, BinType.STORAGE)).toBe(true);
    expect(NON_PICKABLE_BIN_TYPES).toContain(BinType.TRANSIT);
  });

  it('the waiver is passed by RtoPutawayService and nothing else', () => {
    // `allowFromNonPickableBin` turns the gate off. The one caller that
    // may pass it has already decided which units should become
    // sellable; anywhere else it is the way round the rule, and the
    // reviewer who adds it would be adding a one-word diff.
    const passing = tsFiles(SRC)
      .filter((f) => {
        // Comments describe the flag all over this change.
        const src = withoutComments(readFileSync(f, 'utf8'));
        return /allowFromNonPickableBin:\s*true/.test(src);
      })
      .map((f) => f.slice(SRC.length + 1));

    expect(passing).toEqual(['modules/warehouse-rto/services/rto-putaway.service.ts']);
  });

  it('the waiver is reachable from no request body', () => {
    // `CreateStockTransferDto` is the only shape an HTTP caller controls
    // on the way to `StockTransferService.transfer`, and the controller
    // builds the input field by field rather than forwarding the body —
    // so the flag has no route in even if the global
    // `forbidNonWhitelisted` were ever relaxed.
    const dto = withoutComments(
      readFileSync(join(SRC, 'modules/inventory-transfer/dto/stock-transfer.dto.ts'), 'utf8'),
    );
    expect(dto).not.toContain('allowFromNonPickableBin');

    const controller = withoutComments(
      readFileSync(
        join(SRC, 'modules/inventory-transfer/admin-stock-transfer.controller.ts'),
        'utf8',
      ),
    );
    expect(controller).not.toMatch(/transfer\(\s*body\s*,/);
  });

  it('both movers read the shared predicate rather than their own copy', () => {
    const movers = [
      'modules/warehouse-bin-ops/services/bin-bulk-transfer.service.ts',
      'modules/inventory-transfer/services/stock-transfer.service.ts',
    ];
    for (const rel of movers) {
      const src = withoutComments(readFileSync(join(SRC, rel), 'utf8'));
      expect(src).toContain('moveWouldMakeStockSellable');
      // A restated list is the drift BIN-2 exists to prevent.
      expect(src).not.toMatch(/RTO_HOLD['"]?\s*,\s*['"]?DAMAGED/);
    }
  });
});
