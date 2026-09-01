import { TrackingRecoveryService } from '../../src/modules/tracking-poll/services/tracking-recovery.service';

function makeSvc(opts: {
  stale: boolean;
  autoRecover?: boolean | null;
  alertEmail?: string;
  recoversOnRetry?: boolean;
}) {
  const healths = [
    {
      stale: opts.stale,
      minutesSinceLastRun: opts.stale ? 90 : 3,
      lastRunAtIso: null,
      cronPattern: '*/20 * * * *',
    },
    {
      stale: opts.recoversOnRetry === false,
      minutesSinceLastRun: 0,
      lastRunAtIso: null,
      cronPattern: '*/20 * * * *',
    },
  ];
  let call = 0;
  const pollAll = jest.fn(async () => ({
    stubMode: false,
    shipmentsExamined: 0,
    scansApplied: 0,
    transitions: 0,
  }));
  const poll = { health: jest.fn(async () => healths[Math.min(call++, 1)]), pollAll };
  const audit = { log: jest.fn(async () => undefined) };
  const email = { enqueue: jest.fn(async () => undefined) };
  const prisma = {
    client: {
      systemSetting: {
        findUnique: jest.fn(async (args: { where: { key: string } }) =>
          args.where.key.includes('auto_recover')
            ? { valueBoolean: opts.autoRecover ?? true }
            : { valueString: opts.alertEmail ?? 'ops@skydrop.online' },
        ),
      },
    },
  };
  const queue = { ensureScheduled: jest.fn(async () => undefined) };
  const issues = {
    raise: jest.fn(async () => undefined),
    resolveByKey: jest.fn(async () => undefined),
  };
  const svc = new TrackingRecoveryService(
    prisma as never,
    poll as never,
    audit as never,
    email as never,
    queue as never,
    issues as never,
  );
  return { svc, poll, audit, email, queue, issues };
}

describe('TrackingRecoveryService — the automatic half', () => {
  // The poller IS the tracking — Delhivery push us nothing — so a poll
  // that stops is invisible until a customer asks where their parcel is.
  it('puts a stalled poll on the issues board, and clears it when it recovers', async () => {
    const stalled = makeSvc({ stale: true, autoRecover: false });
    await stalled.svc.check();
    expect(stalled.issues.raise).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: 'tracking-poll:stalled' }),
    );

    const healthy = makeSvc({ stale: false });
    await healthy.svc.check();
    expect(healthy.issues.raise).not.toHaveBeenCalled();
    expect(healthy.issues.resolveByKey).toHaveBeenCalledWith(
      'tracking-poll:stalled',
      expect.any(String),
    );
  });

  it('does nothing at all while tracking is moving', async () => {
    const { svc, poll, audit, email } = makeSvc({ stale: false });
    const out = await svc.check();
    expect(out).toMatchObject({ healthy: true, recovery: 'NOT_NEEDED' });
    expect(poll.pollAll).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(email.enqueue).not.toHaveBeenCalled();
  });

  it('runs a cycle itself when stalled, rather than only reporting it', async () => {
    const { svc, poll } = makeSvc({ stale: true });
    const out = await svc.check();
    expect(poll.pollAll).toHaveBeenCalledTimes(1);
    expect(out.recovery).toBe('RECOVERED');
  });

  it('says so honestly when its own recovery did not work', async () => {
    const { svc } = makeSvc({ stale: true, recoversOnRetry: false });
    const out = await svc.check();
    // Claiming a fix that did not happen is worse than the stall.
    expect(out.recovery).toBe('STILL_STALLED');
  });

  it('alarms even when recovery WORKED — a self-healed stall is still a pattern', async () => {
    const { svc, audit, email } = makeSvc({ stale: true });
    await svc.check();
    expect(audit.log).toHaveBeenCalledTimes(1);
    const logged = (
      audit.log.mock.calls as unknown as Array<[{ action: string; severity: string }]>
    )[0]?.[0];
    expect(logged).toMatchObject({
      action: 'tracking.poll_stalled',
      severity: 'CRITICAL',
    });
    expect(email.enqueue).toHaveBeenCalledTimes(1);
  });

  it('honours the OFF switch — alerts, but does not act', async () => {
    const { svc, poll, email } = makeSvc({ stale: true, autoRecover: false });
    const out = await svc.check();
    expect(poll.pollAll).not.toHaveBeenCalled();
    expect(out.recovery).toBe('DISABLED');
    // The alert must still fire, or turning recovery off would turn
    // knowing about it off too.
    expect(email.enqueue).toHaveBeenCalledTimes(1);
  });

  it('defaults to ON when the setting row is missing', async () => {
    const { svc, poll } = makeSvc({ stale: true, autoRecover: null });
    await svc.check();
    // A missing row must not silently disable recovery.
    expect(poll.pollAll).toHaveBeenCalledTimes(1);
  });

  it('records the finding even when there is no address to email', async () => {
    const { svc, audit, email } = makeSvc({ stale: true, alertEmail: '' });
    const out = await svc.check();
    expect(email.enqueue).not.toHaveBeenCalled();
    expect(out.alerted).toBe(false);
    // The audit row is the durable evidence; an alert sent nowhere is
    // worse than one with no destination.
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('never lets a mail failure break the watchdog', async () => {
    const { svc, email } = makeSvc({ stale: true });
    email.enqueue.mockRejectedValueOnce(new Error('resend down'));
    await expect(svc.check()).resolves.toMatchObject({ alerted: false, recovery: 'RECOVERED' });
  });
});

describe('TrackingRecoveryService — a lost schedule fixes itself', () => {
  it('re-arms the cron before running a recovery cycle', async () => {
    const { svc, queue } = makeSvc({ stale: true });
    await svc.check();
    // Running one cycle without this would fix today and leave the cron
    // still gone, so the watchdog would carry tracking indefinitely.
    expect(queue.ensureScheduled).toHaveBeenCalledTimes(1);
  });

  it('does not touch the schedule when recovery is switched off', async () => {
    const { svc, queue } = makeSvc({ stale: true, autoRecover: false });
    await svc.check();
    expect(queue.ensureScheduled).not.toHaveBeenCalled();
  });
});
