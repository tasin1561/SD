import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, Prisma, SellerStoreKind, StoreAddressChangeStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { RECIPIENT_KEYS } from '../../order/services/order.service';
import type { UpdateOrderDto } from '../../order/dto/update-order.dto';
import { AddressChangeNotifier } from './address-change-notifier.service';

/**
 * A reseller store's address correction, HELD while seller staff decide
 * (2026-09-16, owner: "make the option to enable and disable this from
 * seller for reseller store. also they can select ask them or direct").
 *
 * This is the follow-up `StoreOrderEditService` recorded when the policy
 * shipped: ASK_SELLER used to refuse by name, because a held request
 * needed somewhere to live and the delivery-action queue could not hold
 * it (its rows require a shipment, and an order this early has none).
 * `store_address_change_requests` is that somewhere.
 *
 * ── THE ORDER KEEPS THE OLD ADDRESS UNTIL SOMEBODY SAYS OTHERWISE ────
 * The proposal sits in its own table rather than on the order. Parking a
 * pending correction on the order itself would mean every reader of the
 * recipient block has to know which of the two is live, and the first
 * reader that forgets prints an address nobody approved onto a label.
 *
 * ── ONE OPEN CORRECTION PER ORDER ────────────────────────────────────
 * A second correction while one is open is refused rather than
 * queued. Two proposals for one address cannot both be right, and
 * approving them in the order they happened to be decided would apply
 * the older one last. "Open" is PENDING or APPROVED — an approved one is
 * still being applied. Checked under `AdvisoryLock.STORE_ADDRESS_CHANGE`
 * inside the insert's transaction (2026-09-17): a read before the insert
 * with nothing between let two clicks both pass.
 */

/** Statuses in which a correction is still open (answered or not, not finished). */
export const OPEN_ADDRESS_CHANGE_STATUSES: readonly StoreAddressChangeStatus[] = [
  StoreAddressChangeStatus.PENDING,
  StoreAddressChangeStatus.APPROVED,
];

/** What the store is proposing, as columns on the request row. */
export type AddressChangeFields = Partial<Record<(typeof RECIPIENT_KEYS)[number], string>>;

export interface AddressChangeRequestView {
  readonly id: string;
  readonly orderId: string;
  readonly status: StoreAddressChangeStatus;
  readonly reason: string;
  /** Only the RECIPIENT fields this change proposes. */
  readonly fields: AddressChangeFields;
  /**
   * The WHOLE proposed change (2026-09-18) — the recipient fields above
   * and anything else the store sent: products, quantities, retail, the
   * money the customer pays. Null on rows held before this existed, whose
   * proposal is entirely in `fields`.
   */
  readonly patch: Record<string, unknown> | null;
  /** The keys it proposes, for a screen that lists them. */
  readonly changes: readonly string[];
  readonly decisionNote: string | null;
  readonly sellerDecidedAt: string | null;
  readonly appliedAt: string | null;
  readonly failureReason: string | null;
  readonly createdAt: string;
}

/** What a person calls each field, for the notice and the seller's queue. */
const FIELD_LABEL: Readonly<Record<(typeof RECIPIENT_KEYS)[number], string>> = {
  recipientName: 'the name',
  recipientPhoneE164: 'the phone number',
  recipientAltPhoneE164: 'the second phone number',
  recipientEmail: 'the email',
  recipientAddressLine1: 'the address',
  recipientAddressLine2: 'the second address line',
  recipientLandmark: 'the landmark',
  recipientCity: 'the city',
  recipientStateProvince: 'the state',
  recipientPostalCode: 'the PIN code',
};

/**
 * "the address and the PIN code" — what the seller is told is changing.
 *
 * `changed` is every key the change proposes (2026-09-18), which may
 * include things that are not recipient fields at all; those are named
 * by their own words rather than left out, or a change that only moves
 * the quantities would read as "nothing".
 */
export function summarise(fields: AddressChangeFields, changed?: readonly string[]): string {
  const recipient = (Object.keys(fields) as Array<keyof AddressChangeFields>).filter(
    (k) => fields[k] !== undefined,
  );
  const names = [
    ...recipient.map((k) => FIELD_LABEL[k]),
    ...(changed ?? [])
      .filter((k) => !(recipient as readonly string[]).includes(k))
      .map((k) => OTHER_LABEL[k] ?? k),
  ];
  if (names.length === 0) return 'nothing';
  const last = names[names.length - 1];
  if (names.length === 1 || last === undefined) return names[0] ?? 'nothing';
  return `${names.slice(0, -1).join(', ')} and ${last}`;
}

/** What a person calls the non-recipient things a change can move. */
const OTHER_LABEL: Readonly<Record<string, string>> = {
  items: 'what is in the parcel',
  codAmountInr: 'the cash to collect',
  paymentMode: 'how it is paid for',
  advanceAmountInr: 'the advance already paid',
  deliveryFeeInr: 'the delivery charged to the customer',
  discountInr: 'the discount',
  declaredValueInr: 'the declared value',
  totalWeightGrams: 'the weight',
  packageType: 'the package',
  isUrgent: 'whether it is urgent',
  sellerOrderRef: 'the reference',
  sellerNotes: 'the notes',
};

/** The proposed fields off a patch — only what was actually sent. */
export function fieldsFromPatch(patch: UpdateOrderDto): AddressChangeFields {
  const out: AddressChangeFields = {};
  for (const key of RECIPIENT_KEYS) {
    const value = (patch as Record<string, unknown>)[key];
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

@Injectable()
export class StoreAddressChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly notifier: AddressChangeNotifier,
  ) {}

  /**
   * Hold a correction for seller staff.
   *
   * Called only by `StoreOrderEditService`, and only on ASK_SELLER — the
   * routing decision stays in one place there rather than being made
   * again here.
   */
  async hold(input: {
    storeId: string;
    storeUserId: string | null;
    sellerId: string;
    orderId: string;
    reason: string;
    fields: AddressChangeFields;
    /** The whole proposed change — a superset of `fields` (2026-09-18). */
    patch: Record<string, unknown>;
  }): Promise<AddressChangeRequestView> {
    if (Object.keys(input.patch).length === 0) {
      throw new BadRequestException({
        code: 'ADDRESS_CHANGE_EMPTY',
        message: 'Nothing to change — send at least one thing.',
      });
    }

    const order = await this.ownOrder(input.storeId, input.orderId);

    const row = await this.prisma.client.$transaction(async (tx) => {
      await takeAdvisoryLock(tx, AdvisoryLock.STORE_ADDRESS_CHANGE, input.orderId);
      const open = await tx.storeAddressChangeRequest.findFirst({
        where: { orderId: input.orderId, status: { in: [...OPEN_ADDRESS_CHANGE_STATUSES] } },
        select: { id: true },
      });
      if (open !== null) {
        // 409, not 400: nothing is wrong with what was sent; it conflicts
        // with a correction already open on the order.
        throw new ConflictException({
          code: 'ADDRESS_CHANGE_ALREADY_OPEN',
          message:
            'A correction on this order is already with the seller. That one has to be finished first.',
        });
      }
      return tx.storeAddressChangeRequest.create({
        data: {
          orderId: input.orderId,
          sellerId: input.sellerId,
          storeId: input.storeId,
          requestedByStoreUserId: input.storeUserId,
          reason: input.reason.trim(),
          // BOTH: the recipient columns keep every existing reader
          // working (the seller's queue, `summarise`, the notices), and
          // the patch carries what columns cannot express.
          ...input.fields,
          patch: input.patch as Prisma.InputJsonValue,
        },
      });
    });

    await this.audit.log({
      actorType: ActorType.STORE,
      actorId: input.storeUserId,
      sellerId: input.sellerId,
      action: 'store.address_change.requested',
      entityType: 'store_address_change_request',
      entityId: row.id,
      severity: 'LOW',
      metadata: {
        orderId: input.orderId,
        storeId: input.storeId,
        changes: Object.keys(input.patch),
      },
    });

    // Nothing happens to the parcel until the seller answers, so somebody
    // there has to know it is sitting with them. Awaited and never
    // throwing: the request is the durable fact (NOTIF-1/NOTIF-19).
    await this.notifier.waitingOnSeller({
      sellerId: input.sellerId,
      requestId: row.id,
      storeName: order.storeName,
      orderNumber: order.orderNumber,
      reason: input.reason.trim(),
      summary: summarise(input.fields, Object.keys(input.patch)),
    });

    return this.toView(row);
  }

  /** What this store has asked to correct on one of its own orders. */
  async listForOrder(
    storeId: string,
    orderId: string,
  ): Promise<readonly AddressChangeRequestView[]> {
    await this.ownOrder(storeId, orderId);
    const rows = await this.prisma.client.storeAddressChangeRequest.findMany({
      where: { orderId, storeId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => this.toView(r));
  }

  /** The row as the portal and the seller's queue read it. */
  toView(row: {
    id: string;
    orderId: string;
    status: StoreAddressChangeStatus;
    reason: string;
    patch?: Prisma.JsonValue | null;
    decisionNote: string | null;
    sellerDecidedAt: Date | null;
    appliedAt: Date | null;
    failureReason: string | null;
    createdAt: Date;
  }): AddressChangeRequestView {
    const fields: AddressChangeFields = {};
    for (const key of RECIPIENT_KEYS) {
      const value = (row as unknown as Record<string, unknown>)[key];
      if (typeof value === 'string') fields[key] = value;
    }
    const patch =
      row.patch !== null && typeof row.patch === 'object' && !Array.isArray(row.patch)
        ? (row.patch as Record<string, unknown>)
        : null;
    return {
      id: row.id,
      orderId: row.orderId,
      status: row.status,
      reason: row.reason,
      fields,
      patch,
      // A row held before `patch` existed proposed only recipient fields,
      // so its own columns ARE the whole change.
      changes: Object.keys(patch ?? fields),
      decisionNote: row.decisionNote,
      sellerDecidedAt: row.sellerDecidedAt?.toISOString() ?? null,
      appliedAt: row.appliedAt?.toISOString() ?? null,
      failureReason: row.failureReason,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** This store's own order, or a 404 that says nothing more. */
  private async ownOrder(
    storeId: string,
    orderId: string,
  ): Promise<{ orderNumber: string; storeName: string }> {
    const order = await this.prisma.client.order.findFirst({
      where: { id: orderId, storeId, storeKind: SellerStoreKind.RESELLER, deletedAt: null },
      // The store's name AS PLACED (ORD-6).
      select: { orderNumber: true, storeNameSnapshot: true },
    });
    if (order === null) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'No such order' });
    }
    return {
      orderNumber: order.orderNumber,
      storeName: order.storeNameSnapshot ?? 'a reseller store',
    };
  }
}
