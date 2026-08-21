import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';

const LIVE_WRITES_SETTING = 'courier.delhivery_live_writes_enabled';
const BASE_URL_SETTING = 'courier.delhivery_api_base_url';

/**
 * Hosts that are a SIMULATOR, not Delhivery.
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
];

/**
 * Operations that cause something to happen in the PHYSICAL world (or
 * spend money) the moment they succeed. Each entry says what it actually
 * does, because that is the thing worth pausing over.
 */
export type DelhiveryWriteOperation =
  /** Manifests a real parcel Delhivery now expects to collect. */
  | 'shipment.create'
  /** Changes a real consignee address / phone / payment mode. */
  | 'shipment.edit'
  /** Cancels a real parcel — possibly one already promised to a customer. */
  | 'shipment.cancel'
  /** Dispatches a real field executive to a real warehouse. */
  | 'pickup.request'
  /** Changes real delivery behaviour on a live NDR shipment. */
  | 'ndr.action'
  /** Registers/edits a pickup location on the live Delhivery account. */
  | 'warehouse.write'
  /** Attaches a real e-waybill to a consignment (tax document). */
  | 'ewaybill.update'
  /** Consumes real AWB numbers from the account's allocation. */
  | 'waybill.fetch';

/**
 * The guard that makes a sandbox-less integration survivable.
 *
 * Skydrop has no Delhivery sandbox — the only environment is production.
 * That is workable for READS (serviceability, tracking, cost, TAT, EPOD
 * are free and side-effect-free, and they exercise auth, transport, rate
 * limiting and response parsing — most of the integration risk). It is
 * emphatically not workable for writes by accident: a create call
 * manifests a parcel a courier will come to collect, a pickup request
 * sends a human to a building, a cancel can kill a customer's live order.
 *
 * So writes are gated on an explicit setting that DEFAULTS TO OFF and
 * fails closed. Turning it on is a deliberate, audited act — and it is
 * also what makes a controlled first-parcel test possible: enable, create
 * exactly one shipment to an address you control, verify, disable again.
 *
 * The guard is NOT a substitute for correctness. It exists because the
 * cost of an accidental write here is measured in real rupees and real
 * vans, and "we can't lose even 1 rupee" is the standard this system was
 * asked to hold to.
 */
@Injectable()
export class DelhiveryWriteGuardService {
  private readonly logger = new Logger(DelhiveryWriteGuardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /** Whether the write flag is on. Says nothing about WHERE writes go. */
  async liveWritesEnabled(): Promise<boolean> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: LIVE_WRITES_SETTING },
      select: { valueBoolean: true },
    });
    // Fail CLOSED: an unreadable or absent setting means "not enabled".
    return row?.valueBoolean === true;
  }

  /**
   * Where writes would currently go: a simulator, or Delhivery itself.
   *
   * This exists because the write flag alone became ambiguous the moment
   * a simulator existed. Testing the real code path requires turning the
   * flag ON — and it is then one edit to `courier.delhivery_api_base_url`
   * away from a background worker manifesting real parcels, silently,
   * with nobody having decided to. Permission granted for a simulator
   * must not silently become permission for production.
   *
   * Anything that is not recognisably a simulator is treated as
   * PRODUCTION, including an unreadable or malformed base URL. The
   * default has to be the expensive-to-be-wrong-about one.
   */
  async writeTarget(): Promise<{ simulator: boolean; host: string }> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: BASE_URL_SETTING },
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
    operation: DelhiveryWriteOperation,
    context: Record<string, unknown> = {},
  ): Promise<void> {
    const target = await this.writeTarget();

    if (await this.liveWritesEnabled()) {
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
        action: 'courier.delhivery.live_write_to_production',
        entityType: 'courier',
        entityId: null,
        severity: 'HIGH',
        metadata: { courierCode: 'delhivery', operation, host: target.host, ...context },
      });
      this.logger.warn(
        { operation, host: target.host, ...context },
        'Delhivery LIVE write to PRODUCTION — this has a physical-world effect',
      );
      return;
    }

    this.logger.warn(
      { operation, ...context },
      'Delhivery live write BLOCKED — courier.delhivery_live_writes_enabled is off',
    );
    await this.audit.log({
      actorType: ActorType.SYSTEM,
      action: 'courier.delhivery.live_write_blocked',
      entityType: 'courier',
      entityId: null,
      severity: 'HIGH',
      metadata: { courierCode: 'delhivery', operation, ...context },
    });

    throw new ForbiddenException({
      code: 'DELHIVERY_LIVE_WRITES_DISABLED',
      message:
        `Refusing to '${operation}' against the live Delhivery account: ` +
        `${LIVE_WRITES_SETTING} is off. This call would create a real ` +
        `physical or billable effect. Enable the setting deliberately ` +
        `(admin → system settings) when you intend live operations.`,
      cause: { operation },
    });
  }
}
