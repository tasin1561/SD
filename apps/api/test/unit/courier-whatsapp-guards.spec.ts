import { buildWhatsappMetrics } from '../../src/modules/system-capacity/services/capacity.service';
import {
  BREAKER_BASE_MS,
  BREAKER_MAX_MS,
  CLOSED,
  gate,
  onFailure,
  onSuccess,
} from '../../src/modules/courier-whatsapp/breaker';
import {
  availableMemoryMb,
  isStaleSweep,
  memoryOk,
  shouldDropSweep,
} from '../../src/modules/courier-whatsapp/guards';

const T = 1_000_000;

describe('breaker state machine', () => {
  it('a hard trip (login page, CAPTCHA, 429/5xx) opens it for 15 minutes at once', () => {
    const s = onFailure(CLOSED, T, 'LOGGED_OUT', true);
    expect(s.status).toBe('open');
    expect(s.openUntil).toBe(T + BREAKER_BASE_MS);
    expect(gate(s, T + 1)).toBe('wait');
  });

  it('soft failures open it only on the 5th in a row; a success resets the count', () => {
    let s = CLOSED;
    for (let i = 0; i < 4; i += 1) s = onFailure(s, T, 'FAILURES', false);
    expect(s.status).toBe('closed');
    s = onSuccess();
    for (let i = 0; i < 4; i += 1) s = onFailure(s, T, 'FAILURES', false);
    expect(s.status).toBe('closed');
    s = onFailure(s, T, 'FAILURES', false);
    expect(s.status).toBe('open');
    expect(s.reason).toBe('FAILURES');
  });

  it('after the pause one probe is allowed; a failed probe re-opens for double, capped at 2 h', () => {
    let s = onFailure(CLOSED, T, 'CAPTCHA', true);
    let now = T;
    const lengths: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      lengths.push((s.openUntil ?? 0) - now);
      now = (s.openUntil ?? 0) + 1;
      expect(gate(s, now)).toBe('probe');
      s = onFailure(s, now, 'CAPTCHA', true);
    }
    expect(lengths.map((l) => l / 60_000)).toEqual([15, 30, 60, 120, 120]);
    expect(lengths.at(-1)).toBe(BREAKER_MAX_MS);
  });

  it('a successful probe closes it; reads still in flight when it opened change nothing', () => {
    const open = onFailure(CLOSED, T, 'LOGGED_OUT', true);
    expect(onFailure(open, T + 5, 'FAILURES', false)).toBe(open);
    expect(onSuccess()).toEqual(CLOSED);
  });
});

describe('queue-drop policy', () => {
  it('drops SWEEP jobs past the max, never hot / event / viewer', () => {
    expect(shouldDropSweep('sweep', 2001, 2000)).toBe(true);
    expect(shouldDropSweep('sweep', 2000, 2000)).toBe(false);
    for (const k of ['hot', 'event', 'viewer'])
      expect(shouldDropSweep(k, 99_999, 2000)).toBe(false);
  });

  it('a sweep job older than 1 h is stale on pickup; others never are', () => {
    const now = 10 * 3_600_000;
    expect(isStaleSweep('sweep', now - 3_600_001, now)).toBe(true);
    expect(isStaleSweep('sweep', now - 60_000, now)).toBe(false);
    expect(isStaleSweep('hot', now - 9 * 3_600_000, now)).toBe(false);
  });
});

describe('memory guard', () => {
  it('refuses a tab below 400 MB available', () => {
    expect(memoryOk(399)).toBe(false);
    expect(memoryOk(400)).toBe(true);
  });

  it('reads MemAvailable, and falls back to os.freemem when /proc is unreadable', () => {
    expect(availableMemoryMb(() => 'MemTotal: 1 kB\nMemAvailable:  1048576 kB\n')).toBe(1024);
    expect(
      availableMemoryMb(
        () => {
          throw new Error('no proc');
        },
        () => 512 * 1024 * 1024,
      ),
    ).toBe(512);
  });
});

describe('System limits rows for the WhatsApp reader', () => {
  const base = {
    health: {
      readsLastHour: 360,
      hourlyCap: 400,
      oldestDueMinutes: 200,
      failuresToday: 3,
      readsToday: 900,
    },
    parallel: 2,
    queueMax: 2000,
    waiting: 1000,
    breaker: { status: 'closed' as const, reason: null, openUntil: null },
    dropped: 7,
    lowMemory: 2,
    freeMb: 800,
    now: 1_000_000,
  };

  it('gives the six rows, each with a consequence and a remedy', () => {
    const rows = buildWhatsappMetrics(base);
    expect(rows.map((r) => r.key)).toEqual([
      'whatsapp_reads_hour',
      'whatsapp_parallel',
      'whatsapp_queue',
      'whatsapp_breaker',
      'whatsapp_oldest_due',
      'whatsapp_memory',
    ]);
    for (const r of rows) {
      expect(r.consequence.length).toBeGreaterThan(20);
      expect(r.remedy.length).toBeGreaterThan(20);
    }
  });

  it('reads used / ceiling and picks statuses', () => {
    const rows = Object.fromEntries(buildWhatsappMetrics(base).map((r) => [r.key, r]));
    expect(rows.whatsapp_reads_hour).toMatchObject({
      current: 360,
      ceiling: 400,
      status: 'CRITICAL',
    });
    expect(rows.whatsapp_queue).toMatchObject({
      current: 1000,
      ceiling: 2000,
      percent: 50,
      status: 'OK',
    });
    expect(rows.whatsapp_parallel).toMatchObject({ current: 2, ceiling: 3 });
    expect(rows.whatsapp_oldest_due?.status).toBe('WARNING');
    expect(rows.whatsapp_memory?.status).toBe('WATCH');
    expect(rows.whatsapp_reads_hour?.remedy).toContain('700');
  });

  it('shows the breaker open with reason and until, closed otherwise', () => {
    const open = buildWhatsappMetrics({
      ...base,
      breaker: { status: 'open', reason: 'LOGGED_OUT', openUntil: base.now + 60_000 },
    }).find((r) => r.key === 'whatsapp_breaker');
    expect(open?.status).toBe('CRITICAL');
    expect(open?.detail).toContain('LOGGED_OUT');
    const expired = buildWhatsappMetrics({
      ...base,
      breaker: { status: 'open', reason: 'CAPTCHA', openUntil: base.now - 1 },
    }).find((r) => r.key === 'whatsapp_breaker');
    expect(expired?.status).toBe('OK');
  });

  it('memory below the guard is CRITICAL', () => {
    const m = buildWhatsappMetrics({ ...base, freeMb: 300 }).find(
      (r) => r.key === 'whatsapp_memory',
    );
    expect(m?.status).toBe('CRITICAL');
  });
});
