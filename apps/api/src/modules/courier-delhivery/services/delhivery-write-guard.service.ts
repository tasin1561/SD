import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';

const LIVE_WRITES_SETTING = 'courier.delhivery_live_writes_enabled';

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

  /** Whether live writes are currently permitted. */
  async liveWritesEnabled(): Promise<boolean> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: LIVE_WRITES_SETTING },
      select: { valueBoolean: true },
    });
    // Fail CLOSED: an unreadable or absent setting means "not enabled".
    return row?.valueBoolean === true;
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
    if (await this.liveWritesEnabled()) return;

    this.logger.warn(
      { operation, ...context },
      'Delhivery live write BLOCKED — courier.delhivery_live_writes_enabled is off',
    );
    await this.audit.log({
      actorType: ActorType.SYSTEM,
      action: 'courier.delhivery.live_write_blocked',
      entityType: 'courier',
      entityId: 'delhivery',
      severity: 'HIGH',
      metadata: { operation, ...context },
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
