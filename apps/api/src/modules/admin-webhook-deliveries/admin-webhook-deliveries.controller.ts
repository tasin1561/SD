import { createHmac } from 'node:crypto';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorType, WebhookDeliveryStatus } from '@skydrop/db';
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../common/types/request';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../auth-common/services/audit-log.service';
import { OutboundWebhookQueue } from '../seller-webhook-delivery/queue/outbound-webhook.queue';

interface DeliveryView {
  readonly id: string;
  readonly endpointId: string;
  readonly endpointUrl: string;
  readonly sellerId: string;
  readonly sellerCompany: string;
  readonly eventType: string;
  readonly eventId: string;
  readonly attemptNumber: number;
  readonly maxAttempts: number;
  readonly status: WebhookDeliveryStatus;
  readonly responseStatus: number | null;
  readonly responseTimeMs: number | null;
  readonly errorCode: string | null;
  readonly sentAt: string | null;
  readonly createdAt: string;
}

/**
 * Phase 1B bundle #4 — admin view of outbound webhook deliveries.
 *
 * GET = paginated read; POST :id/retry = manual re-enqueue of a
 * FAILED / ABANDONED row. The retry re-signs the payload with the
 * endpoint's CURRENT secret (so a secret rotation since the original
 * fire is honoured) and enqueues a fresh BullMQ job.
 */
@ApiTags('admin-webhook-deliveries')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/webhook-deliveries')
export class AdminWebhookDeliveriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: OutboundWebhookQueue,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Paginated outbound webhook deliveries' })
  async list(
    @CurrentStaff() _staff: AuthenticatedStaff,
    @Query('sellerId') sellerId?: string,
    @Query('endpointId') endpointId?: string,
    @Query('status') status?: WebhookDeliveryStatus,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{
    items: DeliveryView[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const pg = Math.max(1, Number(page) || 1);
    const ps = Math.min(200, Math.max(1, Number(pageSize) || 50));
    const where: Record<string, unknown> = {};
    if (endpointId) where.endpointId = endpointId;
    if (status) where.status = status;
    if (sellerId) {
      where.endpoint = { sellerId };
    }
    const [rows, total] = await Promise.all([
      this.prisma.client.outboundWebhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pg - 1) * ps,
        take: ps,
        select: {
          id: true,
          endpointId: true,
          eventType: true,
          eventId: true,
          attemptNumber: true,
          maxAttempts: true,
          status: true,
          responseStatus: true,
          responseTimeMs: true,
          errorCode: true,
          sentAt: true,
          createdAt: true,
          endpoint: {
            select: {
              url: true,
              sellerId: true,
              seller: { select: { companyName: true } },
            },
          },
        },
      }),
      this.prisma.client.outboundWebhookDelivery.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        endpointId: r.endpointId,
        endpointUrl: r.endpoint.url,
        sellerId: r.endpoint.sellerId,
        sellerCompany: r.endpoint.seller.companyName,
        eventType: r.eventType,
        eventId: r.eventId,
        attemptNumber: r.attemptNumber,
        maxAttempts: r.maxAttempts,
        status: r.status,
        responseStatus: r.responseStatus,
        responseTimeMs: r.responseTimeMs,
        errorCode: r.errorCode,
        sentAt: r.sentAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page: pg,
      pageSize: ps,
    };
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Re-enqueue a failed/abandoned delivery (fresh BullMQ job + re-signed with current secret + MEDIUM audit)',
  })
  async retry(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ jobId: string; status: 'enqueued' }> {
    const row = await this.prisma.client.outboundWebhookDelivery.findUnique({
      where: { id },
      select: {
        id: true,
        endpointId: true,
        eventType: true,
        eventId: true,
        payload: true,
        endpoint: {
          select: {
            url: true,
            secretKey: true,
            isActive: true,
            autoDisabledAt: true,
          },
        },
      },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'DELIVERY_NOT_FOUND',
        message: 'Webhook delivery not found',
      });
    }
    if (!row.endpoint.isActive || row.endpoint.autoDisabledAt !== null) {
      throw new NotFoundException({
        code: 'ENDPOINT_DISABLED',
        message: 'Endpoint is disabled or auto-disabled; re-enable it before retrying',
      });
    }

    // Re-sign with the CURRENT endpoint secret — rotation since the
    // original fire is now honoured.
    const body = JSON.stringify(row.payload);
    const signature = createHmac('sha256', row.endpoint.secretKey).update(body).digest('hex');

    const jobId = await this.queue.enqueue({
      endpointId: row.endpointId,
      eventType: row.eventType,
      eventId: row.eventId,
      requestUrl: row.endpoint.url,
      // Cast: Prisma Json column → unknown, but the listener writes
      // a Record<string, unknown> per the contract.
      payload: row.payload as Record<string, unknown>,
      signature,
      attemptNumber: 1,
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staff.id,
      action: 'staff.webhook_delivery.retried',
      entityType: 'outbound_webhook_delivery',
      entityId: id,
      severity: 'MEDIUM',
      changes: {
        endpointId: row.endpointId,
        eventType: row.eventType,
        eventId: row.eventId,
        bullmqJobId: jobId,
      },
      metadata: {
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      },
    });

    return { jobId, status: 'enqueued' };
  }
}
