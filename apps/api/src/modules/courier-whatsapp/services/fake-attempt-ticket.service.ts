import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, TicketType } from '@skydrop/db';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TicketService } from '../../ticket/services/ticket.service';
import { FAKE_ATTEMPT_CATEGORY, FAKE_ATTEMPT_OPEN_STATUSES } from './courier-whatsapp-read.service';

export interface FakeAttemptResult {
  /** False when an open one already existed and is returned as-is. */
  readonly created: boolean;
  readonly ticket: { readonly id: string; readonly number: string };
}

/**
 * Staff-only: Delhivery's panel says the NDR remark is NOT verified (the
 * attempt may never have happened). Opens ONE ticket per shipment in the
 * courier's own category "Delivery or consignee pickup failed due to
 * incorrect / fake remark" (`not-delivered.fake-remark`), the same
 * advisory-lock + open-check shape as the cancel request. The ticket is
 * the staff's own work item; it is not an amount, a status change or a
 * call to the courier.
 */
@Injectable()
export class FakeAttemptTicketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketService,
  ) {}

  async raise(shipmentId: string, staffId: string): Promise<FakeAttemptResult> {
    const ship = await this.prisma.client.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        awbNumber: true,
        courierCode: true,
        orderShipments: {
          select: { order: { select: { id: true, sellerId: true } } },
          orderBy: { shipmentSequence: 'desc' },
          take: 1,
        },
      },
    });
    const order = ship?.orderShipments[0]?.order ?? null;
    if (ship === null || order === null) {
      throw new NotFoundException({ code: 'SHIPMENT_NOT_FOUND', message: 'Shipment not found' });
    }

    return this.prisma.client.$transaction(async (tx) => {
      await takeAdvisoryLock(tx, AdvisoryLock.FAKE_ATTEMPT_TICKET, ship.id);

      const existing = await tx.ticket.findFirst({
        where: {
          shipmentId: ship.id,
          issueCategoryExternalId: FAKE_ATTEMPT_CATEGORY,
          status: { in: [...FAKE_ATTEMPT_OPEN_STATUSES] },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, ticketNumber: true },
      });
      if (existing !== null) {
        return { created: false, ticket: { id: existing.id, number: existing.ticketNumber } };
      }

      const latest = await tx.courierNdrPanelSnapshot.findFirst({
        where: { shipmentId: ship.id },
        orderBy: [{ readAt: 'desc' }, { id: 'desc' }],
        select: { remarkVerified: true, attemptsFailed: true, attemptsMax: true, reasonText: true },
      });
      if (latest === null || latest.remarkVerified !== false) {
        throw new ConflictException({
          code: 'NDR_REMARK_NOT_UNVERIFIED',
          message: "Delhivery's panel does not show this NDR remark as not verified.",
        });
      }

      const description = [
        'Delhivery One shows the NDR remark for this delivery attempt as "Not Verified".',
        latest.attemptsFailed !== null && latest.attemptsMax !== null
          ? `Attempts failed: ${latest.attemptsFailed} of ${latest.attemptsMax}.`
          : null,
        latest.reasonText === null ? null : `NDR text on their panel: ${latest.reasonText}`,
        'Please ask Delhivery to prove the attempt, or re-attempt.',
      ]
        .filter((l): l is string => l !== null)
        .join('\n');

      const opened = await this.tickets.openOrFind(
        {
          ticketType: TicketType.COURIER_NDR_ESCALATION,
          sellerId: order.sellerId,
          subject: `Fake delivery attempt? AWB ${ship.awbNumber ?? ''}`.trim(),
          description,
          orderId: order.id,
          shipmentId: ship.id,
          courierCode: ship.courierCode,
          issueCategoryExternalId: FAKE_ATTEMPT_CATEGORY,
        },
        { type: ActorType.STAFF, staffId },
        tx,
      );
      return {
        created: opened.created,
        ticket: { id: opened.ticket.id, number: opened.ticket.ticketNumber },
      };
    });
  }
}
