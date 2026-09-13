import { AdvisoryLock } from '../../src/common/db/advisory-lock';
import {
  allocateTicketNumber,
  formatTicketNumber,
  TICKET_NUMBER_PATTERN,
} from '../../src/modules/ticket/services/ticket-numbering';
import type { Prisma } from '@skydrop/db';

/**
 * Fake Postgres: per-name in-memory sequences with nextval semantics —
 * enough to pin the format, the per-year rollover and that everything
 * runs on the transaction it is handed. Cross-connection uniqueness is the
 * UNIQUE index's job, which only a real database can show.
 */
function fakeTx() {
  const seqs = new Map<string, number>();
  const calls: string[] = [];
  const locks: Array<[unknown, unknown]> = [];
  const tx = {
    $executeRawUnsafe: jest.fn(async (q: string, ...vals: unknown[]): Promise<number> => {
      calls.push(q);
      if (q.includes('pg_advisory_xact_lock')) locks.push([vals[0], vals[1]]);
      const created = /CREATE SEQUENCE IF NOT EXISTS "([^"]+)"/.exec(q)?.[1];
      if (created !== undefined && !seqs.has(created)) seqs.set(created, 0);
      return 0;
    }),
    $queryRawUnsafe: jest.fn(async (q: string): Promise<Array<{ value: bigint }>> => {
      calls.push(q);
      const name = /nextval\('"([^"]+)"'\)/.exec(q)?.[1] ?? '';
      const next = (seqs.get(name) ?? 0) + 1;
      seqs.set(name, next);
      return [{ value: BigInt(next) }];
    }),
  };
  return { tx: tx as unknown as Prisma.TransactionClient, calls, locks, seqs };
}

describe('ticket numbering', () => {
  it('formats TK-YYYY-NNNNNN, and does not truncate past six digits', () => {
    expect(formatTicketNumber(2026, 3)).toBe('TK-2026-000003');
    expect(formatTicketNumber(2026, 1234567)).toBe('TK-2026-1234567');
    expect(TICKET_NUMBER_PATTERN.test('TK-2026-000003')).toBe(true);
    expect(TICKET_NUMBER_PATTERN.test('tk-2026-000003')).toBe(true);
    expect(TICKET_NUMBER_PATTERN.test('SD-2026-26-000003')).toBe(false);
  });

  it('allocates on the transaction it is given, under the TICKET_NUMBER lock, per year', async () => {
    const { tx, locks, seqs } = fakeTx();
    const at = new Date(Date.UTC(2026, 8, 13));
    expect(await allocateTicketNumber(tx, at)).toBe('TK-2026-000001');
    expect(await allocateTicketNumber(tx, at)).toBe('TK-2026-000002');
    expect(await allocateTicketNumber(tx, new Date(Date.UTC(2027, 0, 1)))).toBe('TK-2027-000001');
    expect(locks[0]).toEqual([AdvisoryLock.TICKET_NUMBER, 2026]);
    expect([...seqs.keys()]).toEqual(['ticket_number_seq_2026', 'ticket_number_seq_2027']);
  });

  it('uses the UTC year — the one the backfill migration used for created_at', async () => {
    const { tx } = fakeTx();
    // 20:00 UTC on 31 Dec is already 1 Jan in India, but still 2026 in UTC.
    expect(await allocateTicketNumber(tx, new Date('2026-12-31T20:00:00Z'))).toBe('TK-2026-000001');
  });

  it('has its own advisory-lock namespace, shared with nobody', () => {
    const values = Object.values(AdvisoryLock);
    expect(values.filter((v) => v === AdvisoryLock.TICKET_NUMBER)).toHaveLength(1);
  });
});
