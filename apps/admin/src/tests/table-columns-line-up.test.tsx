import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * A table whose header count does not match its cell count.
 *
 * This is invisible in every other gate. It compiles, it renders, no
 * console warning fires — the browser simply lays the cells out left to
 * right and every value after the gap sits under the wrong name. The
 * Remittances "Approved, waiting to be paid" table shipped with five
 * headers and four cells: the wallet balance column had no cell, so the
 * waiting time rendered underneath "Wallet balance" and the Pay button
 * under "Waiting". It read as a working screen with a blank column.
 *
 * Counting is deliberately static and skips what it cannot count
 * honestly — a `colSpan` is a spanned cell on purpose, and an empty
 * state renders its own row shape. A guard that fires on a case it
 * cannot see is one people learn to ignore.
 */

const ROOTS = ['apps/admin/src', 'apps/seller/src'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules' && entry !== '.next') walk(full, out);
    } else if (entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

function mismatches(): string[] {
  const repo = join(__dirname, '..', '..', '..', '..');
  const found: string[] = [];
  for (const root of ROOTS) {
    for (const file of walk(join(repo, root))) {
      const src = readFileSync(file, 'utf8');
      for (const table of src.matchAll(/<THead>(.*?)<\/THead>(.*?)<\/Table>/gs)) {
        const head = table[1] ?? '';
        const body = table[2] ?? '';
        if (head.includes('colSpan')) continue;
        const headerCount = (head.match(/<Th[\s/>]/g) ?? []).length;
        if (headerCount === 0) continue;
        for (const row of body.matchAll(/<Tr[^>]*>(.*?)<\/Tr>/gs)) {
          const cells = row[1] ?? '';
          if (cells.includes('colSpan') || cells.includes('TableEmpty')) continue;
          const cellCount = (cells.match(/<Td[\s/>]/g) ?? []).length;
          if (cellCount === 0) continue;
          if (cellCount !== headerCount) {
            found.push(`${relative(repo, file)} — ${headerCount} headers vs ${cellCount} cells`);
          }
        }
      }
    }
  }
  return [...new Set(found)].sort();
}

describe('every table has one cell per header', () => {
  it('finds no row that would render under the wrong column name', () => {
    expect(mismatches()).toEqual([]);
  });

  it('is actually looking at tables — the sweep is not vacuously empty', () => {
    // A guard that silently stopped matching would also report zero.
    const repo = join(__dirname, '..', '..', '..', '..');
    const tables = ROOTS.flatMap((r) => walk(join(repo, r)))
      .map((f) => (readFileSync(f, 'utf8').match(/<THead>/g) ?? []).length)
      .reduce((a, b) => a + b, 0);
    expect(tables).toBeGreaterThan(20);
  });
});
