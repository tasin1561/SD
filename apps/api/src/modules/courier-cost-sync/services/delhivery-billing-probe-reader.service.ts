import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';

/** Written by the controller when an operator asks. */
export const ACTION_DELHIVERY_BILLING_PROBE_REQUESTED = 'courier.delhivery_billing.probe_requested';
/**
 * Written by the portal worker when the run finishes. Restated from
 * `courier-portal/services/delhivery-billing-probe.service.ts` — the API
 * cannot import that module — and pinned by `wallet-sync-queue-names.spec.ts`.
 */
export const ACTION_DELHIVERY_BILLING_PROBED = 'courier.delhivery_billing.probed';
/** Only keys under this prefix are ever presigned here. */
export const DELHIVERY_BILLING_PROBE_PREFIX = 'courier-probes/delhivery-billing/';

export interface ProbeFileLink {
  readonly key: string;
  readonly kind: string;
  readonly bytes: number | null;
  /** Presigned, short-lived. Never stored. */
  readonly url: string;
}

export interface DelhiveryBillingProbeView {
  readonly runId: string | null;
  /** NONE: never asked. QUEUED: asked, no findings yet (or the job was lost). DONE: findings below. */
  readonly status: 'NONE' | 'QUEUED' | 'DONE';
  readonly requestedAt: string | null;
  readonly requestedByStaffId: string | null;
  readonly finishedAt: string | null;
  /** The worker's findings, exactly as stored in the audit row. */
  readonly findings: unknown;
  readonly files: readonly ProbeFileLink[];
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const obj = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * The Delhivery billing probe's result, read back.
 *
 * No table of its own: the worker's findings ARE an audit row, as every
 * cost-sync run's summary is (a second copy would eventually disagree),
 * and the files sit in the private bucket. This pairs the request with its
 * result by `runId` and mints presigned links for the stored files — only
 * for keys under the probe's own prefix, whatever the row says.
 */
@Injectable()
export class DelhiveryBillingProbeReaderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
  ) {}

  async view(runId?: string): Promise<DelhiveryBillingProbeView> {
    const byRun = (id: string): { metadata: { path: string[]; equals: string } } => ({
      metadata: { path: ['runId'], equals: id },
    });
    const requested = await this.prisma.client.auditLog.findFirst({
      where: {
        action: ACTION_DELHIVERY_BILLING_PROBE_REQUESTED,
        ...(runId === undefined ? {} : byRun(runId)),
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, metadata: true, staffUserId: true },
    });
    const id = runId ?? str(obj(requested?.metadata)?.['runId']) ?? null;
    const done = await this.prisma.client.auditLog.findFirst({
      where: { action: ACTION_DELHIVERY_BILLING_PROBED, ...(id === null ? {} : byRun(id)) },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, metadata: true },
    });

    const findings = obj(done?.metadata);
    const artifacts = Array.isArray(findings?.['artifacts'])
      ? (findings['artifacts'] as unknown[])
      : [];
    const files: ProbeFileLink[] = [];
    for (const a of artifacts) {
      const o = obj(a);
      const key = str(o?.['key']);
      if (key === null || !key.startsWith(DELHIVERY_BILLING_PROBE_PREFIX)) continue;
      if (o?.['uploaded'] !== true) continue;
      files.push({
        key,
        kind: str(o['kind']) ?? 'file',
        bytes: typeof o['bytes'] === 'number' ? o['bytes'] : null,
        url: await this.spaces.presignGetUrl(key),
      });
    }

    return {
      runId: id ?? str(findings?.['runId']),
      status: done !== null ? 'DONE' : requested !== null ? 'QUEUED' : 'NONE',
      requestedAt: requested?.createdAt.toISOString() ?? null,
      requestedByStaffId: requested?.staffUserId ?? null,
      finishedAt: done?.createdAt.toISOString() ?? null,
      findings: findings ?? null,
      files,
    };
  }
}
