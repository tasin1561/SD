import { SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import { SystemIssueService } from '../../src/modules/system-issues/services/system-issue.service';

/**
 * What a RECURRENCE does to a row that is already open.
 *
 * ── THE BUG THIS PINS ────────────────────────────────────────────────
 * `raise()` refreshed `detail` and `severity` and left `kind` and
 * `title` frozen at whatever the first raise said. The moment two
 * failure modes reach one dedupe key, the row contradicts itself — and
 * the title is the part a person acts on.
 *
 * Measured on production, 29 September to 5 October 2026:
 * `wallet-sync:<account>` sat open titled "Delhivery is asking … to
 * prove it is human" with a Playwright selector timeout for a detail,
 * and its severity had been silently rewritten HIGH → MEDIUM on night
 * two. NOTIF-16 notifies on HIGH and CRITICAL and only when an issue is
 * NEW, so after night one nobody was ever told again — and whoever read
 * the board went to clear a challenge that did not exist.
 *
 * So: descriptive fields move together, and severity cannot fall unless
 * the caller said it may.
 */
/** What a Prisma `updateMany` is handed. Typed so `mock.calls[0]` is reachable. */
interface UpdateManyArgs {
  readonly where: Record<string, unknown>;
  readonly data: Record<string, unknown>;
}

function build(open: { id: string; severity: SystemIssueSeverity } | null) {
  const systemIssue = {
    updateMany: jest.fn(async (_args: UpdateManyArgs) => ({ count: open === null ? 0 : 1 })),
    findFirst: jest.fn(async () => open),
    create: jest.fn(async (_args: { data: Record<string, unknown> }) => ({ id: 'issue-new' })),
  };
  const notify = jest.fn(
    async (_input: { issueId: string; severity: SystemIssueSeverity }) => undefined,
  );
  const svc = new SystemIssueService({ client: { systemIssue } } as never, { notify } as never);
  return { svc, systemIssue, notify };
}

/** Every `updateMany` whose `data` carries a severity. */
function severityWrites(systemIssue: { updateMany: jest.Mock }): UpdateManyArgs[] {
  return systemIssue.updateMany.mock.calls
    .map((c) => c[0] as UpdateManyArgs)
    .filter((a) => a.data['severity'] !== undefined);
}

const input = (over: Partial<Parameters<SystemIssueService['raise']>[0]> = {}) => ({
  kind: SystemIssueKind.COURIER_COST_SYNC,
  severity: SystemIssueSeverity.MEDIUM,
  title: 'Could not read what Delhivery charged MS EXPORTS',
  detail: 'locator timeout on the company picker',
  source: 'WalletSyncService',
  dedupeKey: 'wallet-sync:acct-1',
  ...over,
});

/** The `updateMany` call that carries the descriptive fields. */
function descriptiveUpdate(systemIssue: { updateMany: jest.Mock }): Record<string, unknown> {
  const call = systemIssue.updateMany.mock.calls
    .map((c) => c[0] as UpdateManyArgs)
    .find((a) => a.data['detail'] !== undefined);
  if (call === undefined) throw new Error('no descriptive updateMany was issued');
  return call.data;
}

describe('a recurrence restates the whole diagnosis', () => {
  it('refreshes kind, title AND detail together', async () => {
    const { svc, systemIssue } = build({ id: 'i1', severity: SystemIssueSeverity.MEDIUM });
    await svc.raise(input());
    const data = descriptiveUpdate(systemIssue);
    expect(data['title']).toBe('Could not read what Delhivery charged MS EXPORTS');
    expect(data['kind']).toBe(SystemIssueKind.COURIER_COST_SYNC);
    expect(data['detail']).toBe('locator timeout on the company picker');
    // Counting the occurrence is what makes one row mean "fourteen
    // nights", so it must still be incremented.
    expect(data['occurrenceCount']).toEqual({ increment: 1 });
  });

  it('does NOT write severity in the same statement as the description', async () => {
    // Severity is a routing decision, not a description, and it is
    // decided by the rules below. Folding it in here is what allowed
    // the silent downgrade.
    const { svc, systemIssue } = build({ id: 'i1', severity: SystemIssueSeverity.HIGH });
    await svc.raise(input());
    expect(descriptiveUpdate(systemIssue)['severity']).toBeUndefined();
  });
});

describe('severity cannot drop silently', () => {
  it('refuses a quieter recurrence the caller did not ask for', async () => {
    const { svc, systemIssue } = build({ id: 'i1', severity: SystemIssueSeverity.HIGH });
    await svc.raise(input({ severity: SystemIssueSeverity.MEDIUM }));
    // Nothing lowered the row: the only write is the descriptive one.
    expect(severityWrites(systemIssue)).toHaveLength(0);
  });

  it('allows it when the caller says the window really has closed', async () => {
    // COST-3's invoice disagreement: HIGH while it can be disputed,
    // MEDIUM once it cannot. A real de-escalation, declared.
    const { svc, systemIssue } = build({ id: 'i1', severity: SystemIssueSeverity.HIGH });
    await svc.raise(input({ severity: SystemIssueSeverity.MEDIUM, severityMayFall: true }));
    const writes = severityWrites(systemIssue);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.data['severity']).toBe(SystemIssueSeverity.MEDIUM);
    // Guarded on the severity it READ, so a concurrent raise cannot be
    // overwritten by a stale decision.
    expect(writes[0]?.where['severity']).toBe(SystemIssueSeverity.HIGH);
  });

  it('never notifies on a de-escalation', async () => {
    const { svc, notify } = build({ id: 'i1', severity: SystemIssueSeverity.CRITICAL });
    await svc.raise(input({ severity: SystemIssueSeverity.LOW, severityMayFall: true }));
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('an open issue that gets worse', () => {
  it('is escalated, guarded on the quieter severities', async () => {
    const { svc, systemIssue } = build({ id: 'i1', severity: SystemIssueSeverity.MEDIUM });
    await svc.raise(input({ severity: SystemIssueSeverity.HIGH }));
    const writes = severityWrites(systemIssue);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.data['severity']).toBe(SystemIssueSeverity.HIGH);
    const guard = writes[0]?.where['severity'] as { in: SystemIssueSeverity[] };
    expect(guard.in).toEqual(
      expect.arrayContaining([SystemIssueSeverity.LOW, SystemIssueSeverity.MEDIUM]),
    );
    expect(guard.in).not.toContain(SystemIssueSeverity.CRITICAL);
  });

  it('TELLS somebody when it crosses into notifying territory', async () => {
    // NOTIF-16 notifies only on a NEW issue, so a row that opened
    // MEDIUM and later became HIGH would otherwise stay unannounced for
    // ever — the same silence as a downgrade, from the other end.
    const { svc, notify } = build({ id: 'i1', severity: SystemIssueSeverity.MEDIUM });
    await svc.raise(input({ severity: SystemIssueSeverity.CRITICAL }));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: 'i1', severity: SystemIssueSeverity.CRITICAL }),
    );
  });

  it('does not re-tell when it was already loud', async () => {
    const { svc, notify } = build({ id: 'i1', severity: SystemIssueSeverity.HIGH });
    await svc.raise(input({ severity: SystemIssueSeverity.CRITICAL }));
    expect(notify).not.toHaveBeenCalled();
  });

  it('says nothing at all when the severity has not moved', async () => {
    const { svc, systemIssue, notify } = build({ id: 'i1', severity: SystemIssueSeverity.MEDIUM });
    await svc.raise(input({ severity: SystemIssueSeverity.MEDIUM }));
    expect(severityWrites(systemIssue)).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('a NEW issue is unchanged', () => {
  it('still creates the row and notifies through the ordinary path', async () => {
    const { svc, systemIssue, notify } = build(null);
    await svc.raise(input({ severity: SystemIssueSeverity.HIGH }));
    expect(systemIssue.create).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
