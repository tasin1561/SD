import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WebhookDeliveryStatus } from '@skydrop/db';
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../common/types/request';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

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
 * Lets ops see which seller webhook fires succeeded / failed without
 * touching the DB directly. Useful for diagnosing endpoint config
 * issues + spotting auto-disable thresholds being approached.
 */
@ApiTags('admin-webhook-deliveries')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/webhook-deliveries')
export class AdminWebhookDeliveriesController {
  constructor(private readonly prisma: PrismaService) {}

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
}
