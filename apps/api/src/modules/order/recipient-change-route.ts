import { ShipmentStatus, type OrderStatus } from '@skydrop/db';

/**
 * WHO may change where a parcel is going — decided in ONE place
 * (owner, 2026-09-18).
 *
 * Pure: no Prisma, no DI. Two callers need the same answer and a third
 * copy of it would be the one that drifts —
 *
 *   `OrderService.edit`      — may we write the order ourselves?
 *   `ShipmentAddressService` — will the courier accept a correction?
 *
 * ── THE QUESTION IS A FACT, NOT A STATUS LIST ────────────────────────
 * It is not "which order statuses may be edited". It is "does anybody
 * outside this building already hold this address?" — because that is
 * what decides whether changing our row changes where the parcel goes,
 * or merely makes our row disagree with the label.
 *
 * A waybill IS that fact. Before one exists nobody outside has the
 * address, whatever the order's status says, so we write it. Once one
 * exists the courier has it, and the owner's rule is absolute: the
 * change is stored ONLY if they accept it, and a refusal leaves the
 * order carrying the address the parcel is actually going to.
 *
 * Reading it off the order's status instead would be wrong in both
 * directions. `AWAITING_COURIER` and a `CONFIRMED` order whose AWB job
 * has not run yet carry no waybill and are perfectly safe to correct;
 * `PENDING_MANUAL_PLACEMENT` may carry one typed off a paper docket.
 */
export type RecipientChangeRoute =
  /** Nobody outside holds the address — write it on the order. */
  | { readonly kind: 'DIRECT' }
  /** The courier holds it. Ask them; store it only if they say yes. */
  | { readonly kind: 'COURIER'; readonly courierWillAccept: boolean; readonly reason: string }
  /** Nothing to correct: the order is finished. */
  | { readonly kind: 'REFUSED'; readonly reason: string };

/**
 * When the courier will still accept a correction.
 *
 * Delhivery's own rule, from the verified contract: forward parcels are
 * editable while Manifested, In Transit or Pending, and never once
 * Dispatched, Delivered, DTO, RTO, LOST or Closed.
 *
 * The mapping that matters and is easy to get wrong: their "Dispatched"
 * is OUR `OUT_FOR_DELIVERY`. A parcel on the van is already past the
 * point of changing where it is going, so that status is OUTSIDE the
 * window even though it feels like the moment you would most want it.
 */
export const COURIER_EDITABLE_SHIPMENT_STATUSES: ReadonlySet<ShipmentStatus> = new Set([
  ShipmentStatus.AWB_GENERATED,
  ShipmentStatus.HANDED_TO_COURIER,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.AT_HUB,
  ShipmentStatus.DELIVERY_ATTEMPTED,
]);

export interface RecipientChangeRouteInput {
  readonly orderStatus: OrderStatus;
  /** From `OrderStateMachineService` / `OrderReadService` — never a local list. */
  readonly isTerminal: boolean;
  /** The order's live parcel, if it has one. */
  readonly liveShipment: {
    readonly status: ShipmentStatus;
    readonly awbNumber: string | null;
  } | null;
}

/** Said in the seller's and the store's terms, never the courier's. */
function courierReason(status: ShipmentStatus): string {
  if (COURIER_EDITABLE_SHIPMENT_STATUSES.has(status)) {
    return 'The courier will still accept a correction on this parcel.';
  }
  return status === ShipmentStatus.OUT_FOR_DELIVERY
    ? 'It is out for delivery — once a parcel is on the van the courier will not change where it is going.'
    : `The courier does not accept changes once a parcel is ${status
        .toLowerCase()
        .replaceAll('_', ' ')}.`;
}

export function recipientChangeRoute(input: RecipientChangeRouteInput): RecipientChangeRoute {
  if (input.isTerminal) {
    return {
      kind: 'REFUSED',
      reason: `This order is ${input.orderStatus
        .toLowerCase()
        .replaceAll('_', ' ')}. There is no parcel left to redirect.`,
    };
  }
  const awb = input.liveShipment?.awbNumber ?? null;
  if (input.liveShipment === null || awb === null || awb.trim() === '') {
    return { kind: 'DIRECT' };
  }
  return {
    kind: 'COURIER',
    courierWillAccept: COURIER_EDITABLE_SHIPMENT_STATUSES.has(input.liveShipment.status),
    reason: courierReason(input.liveShipment.status),
  };
}
