import { randomBytes } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { CreateWebhookEndpointDto } from '../dto/create-webhook-endpoint.dto';
import type { UpdateWebhookEndpointDto } from '../dto/update-webhook-endpoint.dto';

/**
 * Seller-facing outbound webhook endpoint configuration.
 *
 * Phase 1A scope:
 *   - List / create / update / soft-delete the endpoint config rows
 *     (`seller_webhook_endpoints`).
 *   - Generate (and rotate) the HMAC `secretKey`. Rotation keeps the
 *     previous secret valid for 24h so the seller can swap on their
 *     end without missed signatures (`previousSecretKey` +
 *     `previousSecretKeyValidUntil`).
 *
 * Deferred (Phase 1B):
 *   - The actual outbound DELIVERY pipeline (BullMQ worker that fires
 *     POSTs at configured endpoints with HMAC-SHA256 over the payload,
 *     respects retry policy, auto-disables after N failures). The
 *     schema rows (`OutboundWebhookDelivery`) exist for this; the
 *     worker does not.
 *   - The "test fire" button in the UI is a no-op stub until the
 *     worker lands.
 *
 * Soft-delete only: secrets are kept indefinitely (audit trail).
 */
export interface WebhookEndpointView {
  readonly id: string;
  readonly url: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly subscribedEvents: ReadonlyArray<string>;
  readonly isActive: boolean;
  readonly lastSuccessAt: Date | null;
  readonly lastFailureAt: Date | null;
  readonly consecutiveFailureCount: number;
  readonly autoDisabledAt: Date | null;
  readonly autoDisabledReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  // The secret is returned on create / rotate ONLY (and never logged);
  // GET / list responses omit it because we don't want it in browser
  // memory longer than necessary.
}

export interface WebhookEndpointWithSecret extends WebhookEndpointView {
  readonly secretKey: string;
}

const VIEW_SELECT = {
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

function generateSecret(): string {
  return randomBytes(32).toString('hex');
}

@Injectable()
export class SellerWebhookService {
  constructor(private readonly prisma: PrismaService) {}

  async list(sellerId: string): Promise<WebhookEndpointView[]> {
    return this.prisma.client.sellerWebhookEndpoint.findMany({
      where: { sellerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: VIEW_SELECT,
    });
  }

  async getOwned(sellerId: string, id: string): Promise<WebhookEndpointView> {
    const row = await this.prisma.client.sellerWebhookEndpoint.findFirst({
      where: { id, sellerId, deletedAt: null },
      select: VIEW_SELECT,
    });
    if (!row) throw new NotFoundException('Webhook endpoint not found.');
    return row;
  }

  async create(
    sellerId: string,
    body: CreateWebhookEndpointDto,
  ): Promise<WebhookEndpointWithSecret> {
    const secret = generateSecret();
    const row = await this.prisma.client.sellerWebhookEndpoint.create({
      data: {
        sellerId,
        url: body.url,
        secretKey: secret,
        name: body.name ?? null,
        description: body.description ?? null,
        subscribedEvents: body.subscribedEvents,
        isActive: body.isActive ?? true,
      },
      select: VIEW_SELECT,
    });
    return { ...row, secretKey: secret };
  }

  async update(
    sellerId: string,
    id: string,
    body: UpdateWebhookEndpointDto,
  ): Promise<WebhookEndpointView> {
    const owned = await this.prisma.client.sellerWebhookEndpoint.findFirst({
      where: { id, sellerId, deletedAt: null },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Webhook endpoint not found.');

    const data: Record<string, unknown> = {};
    if (body.url !== undefined) data.url = body.url;
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.subscribedEvents !== undefined) data.subscribedEvents = body.subscribedEvents;
    if (body.isActive !== undefined) data.isActive = body.isActive;

    return this.prisma.client.sellerWebhookEndpoint.update({
      where: { id },
      data,
      select: VIEW_SELECT,
    });
  }

  async rotateSecret(sellerId: string, id: string): Promise<WebhookEndpointWithSecret> {
    const owned = await this.prisma.client.sellerWebhookEndpoint.findFirst({
      where: { id, sellerId, deletedAt: null },
      select: { id: true, secretKey: true },
    });
    if (!owned) throw new NotFoundException('Webhook endpoint not found.');

    const newSecret = generateSecret();
    // Keep prior secret valid for 24h to let the seller swap on their end.
    const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const row = await this.prisma.client.sellerWebhookEndpoint.update({
      where: { id },
      data: {
        secretKey: newSecret,
        previousSecretKey: owned.secretKey,
        previousSecretKeyValidUntil: validUntil,
      },
      select: VIEW_SELECT,
    });
    return { ...row, secretKey: newSecret };
  }

  async softDelete(sellerId: string, id: string): Promise<void> {
    const owned = await this.prisma.client.sellerWebhookEndpoint.findFirst({
      where: { id, sellerId, deletedAt: null },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Webhook endpoint not found.');
    await this.prisma.client.sellerWebhookEndpoint.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }
}
