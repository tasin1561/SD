import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { HealthController } from '../../src/modules/health/health.controller';

type Check = { ok: true } | { ok: false; error: string };

function make(db: Check, redis: Check) {
  const status = jest.fn();
  const res = { status } as unknown as Response;
  const controller = new HealthController(
    { healthCheck: jest.fn().mockResolvedValue(db) } as never,
    { healthCheck: jest.fn().mockResolvedValue(redis) } as never,
    { health: jest.fn() } as never,
  );
  return { controller, res, status };
}

const OK: Check = { ok: true };
const DOWN: Check = { ok: false, error: "Can't reach database server" };

describe('HealthController readiness', () => {
  // An endpoint that answers 200 while it cannot reach its own database
  // is worse than no endpoint: an uptime monitor, a load balancer and
  // the deploy smoke test all read the STATUS, and each would conclude
  // the system is fine. These tests are the whole contract.
  it('answers 503 when the database is unreachable', async () => {
    const { controller, res, status } = make(DOWN, OK);
    const report = await controller.readiness(res);
    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(report.status).toBe('degraded');
    // The BODY still names the failing dependency — that is what makes
    // the alert actionable.
    expect(report.checks.database).toEqual({ ok: false, error: DOWN.error });
    expect(report.checks.redis).toEqual({ ok: true });
  });

  it('answers 503 when Redis is unreachable', async () => {
    const { controller, res, status } = make(OK, { ok: false, error: 'ECONNREFUSED' });
    const report = await controller.readiness(res);
    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(report.status).toBe('degraded');
    expect(report.checks.redis).toEqual({ ok: false, error: 'ECONNREFUSED' });
  });

  it('leaves the status alone (200) when both dependencies answer', async () => {
    const { controller, res, status } = make(OK, OK);
    const report = await controller.readiness(res);
    expect(status).not.toHaveBeenCalled();
    expect(report).toEqual({
      status: 'ok',
      checks: { database: { ok: true }, redis: { ok: true } },
    });
  });

  // The root runs the identical check, so it must reach the identical
  // verdict — it is the path most likely to be pointed at a monitor.
  it('the ROOT answers exactly as /ready does, degraded and healthy', async () => {
    const down = make(DOWN, OK);
    const downReport = await down.controller.overall(down.res);
    expect(down.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(downReport.status).toBe('degraded');

    const up = make(OK, OK);
    const upReport = await up.controller.overall(up.res);
    expect(up.status).not.toHaveBeenCalled();
    expect(upReport.status).toBe('ok');
  });

  // Liveness is a different question — "can this process respond?" — and
  // answering it 200 whenever it can is correct by definition.
  it('liveness is unconditional', () => {
    const { controller } = make(DOWN, DOWN);
    expect(controller.live()).toEqual({ status: 'ok' });
  });
});
