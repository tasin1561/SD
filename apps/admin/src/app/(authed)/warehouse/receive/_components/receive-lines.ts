import type { RecordReceiptLineInput } from '@skydrop/api-client';

/**
 * Turning what is typed on the receive bench into a `recordLines` call.
 *
 * ── WHY THIS IS A FUNCTION AND NOT INLINE ────────────────────────────
 * It used to be a block inside `onRecordAll`, where the only way to
 * check it was to drive the whole screen. The rule it got wrong is the
 * kind that is invisible from a rendered page and obvious from a table
 * of inputs and outputs, so it lives here, with a spec.
 *
 * ── THE BIN IS NOT OURS TO DEMAND (BIN-1 / FE-2) ─────────────────────
 * This refused any line with `qty > 0` and no bin, UNCONDITIONALLY. The
 * server does not: `BinPolicyService.resolvePutawayBin` is the ONE
 * reader of `binTrackingEnabled` (BIN-1), and with tracking OFF it
 * returns `requestedBinId ?? floorBinId` — a bin is honoured if given
 * and NOT required if not. With tracking ON it refuses by name,
 * `BIN_REQUIRED`, with prose written for an operator.
 *
 * So the client was mirroring a server policy — which FE-2 forbids
 * outright — and mirroring it WRONGLY, in the direction that blocks
 * work: at a warehouse that does not track locations (which is the
 * default, and which the J1 tracking panel describes as "receiving can
 * still note one, but it is only a note") an operator could not record
 * a line at all without choosing a bin whose only effect is to be
 * recorded. Nothing failed loudly; the Save button simply refused, with
 * a message the operator could not act on because the premise was false.
 *
 * The fix is to decide nothing here. The bin is passed through when one
 * was chosen and omitted when it was not, and the server — the only
 * security and policy boundary there is — answers. What stays is
 * arithmetic the server cannot do for us before it has a request at
 * all: a number that is not a number.
 */

export interface ReceiveLineRow {
  readonly id: string;
  readonly skuCode: string;
}

export type BuildReceiptLinesResult =
  | { readonly ok: true; readonly lines: readonly RecordReceiptLineInput[] }
  | { readonly ok: false; readonly error: string };

/**
 * @param rows        the receipt's lines, in the order they are shown
 * @param received    typed received quantities, keyed by line id
 * @param damaged     typed damaged quantities, keyed by line id
 * @param binByLine   chosen putaway bin, keyed by line id — may be empty
 */
export function buildReceiptLines(
  rows: readonly ReceiveLineRow[],
  received: Readonly<Record<string, string>>,
  damaged: Readonly<Record<string, string>>,
  binByLine: Readonly<Record<string, string>>,
): BuildReceiptLinesResult {
  const lines: RecordReceiptLineInput[] = [];

  for (const row of rows) {
    const recv = received[row.id]?.trim() ?? '';
    // A line nobody typed into is a line nobody counted. It is not an
    // error and it is not a zero — it is simply not part of this save.
    if (recv === '') continue;

    const n = Number(recv);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: `Invalid received qty on line ${row.skuCode}` };
    }

    const d = Number(damaged[row.id]?.trim() ?? '0');
    if (!Number.isFinite(d) || d < 0) {
      return { ok: false, error: `Invalid damaged qty on line ${row.skuCode}` };
    }

    const bin = binByLine[row.id]?.trim() ?? '';
    lines.push({
      lineId: row.id,
      receivedQty: n,
      damagedQty: d,
      // Omitted rather than sent empty: an absent bin is the question
      // `resolvePutawayBin` is built to answer, and `''` is not a bin id.
      ...(bin ? { putawayBinId: bin } : {}),
    });
  }

  if (lines.length === 0) {
    return { ok: false, error: 'Nothing to record — fill in at least one line.' };
  }
  return { ok: true, lines };
}
