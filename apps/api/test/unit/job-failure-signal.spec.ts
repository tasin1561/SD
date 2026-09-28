import {
  classifyJobFailure,
  shouldReportRecurring,
} from '../../src/modules/system-issues/services/job-failure-signal';

/**
 * The two judgements that decide whether a failed scheduled run is worth
 * a person's attention, and what the card says when it is.
 */
describe('classifyJobFailure', () => {
  it.each([
    "Can't reach database server at `private-skydrop-db-prod:25060`",
    'Invalid `prisma.order.findMany()` invocation: Error querying the database: P1001',
    'Timed out fetching a new connection from the connection pool',
    'connect ECONNREFUSED 127.0.0.1:6379',
    'socket hang up',
    'Stream isn’t writeable and enableOfflineQueue options is false: max retries per request',
  ])('reads %s as infrastructure', (message) => {
    expect(classifyJobFailure(message)).toBe('INFRASTRUCTURE');
  });

  it.each([
    'Cannot read properties of undefined (reading "sellerId")',
    'RESELLER_CREDIT_ALREADY_PAID',
    'Unique constraint failed on the fields: (`dedupe_key`)',
  ])('leaves %s as unknown, where the old wording was right', (message) => {
    expect(classifyJobFailure(message)).toBe('UNKNOWN');
  });
});

describe('shouldReportRecurring', () => {
  const minutes = (n: number): number => n * 60 * 1000;

  it('never reports one failed run, whatever the cadence', () => {
    expect(shouldReportRecurring(1, 0)).toBe(false);
    expect(shouldReportRecurring(1, minutes(60 * 24))).toBe(false);
  });

  it('reports a fast sweep on its third run in a row', () => {
    // The five-minute pack-box sweep: two in a row is ten minutes of a
    // database wobble, which the next tick absorbs.
    expect(shouldReportRecurring(2, minutes(5))).toBe(false);
    expect(shouldReportRecurring(3, minutes(10))).toBe(true);
  });

  it('reports a slow job on its second, rather than waiting three days', () => {
    expect(shouldReportRecurring(2, minutes(10))).toBe(true);
    expect(shouldReportRecurring(2, minutes(60 * 24))).toBe(true);
  });
});
