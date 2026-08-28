import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';

/**
 * What a parcel actually cost us to move.
 *
 * The lane-margin report fills the forward figure automatically from
 * Delhivery's invoice API, but that call is rate-limited and sampled, and
 * the RETURN leg has no equivalent. This is the manual path: an operator
 * reading a courier invoice, recording what a parcel really cost.
 *
 * Forward and return are separate numbers, deliberately. Delhivery
 * refunds the delivery deduction when a parcel comes back and bills an
 * RTO fee instead, so a return's cost is the RTO figure and NOT that
 * plus the forward one. One column holding both would make the P&L
 * charge the same carriage twice.
 */
@Injectable()
export class ShipmentCostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async record(
    staffId: string,
    shipmentId: string,
    input: { forwardCostInr?: string | null; rtoCostInr?: string | null },
  ): Promise<{ actualCourierCostInr: string | null; actualRtoCostInr: string | null }> {
    if (input.forwardCostInr == null && input.rtoCostInr == null) {
      throw new BadRequestException({
        code: 'NO_COST_GIVEN',
        message: 'Give at least one of the two figures',
      });
    }

    const parse = (v: string, which: string): Prisma.Decimal => {
      let d: Prisma.Decimal;
      try {
        d = new Prisma.Decimal(v);
      } catch {
        throw new BadRequestException({
          code: 'COST_INVALID',
          message: `'${v}' is not a ${which} cost`,
        });
      }
      if (d.isNegative() || !d.isFinite()) {
        throw new BadRequestException({
          code: 'COST_INVALID',
          message: 'A courier cannot charge us less than nothing',
        });
      }
      return d;
    };

    const existing = await this.prisma.client.shipment.findFirst({
      where: { id: shipmentId, deletedAt: null },
      select: { id: true, actualCourierCostInr: true, actualRtoCostInr: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: 'No such shipment',
      });
    }

    const row = await this.prisma.client.shipment.update({
      where: { id: shipmentId },
      data: {
        ...(input.forwardCostInr == null
          ? {}
          : {
              actualCourierCostInr: parse(input.forwardCostInr, 'forward'),
              actualCourierCostAt: new Date(),
            }),
        ...(input.rtoCostInr == null
          ? {}
          : { actualRtoCostInr: parse(input.rtoCostInr, 'return') }),
      },
      select: { actualCourierCostInr: true, actualRtoCostInr: true },
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'staff.shipment.cost_recorded',
      entityType: 'shipment',
      entityId: shipmentId,
      // These numbers ARE the margin. A wrong one moves the P&L and
      // nothing else in the system would show it.
      severity: 'MEDIUM',
      metadata: {
        forwardWas: existing.actualCourierCostInr?.toString() ?? null,
        forwardNow: row.actualCourierCostInr?.toString() ?? null,
        rtoWas: existing.actualRtoCostInr?.toString() ?? null,
        rtoNow: row.actualRtoCostInr?.toString() ?? null,
      },
    });

    return {
      actualCourierCostInr: row.actualCourierCostInr?.toString() ?? null,
      actualRtoCostInr: row.actualRtoCostInr?.toString() ?? null,
    };
  }
}
