/**
 * Composing a bin code from its grid coordinates.
 *
 * The bin code is NEVER typed freehand. Left to free text, one physical
 * shelf becomes `A-01-03`, `A-1-3` and `a01-03` — three bins holding the
 * same goods, and nobody notices for a month. Deriving the code from
 * three structured fields makes that class of mistake unrepresentable:
 * the separator and the padding are ours, and only a wrong *value* is
 * still possible.
 *
 * Pure — no Prisma, no Nest. The admin UI mirrors this exact function to
 * preview the code as the agent types; the server remains the authority.
 */

/** Uppercase letters, 1–2. Aisles run A…Z then AA…ZZ. */
const AISLE_RE = /^[A-Za-z]{1,2}$/;
/** Digits, 1–3. Padded to two so `3` and `03` cannot both exist. */
const NUMERIC_RE = /^\d{1,3}$/;

export interface BinGrid {
  readonly aisle: string;
  readonly rack: string;
  readonly shelf: string;
}

export type BinGridField = 'aisle' | 'rack' | 'shelf';

export interface BinGridProblem {
  readonly field: BinGridField;
  readonly message: string;
}

/**
 * The bin every warehouse has and nobody chooses: where stock goes when
 * the warehouse is not tracking locations. A real row, not a null — the
 * `stock_levels` unique key includes `bin_id`, so "no bin" cannot be
 * represented and the off state has to BE somewhere.
 *
 * Named for the physical truth: the goods are in a pile on the floor.
 */
export const FLOOR_BIN_CODE = 'FLOOR';
export const DEFAULT_ZONE_CODE = 'MAIN';

/**
 * Validate the three coordinates, collecting EVERY problem rather than
 * stopping at the first. An agent standing at a shelf with a carton in
 * their hands should be told everything that is wrong in one go.
 */
export function validateBinGrid(input: Partial<BinGrid>): BinGridProblem[] {
  const problems: BinGridProblem[] = [];
  const aisle = (input.aisle ?? '').trim();
  const rack = (input.rack ?? '').trim();
  const shelf = (input.shelf ?? '').trim();

  if (aisle.length === 0) {
    problems.push({ field: 'aisle', message: 'Aisle is required' });
  } else if (!AISLE_RE.test(aisle)) {
    problems.push({ field: 'aisle', message: 'Aisle must be 1–2 letters, e.g. A or AB' });
  }

  for (const [field, value] of [
    ['rack', rack],
    ['shelf', shelf],
  ] as const) {
    if (value.length === 0) {
      problems.push({ field, message: `${field === 'rack' ? 'Rack' : 'Shelf'} is required` });
    } else if (!NUMERIC_RE.test(value)) {
      problems.push({
        field,
        message: `${field === 'rack' ? 'Rack' : 'Shelf'} must be 1–3 digits, e.g. 1 or 03`,
      });
    }
  }
  return problems;
}

/**
 * `{ aisle: 'a', rack: '1', shelf: '3' }` → `A-01-03`.
 *
 * Throws on invalid input — callers validate first. The padding is what
 * makes the code canonical: `1` and `01` are the same rack and must
 * produce the same string.
 */
export function composeBinCode(input: BinGrid): string {
  const problems = validateBinGrid(input);
  if (problems.length > 0) {
    throw new Error(`Invalid bin grid: ${problems.map((p) => p.message).join('; ')}`);
  }
  const aisle = input.aisle.trim().toUpperCase();
  const rack = input.rack.trim().padStart(2, '0');
  const shelf = input.shelf.trim().padStart(2, '0');
  return `${aisle}-${rack}-${shelf}`;
}

/** The normalized coordinates that get stored alongside the code. */
export function normalizeBinGrid(input: BinGrid): BinGrid {
  return {
    aisle: input.aisle.trim().toUpperCase(),
    rack: input.rack.trim().padStart(2, '0'),
    shelf: input.shelf.trim().padStart(2, '0'),
  };
}
