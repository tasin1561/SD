/**
 * The courier-support surface, as a contract.
 *
 * ── WHY AN INTERFACE BEFORE THERE IS AN IMPLEMENTATION ───────────────
 * There is NO ticket write channel today. Delhivery One MCP is read-only
 * ("write and update operations will be available in a future release"),
 * the Express REST API has no ticketing endpoint, and their notification
 * emails do not accept replies. So every write currently goes to a human
 * in the ops console.
 *
 * Delhivery has said MCP writes are coming. When they land, the whole
 * point of this file is that switching over is ONE implementation
 * swapped behind this interface — the outbox, the routing, the
 * reconciler, the console and the audit trail do not move. Designing the
 * pipeline directly against "a human does it" would bake the human in,
 * and the migration would then be a rewrite rather than a channel.
 *
 * ── capabilities() IS LOAD-BEARING, NOT DOCUMENTATION ────────────────
 * The router asks it what is actually possible. With every write
 * unsupported, AUTO mode cannot execute anything and items route to the
 * ops queue no matter what the mode says — which is the correct
 * behaviour and, importantly, not a special case anyone has to remember.
 * Turning a capability on is how a channel goes live.
 */

export interface CapabilityFlags {
  /** Read a thread. MCP will do this first. */
  readonly getThread: boolean;
  /** Post a comment onto an existing ticket. */
  readonly postComment: boolean;
  /** Create a ticket. */
  readonly raiseTicket: boolean;
  /** Enumerate tickets changed since a timestamp — the reconciler's read. */
  readonly listUpdatedSince: boolean;
  /** Fetch the category/subcategory taxonomy, keyed on stable IDs. */
  readonly getTaxonomy: boolean;
}

export interface IssueCategory {
  /** Delhivery's ID. The ONLY thing we key on — labels get re-worded. */
  readonly id: string;
  readonly label: string;
  readonly parentId: string | null;
  /** Whether it can be filed for the shipment state we asked about. */
  readonly eligible: boolean;
}

export interface CourierThreadMessage {
  readonly externalMessageId: string | null;
  /** VERBATIM. */
  readonly body: string;
  readonly occurredAt: Date;
  readonly fromCourier: boolean;
}

export interface TicketRef {
  readonly kind: 'TICKET';
  readonly externalTicketId: string;
}
/** Their dedup fired — roughly per (awb, category). NOT an error. */
export interface AlreadyExists {
  readonly kind: 'ALREADY_EXISTS';
  readonly externalTicketId: string | null;
}
/** The category is not available for this shipment's state. NOT an error. */
export interface NotEligible {
  readonly kind: 'NOT_ELIGIBLE';
  readonly reason: string;
}
/** Creation is async and landed in their Tasks list. NOT an error. */
export interface TaskPending {
  readonly kind: 'TASK_PENDING';
  readonly taskRef: string | null;
}

export type RaiseTicketOutcome = TicketRef | AlreadyExists | NotEligible | TaskPending;

export interface RaiseTicketRequest {
  readonly awbNumber: string;
  readonly categoryId: string;
  /** VERBATIM seller text. */
  readonly body: string;
}

/**
 * Thrown when a capability is called that `capabilities()` reports off.
 *
 * A distinct type because the router must be able to tell "this channel
 * cannot do this" (route to a human, entirely normal) from "this channel
 * tried and something went wrong" (an error class, a retry decision, an
 * alert). Collapsing them would make an unbuilt feature look like an
 * outage every time it was reached.
 */
export class CourierCapabilityUnsupportedError extends Error {
  constructor(public readonly capability: keyof CapabilityFlags) {
    super(`Courier capability '${capability}' is not supported by this channel`);
    this.name = 'CourierCapabilityUnsupportedError';
  }
}

export interface CourierSupportAdapter {
  readonly courierCode: string;
  capabilities(): CapabilityFlags;

  getTaxonomy(ctx?: { awb: string }): Promise<readonly IssueCategory[]>;
  raiseTicket(req: RaiseTicketRequest): Promise<RaiseTicketOutcome>;
  getThread(externalTicketId: string): Promise<readonly CourierThreadMessage[]>;
  postComment(externalTicketId: string, body: string): Promise<void>;
  listUpdatedSince(since: Date): Promise<readonly { externalTicketId: string; updatedAt: Date }[]>;
}
