import { NotificationChannel, SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import {
  SystemIssueNotifier,
  permissionsFor,
} from '../../src/modules/system-issues/services/system-issue-notifier.service';

/**
 * Being recorded is not the same as being told.
 *
 * The watchdogs that raise these issues exist to catch what nobody
 * notices, and for months their output landed on a page nobody was
 * asked to open — SD-2026-26-000001 made four real courier writes over
 * two days on a seven-hour loop while an issue sat there unread. What
 * is pinned here is the judgement about WHEN to interrupt somebody,
 * because a bell that rings for everything is a bell people turn off.
 */
describe('SystemIssueNotifier', () => {
  function make() {
    const calls: Record<string, unknown>[] = [];
    const dispatch = {
      dispatch: jest.fn(async (input: Record<string, unknown>) => {
        calls.push(input);
        return { groupId: 'g', recipients: 1, delivered: 1, skipped: 0, failures: 0 };
      }),
    };
    // The sweep reads open issues and asks which were already told
    // about; the per-issue tests never reach it.
    const issueFindMany = jest.fn(async () => [] as never);
    const logFindMany = jest.fn(async () => [] as never);
    const prisma = {
      client: {
        systemIssue: { findMany: issueFindMany },
        notificationLog: { findMany: logFindMany },
      },
    };
    return {
      svc: new SystemIssueNotifier(dispatch as never, prisma as never),
      calls,
      dispatch,
      issueFindMany,
      logFindMany,
    };
  }

  const base = {
    issueId: 'issue-1',
    kind: SystemIssueKind.TRACKING_STALLED,
    title: 'A parcel stopped matching its order',
    detail: 'SD-TEST-1 has been in DELIVERY_FAILED for two days.',
  };

  it('says nothing for LOW or MEDIUM', async () => {
    // LOW is "worth knowing" and MEDIUM is "this stopped and will stay
    // stopped". Both belong on the page; neither is worth interrupting
    // somebody for, and interrupting for them is what makes the HIGH
    // ones invisible.
    const c = make();
    await c.svc.notify({ ...base, severity: SystemIssueSeverity.LOW });
    await c.svc.notify({ ...base, severity: SystemIssueSeverity.MEDIUM });
    expect(c.calls).toHaveLength(0);
  });

  it('a HIGH issue reaches the inbox, and only the inbox', async () => {
    const c = make();
    await c.svc.notify({ ...base, severity: SystemIssueSeverity.HIGH });
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0]?.channels).toEqual([NotificationChannel.IN_APP]);
  });

  it('a CRITICAL issue also emails — it has to reach somebody not looking at the app', async () => {
    const c = make();
    await c.svc.notify({ ...base, severity: SystemIssueSeverity.CRITICAL });
    expect(c.calls[0]?.channels).toEqual([NotificationChannel.IN_APP, NotificationChannel.EMAIL]);
    expect(String(c.calls[0]?.title)).toContain('Critical:');
  });

  it('carries the detail VERBATIM — it is the part that says what to do', async () => {
    const c = make();
    await c.svc.notify({ ...base, severity: SystemIssueSeverity.HIGH });
    expect(String(c.calls[0]?.body)).toContain(base.detail);
    expect(String(c.calls[0]?.body)).toContain('/system-issues');
  });

  it('is keyed on the issue so a retry cannot send twice', async () => {
    const c = make();
    await c.svc.notify({ ...base, severity: SystemIssueSeverity.HIGH });
    expect(c.calls[0]?.eventId).toBe('system_issue:issue-1');
  });

  it('a dispatch failure is swallowed — the caller is already in a failure path', async () => {
    // An alerting layer that throws inside a catch block turns a
    // handled problem into an unhandled one. Same discipline as
    // SystemIssueService.raise() itself.
    const c = make();
    c.dispatch.dispatch.mockImplementationOnce(async () => {
      throw new Error('everything is on fire');
    });
    await expect(
      c.svc.notify({ ...base, severity: SystemIssueSeverity.CRITICAL }),
    ).resolves.toBeUndefined();
  });

  it('exposes a drain, and it awaits what is still in flight', async () => {
    // The M11 listener's pattern, and the rule CLAUDE.md states for
    // any new fire-and-forget async DB writer. Without it, a
    // notification_logs INSERT races the e2e reset's TRUNCATE and
    // Postgres kills one of them with a 40P01 naming neither the test
    // nor the cause — which is exactly how this arrived, on CI.
    const c = make();
    let release = (): void => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    c.dispatch.dispatch.mockImplementationOnce(async () => {
      await gate;
      return { groupId: 'g', recipients: 1, delivered: 1, skipped: 0, failures: 0 };
    });

    let done = false;
    const notifying = c.svc.notify({ ...base, severity: SystemIssueSeverity.HIGH }).then(() => {
      done = true;
    });

    const drained = c.svc.drainInFlight();
    expect(done).toBe(false);
    release();
    await Promise.all([notifying, drained]);
    expect(done).toBe(true);
  });

  it('draining with nothing in flight is a no-op', async () => {
    const c = make();
    await expect(c.svc.drainInFlight()).resolves.toBeUndefined();
  });
});

describe('announceUnnotified — the ones nobody was told about', () => {
  function sweep(
    open: ReadonlyArray<Record<string, unknown>>,
    alreadyToldEventIds: readonly string[] = [],
  ) {
    const calls: Record<string, unknown>[] = [];
    const dispatch = {
      dispatch: jest.fn(async (input: Record<string, unknown>) => {
        calls.push(input);
        return { groupId: 'g', recipients: 1, delivered: 1, skipped: 0, failures: 0 };
      }),
    };
    const prisma = {
      client: {
        // Typed rather than inferred: a mock whose only return is an
        // empty array narrows its args to `never`, and reading
        // `.mock.calls[0][0]` off it stops compiling.
        systemIssue: {
          findMany: jest.fn(
            async (_args: { where: Record<string, { in?: unknown[] } | null> }) => open as never,
          ),
        },
        notificationLog: {
          findMany: jest.fn(
            async () => alreadyToldEventIds.map((eventId) => ({ eventId })) as never,
          ),
        },
      },
    };
    return {
      svc: new SystemIssueNotifier(dispatch as never, prisma as never),
      calls,
      issueFindMany: prisma.client.systemIssue.findMany,
    };
  }

  const ISSUE = {
    id: 'issue-1',
    kind: SystemIssueKind.INTEGRATION,
    severity: SystemIssueSeverity.HIGH,
    title: 'A courier has refused this parcel four times',
    detail: 'Place it by hand or fix what they objected to.',
  };

  it('announces an open issue nobody was told about', async () => {
    // The case this exists for: `raise()` only announces a NEW issue,
    // so everything open the day notifying was added is otherwise
    // silent forever.
    const c = sweep([ISSUE]);
    expect(await c.svc.announceUnnotified()).toEqual({
      open: 1,
      announced: 1,
      alreadyAnnounced: 0,
    });
    expect(c.calls[0]?.eventId).toBe('system_issue:issue-1');
  });

  it('says nothing about one that was already announced', async () => {
    const c = sweep([ISSUE], ['system_issue:issue-1']);
    expect(await c.svc.announceUnnotified()).toEqual({
      open: 1,
      announced: 0,
      alreadyAnnounced: 1,
    });
    expect(c.calls).toHaveLength(0);
  });

  it('is safe to re-run: the dedup key is the issue, not the run', async () => {
    // Idempotence here is a property of the NOTIF-2 partial unique on
    // `system_issue:<id>`, not of this query being right — which is
    // what makes it safe behind a button.
    const c = sweep([ISSUE]);
    await c.svc.announceUnnotified();
    expect(c.calls[0]?.eventId).toBe('system_issue:issue-1');
    // Even if the "was it told?" lookup were wrong, the second send
    // carries the identical event id and the unique index refuses it.
    const second = sweep([ISSUE]);
    await second.svc.announceUnnotified();
    expect(second.calls[0]?.eventId).toBe(c.calls[0]?.eventId);
  });

  it('only looks at OPEN issues, and only HIGH or CRITICAL', async () => {
    const c = sweep([]);
    await c.svc.announceUnnotified();
    const where = c.issueFindMany.mock.calls[0]?.[0]?.where ?? {};
    expect(where).toMatchObject({
      resolvedAt: null,
      severity: { in: [SystemIssueSeverity.HIGH, SystemIssueSeverity.CRITICAL] },
    });
  });

  it('nothing open is a clean no-op', async () => {
    const c = sweep([]);
    expect(await c.svc.announceUnnotified()).toEqual({
      open: 0,
      announced: 0,
      alreadyAnnounced: 0,
    });
    expect(c.calls).toHaveLength(0);
  });
});

describe('permissionsFor — who is told, per kind', () => {
  it('every kind is routed, and every audience can open the page', () => {
    // A notification pointing at a page the reader cannot open is a
    // dead end, so `system.settings.view` — the gate on /system-issues
    // — has to be on every list.
    for (const kind of Object.values(SystemIssueKind)) {
      const perms = permissionsFor(kind);
      expect(perms.length).toBeGreaterThan(0);
      expect(perms).toContain('system.settings.view');
    }
  });

  it('a warehouse scan also reaches the supervisor on the floor', () => {
    // A blocked operator is standing at a bench holding a parcel. The
    // supervisor acts on this minutes before whoever watches settings.
    expect(permissionsFor(SystemIssueKind.WAREHOUSE_SCAN)).toContain('warehouse.pick.supervise');
  });

  it('a courier credential problem reaches whoever manages courier accounts', () => {
    expect(permissionsFor(SystemIssueKind.COURIER_CREDENTIAL)).toContain('courier.accounts.manage');
  });

  it('a stalled parcel reaches whoever works orders', () => {
    expect(permissionsFor(SystemIssueKind.TRACKING_STALLED)).toContain('orders.view');
  });

  it('every permission named is one that actually exists', async () => {
    // A permission nobody holds is an audience of nobody, and it fails
    // exactly the way the old code did: silently.
    const { ALL_PERMISSION_KEYS } = await import('../../src/common/auth/permissions');
    const known = new Set<string>(ALL_PERMISSION_KEYS);
    const unknown = Object.values(SystemIssueKind).flatMap((k) =>
      permissionsFor(k).filter((p) => !known.has(p)),
    );
    expect(unknown).toEqual([]);
  });
});
