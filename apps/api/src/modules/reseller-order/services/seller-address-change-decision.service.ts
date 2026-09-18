import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ActorType, StoreAddressChangeStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import type { AuthenticatedSeller } from '../../../common/types/request';
import type { UpdateOrderDto } from '../../order/dto/update-order.dto';
import { AddressChangeNotifier } from './address-change-notifier.service';
import { StoreOrderEditService } from './store-order-edit.service';
import {
  StoreAddressChangeService,
  summarise,
  type AddressChangeRequestView,
} from './store-address-change.service';

/**
 * Seller staff deciding a correction one of their reseller stores asked
 * for (2026-09-16, owner).
 *
 * The twin of `SellerStoreActionDecisionService`, and deliberately the
 * same shape — a guarded claim, the seller's own columns, approving RUNS
 * it — so the two queues cannot drift into two behaviours. What differs
 * is what "running it" means: an address correction is written through
 * `OrderService.edit` with the store scope, which is the SAME path a
 * DIRECT correction takes.
 *
 * ── A YES THAT COULD NOT BE CARRIED OUT IS ITS OWN OUTCOME ───────────
 * The order may have moved on between the ask and the answer — confirmed,
 * cancelled, or into a call. `edit` refuses those by name, and that
 * refusal is NOT an error to throw at seller staff: they answered
 * correctly and the world changed underneath them. The row is recorded
 * FAILED with the refusal kept verbatim, and the store is told, because
 * "they agreed but it did not happen" is what somebody has to tell the
 * customer. Throwing instead would leave the request APPROVED forever
 * with nothing having happened and nobody told.
 *
 * ── CLAIMED, NEVER READ-THEN-WRITTEN ─────────────────────────────────
 * A guarded `updateMany` on (PENDING, this seller's) is the claim. Two
 * tabs open on the queue both see it waiting; only one may decide it,
 * and the loser is told so rather than quietly editing the order twice.
 */

/** The whole row — every column `toView` and the edit need. */
type RequestRow = Awaited<
  ReturnType<PrismaService['client']['storeAddressChangeRequest']['findUniqueOrThrow']>
>;

@Injectable()
export class SellerAddressChangeDecisionService {
  private readonly logger = new Logger(SellerAddressChangeDecisionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly applier: StoreOrderEditService,
    private readonly requests: StoreAddressChangeService,
    private readonly notifier: AddressChangeNotifier,
  ) {}

  /**
   * What this seller's stores are waiting on, oldest first.
   *
   * The order's CURRENT recipient block travels with each row, because
   * the question seller staff are actually answering is "is the new one
   * better than the one the parcel carries today" — and they cannot
   * answer it from the proposal alone.
   */
  async listPending(sellerId: string): Promise<readonly unknown[]> {
    return this.prisma.client.storeAddressChangeRequest.findMany({
      where: { sellerId, status: StoreAddressChangeStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: {
        order: {
          select: {
            orderNumber: true,
            status: true,
            recipientName: true,
            recipientPhoneE164: true,
            recipientAltPhoneE164: true,
            recipientEmail: true,
            recipientAddressLine1: true,
            recipientAddressLine2: true,
            recipientLandmark: true,
            recipientCity: true,
            recipientStateProvince: true,
            recipientPostalCode: true,
          },
        },
        store: { select: { id: true, name: true, displayName: true } },
      },
    });
  }

  async approve(
    seller: AuthenticatedSeller,
    requestId: string,
    note: string | null,
    ctx: ClientContext,
  ): Promise<AddressChangeRequestView> {
    const row = await this.claim(seller, requestId, true, note);
    // Off the WHOLE row: the claim's own narrow projection would leave
    // every recipient column undefined and apply an empty change.
    const view = this.requests.toView(row);
    const fields = view.fields;
    // The WHOLE proposed change (2026-09-18) — the patch when the row
    // carries one, else the recipient columns, which ARE the whole change
    // for a row held before the patch existed. Approving must apply
    // exactly what seller staff were shown, not a recipient-shaped
    // subset of it.
    const patch = (view.patch ?? fields) as unknown as UpdateOrderDto;

    await this.audit.log({
      actorType: ActorType.SELLER,
      actorId: seller.userId,
      sellerId: seller.id,
      action: 'seller.store_address_change.approved',
      entityType: 'store_address_change_request',
      entityId: requestId,
      // What a parcel carries and where it is going, changed on the
      // seller's say-so about somebody else's customer.
      severity: 'MEDIUM',
      metadata: { orderId: row.orderId, storeId: row.storeId, changes: view.changes },
    });

    // THE SAME METHOD a DIRECT change runs (`StoreOrderEditService.apply`),
    // not a second call to `edit` alongside it: two callers of the writer
    // drift, and the one that drifts is the approval path, which nobody
    // exercises by hand.
    let applied = true;
    let failureReason: string | null = null;
    try {
      await this.applier.apply({
        sellerId: row.sellerId,
        storeId: row.storeId,
        orderId: row.orderId,
        patch,
        storeUserId: row.requestedByStoreUserId,
        ctx,
      });
    } catch (err) {
      applied = false;
      failureReason = this.refusal(err);
      this.logger.warn(
        { requestId, err: failureReason },
        'An approved store change could not be applied',
      );
    }

    // Guarded on APPROVED, the state the claim left it in: only this
    // approval moves it on, and a row something else closed keeps its
    // outcome rather than being overwritten.
    await this.prisma.client.storeAddressChangeRequest.updateMany({
      where: { id: requestId, status: StoreAddressChangeStatus.APPROVED },
      data: applied
        ? { status: StoreAddressChangeStatus.APPLIED, appliedAt: new Date() }
        : { status: StoreAddressChangeStatus.FAILED, failureReason },
    });
    const done = await this.prisma.client.storeAddressChangeRequest.findUniqueOrThrow({
      where: { id: requestId },
    });

    await this.tellTheStore(row, view, true, applied, failureReason, note);
    return this.requests.toView(done);
  }

  async reject(
    seller: AuthenticatedSeller,
    requestId: string,
    note: string,
  ): Promise<AddressChangeRequestView> {
    const row = await this.claim(seller, requestId, false, note);

    await this.audit.log({
      actorType: ActorType.SELLER,
      actorId: seller.userId,
      sellerId: seller.id,
      action: 'seller.store_address_change.rejected',
      entityType: 'store_address_change_request',
      entityId: requestId,
      severity: 'LOW',
      metadata: { orderId: row.orderId, storeId: row.storeId },
    });

    await this.tellTheStore(row, this.requests.toView(row), false, false, null, note);
    return this.requests.toView(row);
  }

  /**
   * The server's own words for why an approved correction did not land.
   *
   * Kept VERBATIM where the refusal carried a code — `NOT_EDITABLE`,
   * `COURIER_MUST_ACCEPT_ADDRESS_CHANGE`, `RETAIL_OUT_OF_RANGE` — because the store
   * has to tell a customer something specific, and "it failed" is not
   * something anybody can act on.
   */
  private refusal(err: unknown): string {
    const body = (err as { response?: unknown })?.response;
    if (typeof body === 'object' && body !== null) {
      const { code, message } = body as { code?: unknown; message?: unknown };
      if (typeof code === 'string' && typeof message === 'string') return `[${code}] ${message}`;
      if (typeof message === 'string') return message;
    }
    return err instanceof Error ? err.message : 'The order could not be edited.';
  }

  /** Email the store what was decided. They have no inbox. Never throws. */
  private async tellTheStore(
    row: RequestRow,
    view: AddressChangeRequestView,
    approved: boolean,
    applied: boolean,
    failureReason: string | null,
    note: string | null,
  ): Promise<void> {
    const order = await this.prisma.client.order.findUnique({
      where: { id: row.orderId },
      select: { orderNumber: true, seller: { select: { companyName: true } } },
    });
    if (order === null) return;
    await this.notifier.decided({
      storeId: row.storeId,
      requestId: row.id,
      approved,
      applied,
      failureReason,
      orderId: row.orderId,
      orderNumber: order.orderNumber,
      sellerName: order.seller.companyName,
      reason: row.reason,
      summary: summarise(view.fields, view.changes),
      decisionNote: note?.trim() === '' ? null : (note?.trim() ?? null),
    });
  }

  /**
   * Take the decision, or find out somebody else already did.
   *
   * The seller's answer lands in the SELLER columns — never a staff one,
   * or "who allowed this" would read as Skydrop when it was the seller.
   *
   * Returns the WHOLE row, not a projection: the caller needs every
   * recipient column to build the patch, and a narrow select here was a
   * real bug — it made the applied correction empty.
   */
  private async claim(
    seller: AuthenticatedSeller,
    requestId: string,
    approved: boolean,
    note: string | null,
  ): Promise<RequestRow> {
    const claimed = await this.prisma.client.storeAddressChangeRequest.updateMany({
      where: {
        id: requestId,
        sellerId: seller.id,
        status: StoreAddressChangeStatus.PENDING,
      },
      data: {
        // APPROVED first; `approve` moves it on to APPLIED or FAILED once
        // it knows which. A crash between leaves an APPROVED row that
        // visibly has not been applied, rather than a PENDING one that
        // silently has (visible-vs-silent).
        status: approved ? StoreAddressChangeStatus.APPROVED : StoreAddressChangeStatus.REJECTED,
        decidedBySellerUserId: seller.userId,
        sellerDecidedAt: new Date(),
        decisionNote: note?.trim() === '' ? null : (note?.trim() ?? null),
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException({
        code: 'ADDRESS_CHANGE_ALREADY_DECIDED',
        message: 'This correction is no longer waiting for you',
      });
    }
    return this.prisma.client.storeAddressChangeRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
  }
}
