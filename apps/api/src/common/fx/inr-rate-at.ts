import { Currency, Prisma } from '@skydrop/db';

/** The subset of a Prisma client this needs — a transaction works too. */
type RateReader = Pick<Prisma.TransactionClient, 'fxRateHistory' | 'fxRate'>;

export interface InrRateAt {
  /** INR per ONE unit of the currency. */
  readonly inrPerUnit: Prisma.Decimal;
  /** The row as stored, so the conversion can be restated exactly. */
  readonly storedPair: string;
  readonly storedRate: string;
  /** HISTORY: the latest rate recorded at or before the instant. CURRENT:
   *  none was, so today's rate stood in. IDENTITY: already INR. */
  readonly source: 'HISTORY' | 'CURRENT' | 'IDENTITY';
  readonly recordedAt: Date | null;
}

/**
 * The rupee value of an amount of `currency` at the instant `at`: the
 * LATEST rate recorded at or before it (`fx_rate_history`), else today's
 * (`fx_rates`). The same rule the P&L converts a taka expense by, so a
 * cost stamped here and the figure the report derives agree.
 *
 * A stored rate is "1 fromCurrency = rate toCurrency" in either
 * direction; BDT→INR 0.813008 and INR→BDT 1.23 are the same fact. The
 * direction it was stored in is kept so the conversion divides rather
 * than multiplies by a reciprocal (fewer rounding steps).
 *
 * Null when there is no rate at all — the caller refuses rather than
 * guesses.
 */
export async function inrRateAt(
  db: RateReader,
  currency: Currency,
  at: Date,
): Promise<InrRateAt | null> {
  if (currency === Currency.INR) {
    return {
      inrPerUnit: new Prisma.Decimal(1),
      storedPair: 'INR→INR',
      storedRate: '1',
      source: 'IDENTITY',
      recordedAt: null,
    };
  }
  const pair = [
    { fromCurrency: currency, toCurrency: Currency.INR },
    { fromCurrency: Currency.INR, toCurrency: currency },
  ];
  const hist = await db.fxRateHistory.findFirst({
    where: { recordedAt: { lte: at }, OR: pair },
    orderBy: { recordedAt: 'desc' },
    select: { fromCurrency: true, toCurrency: true, rate: true, recordedAt: true },
  });
  const current =
    hist === null
      ? await db.fxRate.findFirst({
          where: { OR: pair },
          select: { fromCurrency: true, toCurrency: true, rate: true },
        })
      : null;
  const row = hist ?? current;
  if (row === null || row.rate.isZero()) return null;
  return {
    inrPerUnit: row.fromCurrency === currency ? row.rate : new Prisma.Decimal(1).div(row.rate),
    storedPair: `${row.fromCurrency}→${row.toCurrency}`,
    storedRate: row.rate.toString(),
    source: hist === null ? 'CURRENT' : 'HISTORY',
    recordedAt: hist?.recordedAt ?? null,
  };
}

/** `amount` of the rate's currency, in rupees to the paisa. */
export function toInr(amount: Prisma.Decimal, rate: InrRateAt): Prisma.Decimal {
  // Divide by an INR→X rate rather than multiply by its reciprocal:
  // ৳2,000 at INR→BDT 1.23 is 1,626.02, and a 1/1.23 rounded first lands
  // a paisa off on large amounts.
  if (rate.storedPair.startsWith('INR→') && rate.source !== 'IDENTITY') {
    return amount.div(new Prisma.Decimal(rate.storedRate)).toDecimalPlaces(2);
  }
  return amount.mul(rate.inrPerUnit).toDecimalPlaces(2);
}
