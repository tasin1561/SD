import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { assertPublicHttpsUrl, SsrfBlockedError } from '../../../common/net/ssrf-guard';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { CreateWebhookEndpointDto } from '../../seller-webhook/dto/create-webhook-endpoint.dto';
import type { UpdateWebhookEndpointDto } from '../../seller-webhook/dto/update-webhook-endpoint.dto';

export interface StoreWebhookView {
  readonly id: string;
  readonly url: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly subscribedEvents: readonly string[];
  readonly isActive: boolean;
  readonly lastSuccessAt: Date | null;
  readonly lastFailureAt: Date | null;
  readonly consecutiveFailureCount: number;
  readonly autoDisabledAt: Date | null;
  readonly autoDisabledReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface StoreWebhookWithSecret extends StoreWebhookView {
  /** Shown on create and rotate ONLY. */
  readonly secretKey: string;
}

const SELECT = {
  id: true,
  url: true,
  name: true,
  description: true,
  subscribedEvents: true,
  isActive: true,
  lastSuccessAt: true,
  lastFailureAt: true,
  consecutiveFailureCount: true,
  autoDisabledAt: true,
  autoDisabledReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

type StoreUserRef = { readonly id: string; readonly storeId: string; readonly sellerId: string };

/**
 * RS-5 — a reseller store's OWN outbound webhook endpoints.
 *
 * The existing machinery, scoped to the store rather than copied: rows go
 * in `seller_webhook_endpoints` under the store's seller with
 * `reseller_store_id` = the store, and the ONE delivery pipeline
 * (`OutboundWebhookListener` → queue → dispatcher, HMAC, retries,
 * auto-disable, SSRF guard at dispatch) delivers them. The listener sends
 * a reseller order's events to its store's endpoints ONLY, and a channel
 * order's to the seller's own (`reseller_store_id IS NULL`) ONLY;
 * `SellerWebhookService` cannot see these rows at all.
 */
@Injectable()
export class StoreWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async list(storeId: string): Promise<StoreWebhookView[]> {
    return this.prisma.client.sellerWebhookEndpoint.findMany({
      where: { resellerStoreId: storeId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: SELECT,
    });
  }

  async create(
    user: StoreUserRef,
    body: CreateWebhookEndpointDto,
  ): Promise<StoreWebhookWithSecret> {
    await this.assertDeliverableUrl(body.url);
    const secretKey = randomBytes(32).toString('hex');
    const row = await this.prisma.client.sellerWebhookEndpoint.create({
      data: {
        sellerId: user.sellerId,
        resellerStoreId: user.storeId,
        url: body.url,
        secretKey,
        name: body.name ?? null,
        description: body.description ?? null,
        subscribedEvents: body.subscribedEvents,
        isActive: body.isActive ?? true,
      },
      select: SELECT,
    });
    await this.log(user, 'store.webhook.created', row.id, { url: body.url });
    return { ...row, secretKey };
  }

  async update(
    user: StoreUserRef,
    id: string,
    body: UpdateWebhookEndpointDto,
  ): Promise<StoreWebhookView> {
    await this.owned(user.storeId, id);
    const data: Record<string, unknown> = {};
    if (body.url !== undefined) {
      await this.assertDeliverableUrl(body.url);
      data.url = body.url;
    }
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.subscribedEvents !== undefined) data.subscribedEvents = body.subscribedEvents;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    const row = await this.prisma.client.sellerWebhookEndpoint.update({
      where: { id },
      data,
      select: SELECT,
    });
    await this.log(user, 'store.webhook.updated', id, { fields: Object.keys(data) });
    return row;
  }

  async rotateSecret(user: StoreUserRef, id: string): Promise<StoreWebhookWithSecret> {
    const owned = await this.owned(user.storeId, id);
    const secretKey = randomBytes(32).toString('hex');
    const row = await this.prisma.client.sellerWebhookEndpoint.update({
      where: { id },
      data: {
        secretKey,
        previousSecretKey: owned.secretKey,
        previousSecretKeyValidUntil: new Date(Date.now() + 86_400_000),
      },
      select: SELECT,
    });
    await this.log(user, 'store.webhook.secret_rotated', id, {});
    return { ...row, secretKey };
  }

  async softDelete(user: StoreUserRef, id: string): Promise<void> {
    await this.owned(user.storeId, id);
    await this.prisma.client.sellerWebhookEndpoint.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.log(user, 'store.webhook.deleted', id, {});
  }

  private async owned(storeId: string, id: string): Promise<{ id: string; secretKey: string }> {
    const row = await this.prisma.client.sellerWebhookEndpoint.findFirst({
      where: { id, resellerStoreId: storeId, deletedAt: null },
      select: { id: true, secretKey: true },
    });
    if (row === null) {
      throw new NotFoundException({
        code: 'WEBHOOK_NOT_FOUND',
        message: 'Webhook endpoint not found',
      });
    }
    return row;
  }

  /** The fast-fail copy; the dispatcher checks again at delivery (DNS can change). */
  private async assertDeliverableUrl(url: string): Promise<void> {
    try {
      await assertPublicHttpsUrl(url);
    } catch (e) {
      if (e instanceof SsrfBlockedError) {
        throw new BadRequestException({
          code: 'WEBHOOK_URL_NOT_DELIVERABLE',
          message: `Webhook URL rejected: ${e.reason}. It must be a public https endpoint.`,
        });
      }
      throw e;
    }
  }

  private async log(
    user: StoreUserRef,
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.log({
      actorType: ActorType.STORE,
      actorId: user.id,
      sellerId: user.sellerId,
      action,
      entityType: 'seller_webhook_endpoint',
      entityId,
      severity: 'MEDIUM',
      metadata: { storeId: user.storeId, ...metadata },
    });
  }
}
