import { Injectable, Logger } from '@nestjs/common';
import { ShipmentStatus, SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import type { NdrPanelRead } from '../pages/delhivery-ndr-panel';

export const NDR_ALERT_PREFIX = 'ndr-panel:';
export type NdrAlertCondition = 'last-attempt' | 'deadline';

/** One alert per shipment + condition: `ndr-panel:<shipmentId>:<condition>`. */
export function ndrAlertKey(shipmentId: string, condition: NdrAlertCondition): string {
  return `${NDR_ALERT_PREFIX}${shipmentId}:${condition}`;
}

const FINAL: readonly ShipmentStatus[] = [
  ShipmentStatus.DELIVERED,
  ShipmentStatus.RTO_DELIVERED,
  ShipmentStatus.CANCELLED,
  ShipmentStatus.LOST,
  ShipmentStatus.DAMAGED,
];

/** Which conditions this snapshot is in. Unreadable (null) fields never alert. */
export function ndrAlertConditions(n: NdrPanelRead): NdrAlertCondition[] {
  const out: NdrAlertCondition[] = [];
  if (
    n.attemptsFailed !== null &&
    n.attemptsMax !== null &&
    n.attemptsMax >= 2 &&
    n.attemptsFailed >= 1 &&
    n.attemptsFailed >= n.attemptsMax - 1
  ) {
    out.push('last-attempt');
  }
  if (n.deadlineDays !== null && n.deadlineDays <= 1) out.push('deadline');
  return out;
}

type Stored = Omit<NdrPanelRead, 'reasonText'> & { reasonText: string | null };

/**
 * A new row only when something changed. A read that could not get the
 * reason text (null) does not count as a change against one we have.
 */
export function ndrChanged(prev: Stored | null, next: NdrPanelRead): boolean {
  if (prev === null) return true;
  return (
    prev.open !== next.open ||
    prev.attemptsFailed !== next.attemptsFailed ||
    prev.attemptsMax !== next.attemptsMax ||
    prev.deadlineDays !== next.deadlineDays ||
    prev.remarkVerified !== next.remarkVerified ||
    (next.reasonText !== null && prev.reasonText !== next.reasonText)
  );
}

/**
 * Insert-only store of Delhivery's NDR panel facts, and the "this parcel
 * is nearly out of attempts / out of time" alert. Runs in the portal
 * worker, after the page read.
 */
@Injectable()
export class NdrPanelService {
  private readonly logger = new Logger(NdrPanelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly issues: SystemIssueService,
  ) {}

  /** Returns true when a new snapshot row was written. Never throws. */
  async record(
    shipmentId: string,
    awb: string,
    ndr: NdrPanelRead | null,
    parcelFinal: boolean,
  ): Promise<boolean> {
    // Could not read the page as an NDR page: store nothing, alert nothing.
    if (ndr === null || ndr.open === null) return false;
    try {
      const prev = await this.prisma.client.courierNdrPanelSnapshot.findFirst({
        where: { shipmentId },
        orderBy: [{ readAt: 'desc' }, { id: 'desc' }],
        select: {
          open: true,
          attemptsFailed: true,
          attemptsMax: true,
          deadlineDays: true,
          remarkVerified: true,
          reasonText: true,
        },
      });
      if (!ndrChanged(prev, ndr)) return false;
      await this.prisma.client.courierNdrPanelSnapshot.create({
        data: {
          shipmentId,
          open: ndr.open,
          attemptsFailed: ndr.attemptsFailed,
          attemptsMax: ndr.attemptsMax,
          deadlineDays: ndr.deadlineDays,
          remarkVerified: ndr.remarkVerified,
          reasonText: ndr.reasonText ?? prev?.reasonText ?? null,
        },
      });
      await this.alert(shipmentId, awb, ndr, parcelFinal);
      return true;
    } catch (err) {
      this.logger.warn(
        { shipmentId, err: err instanceof Error ? err.message : String(err) },
        'Could not store the NDR panel snapshot',
      );
      return false;
    }
  }

  private async alert(
    shipmentId: string,
    awb: string,
    ndr: NdrPanelRead,
    parcelFinal: boolean,
  ): Promise<void> {
    const now = parcelFinal ? [] : ndrAlertConditions(ndr);
    const all: NdrAlertCondition[] = ['last-attempt', 'deadline'];
    for (const cond of all) {
      const key = ndrAlertKey(shipmentId, cond);
      if (!now.includes(cond)) {
        await this.issues.resolveByKey(key, 'The panel no longer shows this condition');
        continue;
      }
      const last = cond === 'last-attempt';
      await this.issues.raise({
        kind: SystemIssueKind.OTHER,
        severity: last ? SystemIssueSeverity.MEDIUM : SystemIssueSeverity.HIGH,
        title: last
          ? `Delhivery NDR: last delivery attempt left (AWB ${awb})`
          : `Delhivery NDR: deadline within 1 day (AWB ${awb})`,
        detail: last
          ? `Delhivery's panel shows ${ndr.attemptsFailed ?? '?'}/${ndr.attemptsMax ?? '?'} delivery attempts failed. Confirm the customer will receive it, or act on the NDR before the last attempt is spent.`
          : `Delhivery's panel shows the NDR deadline at ${ndr.deadlineDays ?? '?'} day(s). Act on the NDR now or the parcel goes back.`,
        source: 'courier-portal.ndr-panel',
        dedupeKey: key,
        metadata: {
          shipmentId,
          awb,
          attemptsFailed: ndr.attemptsFailed,
          attemptsMax: ndr.attemptsMax,
          deadlineDays: ndr.deadlineDays,
          remarkVerified: ndr.remarkVerified,
        },
        severityMayFall: true,
      });
    }
  }

  /** Clear alerts of parcels that are delivered / returned / gone. */
  async clearFinished(): Promise<number> {
    const keys = await this.issues.openDedupeKeys(NDR_ALERT_PREFIX);
    if (keys.length === 0) return 0;
    const byShipment = new Map<string, string[]>();
    for (const k of keys) {
      const id = k.slice(NDR_ALERT_PREFIX.length).split(':')[0] ?? '';
      byShipment.set(id, [...(byShipment.get(id) ?? []), k]);
    }
    const finished = await this.prisma.client.shipment.findMany({
      where: { id: { in: [...byShipment.keys()] }, status: { in: [...FINAL] } },
      select: { id: true },
    });
    let cleared = 0;
    for (const s of finished) {
      for (const k of byShipment.get(s.id) ?? []) {
        cleared += await this.issues.resolveByKey(k, 'The parcel is delivered or returned');
      }
    }
    return cleared;
  }
}
