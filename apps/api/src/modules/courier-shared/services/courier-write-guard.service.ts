import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';

/**
 * Hosts that are a SIMULATOR, not a real courier.
 *
 * Writing to one of these is free and reversible, so live writes may be
 * left on against them indefinitely — which is the whole point of having
 * a simulator: run the real code path, repeatedly, at no risk.
 *
 * Loopback and private ranges only. A simulator someone exposes on a
 * public host stops being recognised as one, which is the safe way for
 * that mistake to fail.
 */
const SIMULATOR_HOST_PATTERNS: readonly RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^\[?::1\]?$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /\.local$/i,
  /(^|\.)delhivery-sim(\.|$)/i,
  /(^|\.)shiprocket-sim(\.|$)/i,
];

/**
 * Operations that cause something to happen in the PHYSICAL world (or
 * spend money) the moment they succeed. Each entry says what it actually
 * does, because that is the thing worth pausing over.
 */
export type CourierWriteOperation =
  /** Manifests a real parcel the courier now expects to collect. */
  | 'shipment.create'
  /** Changes a real consignee address / phone / payment mode. */
  | 'shipment.edit'
  /** Cancels a real parcel — possibly one already promised to a customer. */
  | 'shipment.cancel'
  /** Dispatches a real field executive to a real warehouse. */
  | 'pickup.request'
  /** Changes real delivery behaviour on a live NDR shipment. */
  | 'ndr.action'
  /** Registers/edits a pickup location on the live account. */
  | 'warehouse.write'
  /** Attaches a real e-waybill to a consignment (tax document). */
  | 'ewaybill.update'
  /** Consumes real AWB numbers from the account's allocation. */
  | 'waybill.fetch';

/**
 * The guard that makes a sandbox-less integration survivable — for ANY
 * courier.
 *
 * ── WHY THIS IS PER-COURIER, NOT ONE GLOBAL SWITCH ───────────────────
 * Each courier is a separate contract, a separate account and separate
 * money, and readiness to write to one says nothing about readiness to
 * write to the other. A single flag would mean the day somebody enables
 * Delhivery for its first controlled parcel, every Shiprocket write path
 * silently goes live too — with no decision having been made about it.
 * So the setting key is derived from the courier code:
 * `courier.<code>_live_writes_enabled`, matching the existing Delhivery
 * key exactly so no migration is needed.
 *
 * Both halves matter. The FLAG says whether writes are permitted; the
 * BASE URL says where they would go. Neither alone is the safety
 * property, which is why an enabled flag pointed at production is
 * allowed but audited HIGH every single time, and anything not
 * recognisably a simulator counts as production.
 */
@Injectable()
export class CourierWriteGuardService {
  private readonly logger = new Logger(CourierWriteGuardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  private liveWritesKey(courierCode: string): string {
    return `courier.${courierCode}_live_writes_enabled`;
  }

  private baseUrlKey(courierCode: string): string {
    return `courier.${courierCode}_api_base_url`;
  }

  /** Whether the write flag is on. Says nothing about WHERE writes go. */
  async liveWritesEnabled(courierCode: string): Promise<boolean> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: this.liveWritesKey(courierCode) },
      select: { valueBoolean: true },
    });
    // Fail CLOSED: an unreadable or absent setting means "not enabled".
    return row?.valueBoolean === true;
  }

  /**
   * Where writes would currently go: a simulator, or the real courier.
   *
   * This exists because the write flag alone became ambiguous the moment
   * a simulator existed. Testing the real code path requires turning the
   * flag ON — and it is then one edit to the base URL away from a
   * background worker manifesting real parcels, silently, with nobody
   * having decided to. Permission granted for a simulator must not
   * silently become permission for production.
   *
   * Anything that is not recognisably a simulator is treated as
   * PRODUCTION, including an unreadable or malformed base URL. The
   * default has to be the expensive-to-be-wrong-about one.
   */
  async writeTarget(courierCode: string): Promise<{ simulator: boolean; host: string }> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: this.baseUrlKey(courierCode) },
      select: { valueString: true },
    });
    const raw = row?.valueString?.trim() ?? '';
    if (raw.length === 0) {
      // No base URL at all is STUB mode — the adapter never reaches the
      // network, so nothing physical can happen.
      return { simulator: true, host: '(stub)' };
    }
    let host: string;
    try {
      host = new URL(raw).hostname;
    } catch {
      return { simulator: false, host: '(unparseable)' };
    }
    return { simulator: SIMULATOR_HOST_PATTERNS.some((re) => re.test(host)), host };
  }

  /**
   * Assert a physical-world write is permitted, or throw 403.
   *
   * Every BLOCKED attempt is audited at HIGH — a system trying to
   * manifest parcels while the guard is off is exactly the signal an
   * operator needs, and silence would hide a misconfigured worker
   * retrying forever.
   */
  async assertWritable(
    courierCode: string,
    operation: CourierWriteOperation,
    context: Record<string, unknown> = {},
  ): Promise<void> {
    const target = await this.writeTarget(courierCode);

    if (await this.liveWritesEnabled(courierCode)) {
      // Enabled AND pointed at a simulator: free and reversible, no
      // further ceremony. This is the mode a developer works in.
      if (target.simulator) return;

      // Enabled and pointed at PRODUCTION. Allowed — a controlled
      // first-parcel test is exactly this — but never quietly: every
      // real write is audited with the host it went to, so "when did we
      // start manifesting real parcels, and against what" is answerable
      // from the audit log rather than from memory.
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        action: `courier.${courierCode}.live_write_to_production`,
        entityType: 'courier',
        entityId: null,
        severity: 'HIGH',
        metadata: { courierCode, operation, host: target.host, ...context },
      });
      this.logger.warn(
        { courierCode, operation, host: target.host, ...context },
        'Courier LIVE write to PRODUCTION — this has a physical-world effect',
      );
      return;
    }

    this.logger.warn(
      { courierCode, operation, ...context },
      `Courier live write BLOCKED — ${this.liveWritesKey(courierCode)} is off`,
    );
    await this.audit.log({
      actorType: ActorType.SYSTEM,
      action: `courier.${courierCode}.live_write_blocked`,
      entityType: 'courier',
      entityId: null,
      severity: 'HIGH',
      metadata: { courierCode, operation, ...context },
    });

    throw new ForbiddenException({
      code: `${courierCode.toUpperCase()}_LIVE_WRITES_DISABLED`,
      message:
        `Refusing to '${operation}' against the live ${courierCode} account: ` +
        `${this.liveWritesKey(courierCode)} is off. This call would create a real ` +
        `physical or billable effect. Enable the setting deliberately ` +
        `(admin → system settings) when you intend live operations.`,
      cause: { operation, courierCode },
    });
  }
}
