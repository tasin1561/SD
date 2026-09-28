/**
 * Why a job failed — in the only distinction that changes what the
 * person reading the board should go and look at.
 *
 * The wording on a `job-failed:` card used to say, always: "a single
 * occurrence is usually one bad row". On 24 September one brief
 * database failover caught three scheduled sweeps mid-run, and every
 * one of them told its reader to go looking for data. Three people-hours
 * of the wrong search is what a confidently wrong sentence costs.
 *
 * INFRASTRUCTURE is "the database, Redis or a remote host was not
 * reachable" — nothing was wrong with the work, and the fix (if any) is
 * somewhere other than our rows. UNKNOWN is everything else, which is
 * where the old wording was right.
 *
 * Pure, so it can be exercised without a queue, a database or a clock.
 */
export type JobFailureCause = 'INFRASTRUCTURE' | 'UNKNOWN';

/**
 * Matched against the error MESSAGE, because that is all a `failed`
 * listener is handed — BullMQ serialises the failure reason through
 * Redis, so the original error class does not survive the round trip.
 *
 * Deliberately a list of fingerprints rather than a clever rule: each
 * one is a thing we have actually seen, and an unmatched message falls
 * back to the cautious wording rather than to a guess.
 */
const INFRASTRUCTURE_FINGERPRINTS: readonly RegExp[] = [
  // Prisma, when the managed database is failing over or unreachable.
  /can'?t reach database server/i,
  /\bP1001\b|\bP1002\b|\bP1008\b|\bP1017\b/,
  /connection pool/i,
  /server has closed the connection/i,
  /connection (terminated|closed|lost|reset)/i,
  // Node / libuv socket errors, from any dependency.
  /\bECONNREFUSED\b|\bECONNRESET\b|\bETIMEDOUT\b|\bEPIPE\b|\bEHOSTUNREACH\b|\bENETUNREACH\b|\bEAI_AGAIN\b/,
  /socket hang up/i,
  /getaddrinfo/i,
  // ioredis, when Redis itself is the thing that went away.
  /max retries per request/i,
  // Generic, and last: a timeout is a dependency that did not answer.
  /timed out|timeout/i,
];

export function classifyJobFailure(message: string): JobFailureCause {
  return INFRASTRUCTURE_FINGERPRINTS.some((re) => re.test(message)) ? 'INFRASTRUCTURE' : 'UNKNOWN';
}

/**
 * Three runs in a row, or two spanning ten minutes.
 *
 * Two rules rather than one because a single count cannot serve both
 * ends of the cadence range this codebase runs. Three-in-a-row is the
 * rule for the fast sweeps — the pack-box sweep every five minutes, the
 * courier outbox every minute — where a short database wobble catches
 * one or two ticks and means nothing. It is the wrong rule for a
 * nightly job: three in a row is three days of silence about a cost sync
 * that stopped working on Monday.
 *
 * So a job whose runs are far apart qualifies on the second one instead.
 * Ten minutes is comfortably longer than any failover we have seen and
 * comfortably shorter than an hourly sweep, so it separates the two
 * populations without either rule having to know anything about crons.
 */
export const RECURRING_RUNS_BEFORE_ISSUE = 3;
export const RECURRING_SLOW_RUNS_BEFORE_ISSUE = 2;
export const RECURRING_SLOW_SPAN_MS = 10 * 60 * 1000;

export function shouldReportRecurring(failedRuns: number, spanMs: number): boolean {
  if (failedRuns >= RECURRING_RUNS_BEFORE_ISSUE) return true;
  return failedRuns >= RECURRING_SLOW_RUNS_BEFORE_ISSUE && spanMs >= RECURRING_SLOW_SPAN_MS;
}
