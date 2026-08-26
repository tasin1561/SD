import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { EnvService } from '../../../config/env.service';
import { WebhookPayloadRetentionService } from '../../tracking-ingestion/services/webhook-payload-retention.service';

/**
 * What is running out, how fast, and what to do about it.
 *
 * Capacity problems in this system do not announce themselves. The
 * database does not slow down as it fills — it works perfectly until
 * the disk is full and then refuses every write. Connections do not
 * degrade — the twenty-sixth caller gets an error while the first
 * twenty-five are fine. Both failures arrive as an outage rather than
 * as a trend, which is exactly why they need a page.
 *
 * Two design decisions worth keeping:
 *
 * **Ceilings are SETTINGS, usage is MEASURED.** `max_connections` we
 * can read from Postgres; the disk size of a managed plan we cannot —
 * DigitalOcean knows it and the database does not. So the ceiling is a
 * system setting an admin updates when they change plan, and the page
 * says plainly where each number came from. A guessed ceiling silently
 * wrong by 4× is worse than no gauge at all.
 *
 * **Every reading carries what to DO.** A dashboard that says "82%"
 * and stops has moved the problem rather than solved it: the person
 * reading it still has to know which plan to buy and what breaks
 * first. Each metric here answers "what happens when this fills" and
 * "how do I fix it" in the words someone would need at the time.
 */

export type CapacityStatus = 'OK' | 'WATCH' | 'WARNING' | 'CRITICAL';

export interface CapacityMetric {
  readonly key: string;
  readonly label: string;
  /** What is being consumed, in `unit`. */
  readonly current: number;
  /** The ceiling, or null when it is not knowable from inside. */
  readonly ceiling: number | null;
  readonly unit: string;
  readonly percent: number | null;
  readonly status: CapacityStatus;
  /** Where the ceiling came from — measured, configured, or unknown. */
  readonly ceilingSource: 'MEASURED' | 'CONFIGURED' | 'UNKNOWN';
  /** What happens when this runs out. */
  readonly consequence: string;
  /** What to do, concretely. */
  readonly remedy: string;
  /** Extra context worth showing under the gauge. */
  readonly detail?: string | undefined;
}

export interface CapacityReport {
  readonly generatedAt: Date;
  readonly worstStatus: CapacityStatus;
  readonly metrics: readonly CapacityMetric[];
  readonly growth: {
    readonly ordersLast30Days: number;
    readonly ordersPrev30Days: number;
    readonly monthlyGrowthPercent: number | null;
    /** Months of headroom on the tightest storage-bound metric. */
    readonly storageMonthsRemaining: number | null;
  };
  readonly topology: {
    readonly workersEnabledHere: boolean;
    readonly apiInstancesAssumed: number;
    readonly note: string;
  };
}

/** Thresholds. WATCH is "start planning", WARNING is "book the work",
 *  CRITICAL is "this will fail soon". */
const WATCH = 60;
const WARNING = 75;
const CRITICAL = 88;

function statusFor(percent: number | null): CapacityStatus {
  if (percent === null) return 'OK';
  if (percent >= CRITICAL) return 'CRITICAL';
  if (percent >= WARNING) return 'WARNING';
  if (percent >= WATCH) return 'WATCH';
  return 'OK';
}

const RANK: Record<CapacityStatus, number> = { OK: 0, WATCH: 1, WARNING: 2, CRITICAL: 3 };

/** Ceiling settings an admin maintains when the plan changes. */
export const CAPACITY_SETTING_KEYS = {
  dbStorageGb: 'capacity.db_storage_gb',
  dbPlanLabel: 'capacity.db_plan_label',
  redisMaxMemoryMb: 'capacity.redis_max_memory_mb',
  apiInstances: 'capacity.api_instances',
} as const;

@Injectable()
export class CapacityService {
  private readonly logger = new Logger(CapacityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly env: EnvService,
    private readonly webhookRetention: WebhookPayloadRetentionService,
  ) {}

  async report(): Promise<CapacityReport> {
    const [db, timescale, payloads, redis, queues, growth, settings] = await Promise.all([
      this.databaseMetrics(),
      this.timescaleMetrics(),
      this.payloadRetentionMetrics(),
      this.redisMetrics(),
      this.queueDepth(),
      this.growth(),
      this.ceilings(),
    ]);

    const metrics = [...db, ...timescale, ...payloads, ...redis, ...queues];
    const worstStatus = metrics.reduce<CapacityStatus>(
      (worst, m) => (RANK[m.status] > RANK[worst] ? m.status : worst),
      'OK',
    );

    // Months of storage left, from the last 30 days' actual growth
    // rather than a per-order estimate — the estimate would be wrong in
    // whichever direction the product changed most recently.
    const storage = metrics.find((m) => m.key === 'db_storage');
    const storageMonthsRemaining =
      storage && storage.ceiling !== null && growth.storageGrowthGbPer30Days > 0
        ? Math.max(
            0,
            Math.round(
              ((storage.ceiling - storage.current) / growth.storageGrowthGbPer30Days) * 10,
            ) / 10,
          )
        : null;

    return {
      generatedAt: new Date(),
      worstStatus,
      metrics,
      growth: {
        ordersLast30Days: growth.ordersLast30Days,
        ordersPrev30Days: growth.ordersPrev30Days,
        monthlyGrowthPercent: growth.monthlyGrowthPercent,
        storageMonthsRemaining,
      },
      topology: {
        workersEnabledHere: this.env.workersEnabled,
        apiInstancesAssumed: settings.apiInstances,
        note: this.env.workersEnabled
          ? 'This instance owns the background queues. Exactly one instance should.'
          : 'This instance serves HTTP only; another owns the queues.',
      },
    };
  }

  // ── database ────────────────────────────────────────────────────────

  private async databaseMetrics(): Promise<CapacityMetric[]> {
    const ceilings = await this.ceilings();
    const rows = await this.prisma.client.$queryRawUnsafe<
      Array<{
        max_conn: string;
        used_conn: bigint;
        idle_in_tx: bigint;
        db_bytes: bigint;
        longest_query_s: number | null;
      }>
    >(`
      SELECT current_setting('max_connections') AS max_conn,
             (SELECT count(*) FROM pg_stat_activity) AS used_conn,
             (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction') AS idle_in_tx,
             pg_database_size(current_database()) AS db_bytes,
             (SELECT EXTRACT(EPOCH FROM max(now() - query_start))
                FROM pg_stat_activity WHERE state = 'active' AND query NOT ILIKE '%pg_stat_activity%')
               AS longest_query_s
    `);
    const r = rows[0];
    if (!r) return [];

    const maxConn = Number(r.max_conn);
    const usedConn = Number(r.used_conn);
    const dbGb = Number(r.db_bytes) / 1024 ** 3;

    const connPercent = (usedConn / maxConn) * 100;
    const storagePercent = ceilings.dbStorageGb > 0 ? (dbGb / ceilings.dbStorageGb) * 100 : null;

    // Each API instance holds its own Prisma pool. This is the number
    // that decides whether a second instance can even connect.
    const perInstancePool = 5;
    const projected = usedConn + perInstancePool;

    const tracking = await this.trackingFreshness();

    return [
      tracking,
      {
        key: 'db_connections',
        label: 'Database connections',
        current: usedConn,
        ceiling: maxConn,
        unit: 'connections',
        percent: Math.round(connPercent * 10) / 10,
        status: statusFor(connPercent),
        ceilingSource: 'MEASURED',
        consequence:
          'At the ceiling, new connections are refused outright. The API returns errors rather than slowing down, and adding another API instance is what usually crosses it.',
        remedy:
          'Two independent fixes: upgrade the database plan (connection limit scales with RAM), and put PgBouncer in front in transaction-pooling mode so many app connections share few real ones. Add `pgbouncer=true` to the Prisma URL when you do — prepared statements need it.',
        detail:
          `About ${maxConn - usedConn} free. A further API instance would take roughly ${perInstancePool} ` +
          `(pool = CPUs x 2 + 1), leaving ~${Math.max(0, maxConn - projected)}. ` +
          `Managed-database agents hold a fixed share of these regardless of our traffic.`,
      },
      {
        key: 'db_storage',
        label: 'Database storage',
        current: Math.round(dbGb * 100) / 100,
        ceiling: ceilings.dbStorageGb > 0 ? ceilings.dbStorageGb : null,
        unit: 'GB',
        percent: storagePercent === null ? null : Math.round(storagePercent * 10) / 10,
        status: statusFor(storagePercent),
        ceilingSource: ceilings.dbStorageGb > 0 ? 'CONFIGURED' : 'UNKNOWN',
        consequence:
          'A full disk does not degrade — the database stops accepting writes. Orders cannot be placed and money cannot be recorded until it is resized.',
        remedy:
          `The disk CAN be grown: a DigitalOcean managed database is resized in place from the control panel — choose a larger plan and it migrates with a brief failover, with no data moved by hand. It only ever grows; storage cannot be shrunk again, so step up rather than jump. Current plan: ${ceilings.dbPlanLabel}. ` +
          `Two things after resizing: update ${CAPACITY_SETTING_KEYS.dbStorageGb} here, because this gauge is only as honest as that number; and check first whether the growth is really the courier payloads reported below — reclaiming those is free, where a bigger plan is monthly, forever.`,
      },
      {
        key: 'db_idle_in_tx',
        label: 'Idle-in-transaction sessions',
        current: Number(r.idle_in_tx),
        ceiling: 5,
        unit: 'sessions',
        percent: Math.min(100, (Number(r.idle_in_tx) / 5) * 100),
        status: statusFor(Math.min(100, (Number(r.idle_in_tx) / 5) * 100)),
        ceilingSource: 'CONFIGURED',
        consequence:
          'A session holding a transaction open holds its locks and blocks vacuum. A handful is normal; a rising count means something is leaking transactions and will eventually block writers.',
        remedy:
          'Find them in pg_stat_activity by query text. Usually a code path that opens a transaction and awaits something slow inside it — a network call, or a queue publish.',
        detail:
          r.longest_query_s === null
            ? undefined
            : `Longest running query right now: ${Math.round(Number(r.longest_query_s))}s.`,
      },
    ];
  }

  // ── timescale ───────────────────────────────────────────────────────

  /**
   * Whether the two fastest-growing tables can be compressed at all.
   *
   * This is not a gauge, it is a fact worth surfacing: `tracking_events`
   * and `stock_movements` are hypertables specifically so their history
   * could be compressed 10-20x. DigitalOcean's managed Postgres ships
   * TimescaleDB under the APACHE licence, and compression is a
   * Community feature. The original migration knew this and wrapped the
   * setup in `EXCEPTION WHEN feature_not_supported`, so on production it
   * is skipped in silence — which is correct behaviour and completely
   * invisible.
   *
   * The consequence is a planning one: without compression, the growth
   * of scan and movement history is linear and permanent, so archival
   * stops being an optimisation and becomes the only lever.
   */
  private async timescaleMetrics(): Promise<CapacityMetric[]> {
    try {
      const rows = await this.prisma.client.$queryRawUnsafe<
        Array<{ hypertable_name: string; compression_enabled: boolean }>
      >('SELECT hypertable_name, compression_enabled FROM timescaledb_information.hypertables');
      if (rows.length === 0) return [];
      const compressed = rows.filter((r) => r.compression_enabled).length;
      const available = compressed === rows.length;

      return [
        {
          key: 'timescale_compression',
          label: 'History compression',
          current: compressed,
          ceiling: rows.length,
          unit: 'hypertables compressible',
          percent: null,
          status: available ? 'OK' : 'WATCH',
          ceilingSource: 'MEASURED',
          consequence: available
            ? 'Scan and stock-movement history compresses on a schedule, so the two fastest-growing tables stay affordable.'
            : 'Courier scans and stock movements — the two tables that grow fastest per order — accumulate uncompressed and permanently. On this database they cannot be compressed at all, so storage growth is linear with order volume and the only lever left is deleting or archiving old rows.',
          remedy: available
            ? 'Nothing to do.'
            : "DigitalOcean's managed Postgres ships TimescaleDB under the Apache licence; compression is a Community feature and the setup migration skips it deliberately. To get it: move to Timescale Cloud or self-host TimescaleDB (which costs the managed backups). To live without it: budget for archival before the disk fills — this is the metric that decides which.",
          detail: available
            ? undefined
            : `${rows.length - compressed} of ${rows.length} hypertable(s) uncompressible: ${rows
                .filter((r) => !r.compression_enabled)
                .map((r) => r.hypertable_name)
                .join(', ')}.`,
        },
      ];
    } catch (e) {
      this.logger.warn({ err: (e as Error).message }, 'TimescaleDB capacity probe failed');
      return [];
    }
  }

  // ── courier payload retention ───────────────────────────────────────

  /**
   * How much of the largest table is still carrying a raw payload.
   *
   * Not a ceiling — a progress reading. It shows the daily sweep doing
   * its job, and it is the number that answers "is storage growth
   * bounded now, or still open-ended".
   */
  private async payloadRetentionMetrics(): Promise<CapacityMetric[]> {
    try {
      const { retained, retentionDays } = await this.webhookRetention.pendingCount();
      return [
        {
          key: 'webhook_payloads_retained',
          label: 'Courier payloads held',
          current: retained,
          ceiling: null,
          unit: `rows within the ${retentionDays}-day window`,
          percent: null,
          status: 'OK',
          ceilingSource: 'MEASURED',
          consequence:
            'These rows carry the courier payload up to three times over — headers, raw body, and the parsed copy of the same thing — and they are the biggest single consumer of disk per order. Left unbounded, this table alone decides when the database fills.',
          remedy: `A daily sweep blanks the payload past ${retentionDays} days and keeps the row, so what remains is bounded by the window rather than by how long we have been trading. Shorten tracking.webhook_payload_retention_days to reclaim more; lengthen it if courier disputes are taking longer than that to resolve. The scan timeline customers see lives in tracking_events and is never touched.`,
        },
      ];
    } catch (e) {
      this.logger.warn({ err: (e as Error).message }, 'Payload retention probe failed');
      return [];
    }
  }

  // ── redis ───────────────────────────────────────────────────────────

  private async redisMetrics(): Promise<CapacityMetric[]> {
    try {
      const ceilings = await this.ceilings();
      const info = await this.redis.client.info('memory');
      const used = Number(/used_memory:(\d+)/.exec(info)?.[1] ?? 0) / 1024 ** 2;
      const maxFromRedis = Number(/maxmemory:(\d+)/.exec(info)?.[1] ?? 0) / 1024 ** 2;
      // Redis reports maxmemory 0 when unlimited — then the real ceiling
      // is the droplet's RAM, which only the operator knows.
      const ceiling = maxFromRedis > 0 ? maxFromRedis : ceilings.redisMaxMemoryMb;

      const percent = ceiling > 0 ? (used / ceiling) * 100 : null;
      return [
        {
          key: 'redis_memory',
          label: 'Redis memory',
          current: Math.round(used * 10) / 10,
          ceiling: ceiling > 0 ? Math.round(ceiling) : null,
          unit: 'MB',
          percent: percent === null ? null : Math.round(percent * 10) / 10,
          status: statusFor(percent),
          ceilingSource: maxFromRedis > 0 ? 'MEASURED' : 'CONFIGURED',
          consequence:
            'Redis holds the job queues, the rate-limit counters and every scheduled future task. Out of memory means jobs are refused or evicted, and an evicted delayed job is work that silently never happens.',
          remedy:
            'Redis runs on the droplet and shares its RAM. Either move it to a managed instance or resize the droplet. Long term, the scheduled sweeps should also be recoverable from the database so losing Redis costs throughput rather than correctness.',
        },
      ];
    } catch (e) {
      this.logger.warn({ err: (e as Error).message }, 'Redis capacity probe failed');
      return [];
    }
  }

  // ── queues ──────────────────────────────────────────────────────────

  private async queueDepth(): Promise<CapacityMetric[]> {
    try {
      const keys = await this.redis.client.keys('bull:*:wait');
      let waiting = 0;
      let deepest = { queue: '', depth: 0 };
      for (const k of keys) {
        const depth = await this.redis.client.llen(k);
        waiting += depth;
        if (depth > deepest.depth) {
          deepest = { queue: k.replace(/^bull:|:wait$/g, ''), depth };
        }
      }
      const failedKeys = await this.redis.client.keys('bull:*:failed');
      let failed = 0;
      for (const k of failedKeys) failed += await this.redis.client.zcard(k);

      // A backlog is not a resource limit; it is a symptom. The ceiling
      // is a judgement about when a queue has stopped keeping up.
      const BACKLOG_CEILING = 500;
      const percent = Math.min(100, (waiting / BACKLOG_CEILING) * 100);

      return [
        {
          key: 'queue_backlog',
          label: 'Background job backlog',
          current: waiting,
          ceiling: BACKLOG_CEILING,
          unit: 'jobs waiting',
          percent: Math.round(percent * 10) / 10,
          status: statusFor(percent),
          ceilingSource: 'CONFIGURED',
          consequence:
            'A growing backlog means work is arriving faster than one worker process can clear it. Emails, waybills and tracking updates fall behind before anything visibly errors.',
          remedy:
            'Raise the concurrency on the queue that is behind, or move the workers to their own process so they stop competing with HTTP traffic for the single Node thread.',
          detail:
            (deepest.depth > 0 ? `Deepest: ${deepest.queue} (${deepest.depth}). ` : '') +
            `${failed} failed job(s) retained across all queues.`,
        },
      ];
    } catch (e) {
      this.logger.warn({ err: (e as Error).message }, 'Queue depth probe failed');
      return [];
    }
  }

  // ── growth ──────────────────────────────────────────────────────────

  private async growth(): Promise<{
    ordersLast30Days: number;
    ordersPrev30Days: number;
    monthlyGrowthPercent: number | null;
    storageGrowthGbPer30Days: number;
  }> {
    const now = Date.now();
    const d30 = new Date(now - 30 * 864e5);
    const d60 = new Date(now - 60 * 864e5);

    const [last30, prev30] = await Promise.all([
      this.prisma.client.order.count({ where: { createdAt: { gte: d30 } } }),
      this.prisma.client.order.count({ where: { createdAt: { gte: d60, lt: d30 } } }),
    ]);

    const monthlyGrowthPercent =
      prev30 > 0 ? Math.round(((last30 - prev30) / prev30) * 1000) / 10 : null;

    // Storage growth is inferred from orders rather than sampled over
    // time: we do not retain historical size measurements, and adding a
    // table to do so would be its own growth. The per-order figure is a
    // measured average of the whole database over the orders in it, so
    // it self-corrects as the shape of the data changes.
    const totalOrders = await this.prisma.client.order.count();
    const sizeRows = await this.prisma.client.$queryRawUnsafe<Array<{ b: bigint }>>(
      'SELECT pg_database_size(current_database()) AS b',
    );
    const dbGb = Number(sizeRows[0]?.b ?? 0) / 1024 ** 3;
    const perOrderGb = totalOrders > 0 ? dbGb / totalOrders : 0;

    return {
      ordersLast30Days: last30,
      ordersPrev30Days: prev30,
      monthlyGrowthPercent,
      storageGrowthGbPer30Days: perOrderGb * last30,
    };
  }

  // ── ceilings the database cannot know ───────────────────────────────

  private async ceilings(): Promise<{
    dbStorageGb: number;
    dbPlanLabel: string;
    redisMaxMemoryMb: number;
    apiInstances: number;
  }> {
    const rows = await this.prisma.client.systemSetting.findMany({
      where: { key: { in: Object.values(CAPACITY_SETTING_KEYS) } },
      select: { key: true, valueInt: true, valueString: true, valueDecimal: true },
    });
    const get = (k: string): (typeof rows)[number] | undefined => rows.find((r) => r.key === k);
    const num = (k: string, fallback: number): number => {
      const row = get(k);
      if (!row) return fallback;
      if (row.valueInt !== null) return row.valueInt;
      if (row.valueDecimal !== null) return Number(row.valueDecimal);
      return fallback;
    };
    return {
      dbStorageGb: num(CAPACITY_SETTING_KEYS.dbStorageGb, 0),
      dbPlanLabel: get(CAPACITY_SETTING_KEYS.dbPlanLabel)?.valueString ?? 'not recorded',
      redisMaxMemoryMb: num(CAPACITY_SETTING_KEYS.redisMaxMemoryMb, 0),
      apiInstances: num(CAPACITY_SETTING_KEYS.apiInstances, 1),
    };
  }

  /**
   * How long since the tracking poller last completed a cycle.
   *
   * This is the metric that matters most on this page, because Delhivery
   * B2C accounts push no webhooks: the poller IS tracking. Every other
   * failure here announces itself — a full disk refuses writes, a
   * connection ceiling returns errors. This one is silent. The cron
   * simply stops, every request the app serves keeps working, and the
   * first person to notice is a seller asking why a parcel has not moved
   * since Tuesday.
   *
   * The poller alarms on its own when a cycle runs and fails. Nothing
   * inside a cycle can detect a cycle that never started, which is what
   * this is for.
   */
  private async trackingFreshness(): Promise<CapacityMetric> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: 'courier.tracking_poll_last_run_at' },
      select: { valueDate: true },
    });
    const last = row?.valueDate ?? null;
    const minutes = last === null ? null : Math.floor((Date.now() - last.getTime()) / 60_000);

    // Two missed cycles at the 20-minute default. One late cycle is
    // ordinary; two in a row is something to look at.
    const ceilingMinutes = 45;
    const percent = minutes === null ? null : Math.min(100, (minutes / ceilingMinutes) * 100);

    return {
      key: 'tracking_freshness',
      label: 'Tracking — minutes since the last poll cycle',
      current: minutes ?? 0,
      ceiling: ceilingMinutes,
      unit: 'minutes',
      percent: percent === null ? null : Math.round(percent * 10) / 10,
      status: statusFor(percent),
      ceilingSource: last === null ? 'UNKNOWN' : 'MEASURED',
      consequence:
        'Delhivery pushes us no webhooks, so this poller is the only thing that moves an order through IN_TRANSIT, OUT_FOR_DELIVERY and DELIVERED. If it stops, tracking freezes silently: the app keeps serving, no error appears, and orders never reach DELIVERED — which also means COD is never credited and sellers stop being paid. Nothing else on this page fails quietly like this one.',
      remedy:
        'Check that the API process is running with WORKERS_ENABLED and that the repeatable BullMQ job survived the last Redis restart (it is re-added on boot, so restarting the API restores it). Then check courier.delhivery_api_base_url is still set — clearing it puts the poller in stub mode, where it returns immediately and does nothing. Recent audit_logs under tracking.poll_all_batches_failed or tracking.poll_stub_mode_with_inflight will say which.',
      detail:
        last === null
          ? 'No cycle has ever been recorded. Either the poller has not run since this metric was added, or it is not running at all.'
          : `Last completed cycle ${last.toISOString()}. The cron default is every 20 minutes (courier.tracking_poll_cron).`,
    };
  }
}
