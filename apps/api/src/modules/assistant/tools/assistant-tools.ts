import { Currency, SellerCapability } from '@skydrop/db';
import type { OrderAssistantReadService } from '../../order/services/order-assistant-read.service';
import type { SellerTrackingService } from '../../seller-tracking/services/seller-tracking.service';
import type { SellerRestrictionService } from '../../seller-restriction/services/seller-restriction.service';
import type { WalletService } from '../../seller-wallet/services/wallet.service';
import type {
  StoreOrderViewer,
  StoreOrdersService,
} from '../../reseller-order/services/store-orders.service';
import type { AdminCallQueueService } from '../../call-center/services/admin-call-queue.service';
import type { AssistantHelpService } from '../services/assistant-help.service';
import type { AssistantStoreService } from '../services/assistant-store.service';
import type { OrderChargesAssistantReadService } from '../../order-charges/services/order-charges-assistant-read.service';
import type { SellerWalletAssistantReadService } from '../../seller-wallet/services/seller-wallet-assistant-read.service';
import type { SellerStockAssistantReadService } from '../../inventory-stock/services/seller-stock-assistant-read.service';
import type { ConsignmentAssistantReadService } from '../../consignment/services/consignment-assistant-read.service';
import type { OrderJourneyAssistantReadService } from '../../order-journey/services/order-journey-assistant-read.service';
import type { TicketAssistantReadService } from '../../ticket/services/ticket-assistant-read.service';
import type { AddressCheckAssistantReadService } from '../../address-check/services/address-check-assistant-read.service';
import {
  OPS_GROUPINGS,
  OPS_METRICS,
  OpsMetricsInputError,
  type OpsGrouping,
  type OpsMetric,
  type ReportsAssistantReadService,
} from '../../admin-reports/services/reports-assistant-read.service';
import { ToolError, type AssistantTool, type CallerScope } from '../assistant.types';

/**
 * THE READ-ONLY TOOLS (phase A).
 *
 * Every rule that keeps a user inside their own data is structural here:
 *
 *   1. No input schema names an owner. The model supplies an order
 *      number or a search word — never a seller, store, staff, store-user
 *      or associate id (`assistant-tool-schemas.spec.ts`).
 *   2. Every handler takes its tenant from `scope`, which the controller
 *      built from the authenticated identity, and passes it to the SAME
 *      service the HTTP route calls — so the WHERE clause is the route's
 *      own. A number belonging to somebody else matches nothing and the
 *      tool answers NOT_FOUND, indistinguishable from "does not exist".
 *   3. Each tool carries the permission key of the route it mirrors
 *      (`assistant-tool-permission-parity.spec.ts`), and the registry
 *      offers it only to callers who hold it.
 *   4. Results are PROJECTIONS: no phone numbers, e-mails or street
 *      addresses; for a store or an associate, none of the store's costs.
 *
 * There is no tool that changes anything of the caller's. The one tool that
 * stores a row, `propose_ticket`, stores a PROPOSAL in the assistant's own
 * table and returns; the ticket is raised by the person pressing a button,
 * through `AssistantTicketService`, which no tool can reach (the
 * `assistant-ticket-confirmation.spec.ts` structural spec pins that).
 * Adding any other write is a different review.
 */
export interface AssistantToolDeps {
  readonly orders: Pick<
    OrderAssistantReadService,
    'listForSeller' | 'findForSeller' | 'findForStaff' | 'resolveForSeller' | 'resolveForStaff'
  >;
  readonly tracking: Pick<SellerTrackingService, 'list' | 'detail'>;
  readonly restrictions: Pick<SellerRestrictionService, 'assertAllowed'>;
  readonly wallet: Pick<WalletService, 'balanceCached'>;
  readonly storeOrders: Pick<StoreOrdersService, 'list' | 'detail'>;
  readonly callQueue: Pick<AdminCallQueueService, 'stats'>;
  readonly help: Pick<AssistantHelpService, 'search' | 'explainError' | 'findPage'>;
  /** Where a ticket PROPOSAL is stored. Nothing here can raise a ticket. */
  readonly proposals: Pick<AssistantStoreService, 'createProposal'>;
  // ── Batch B: read-only lookups. Each is a `*-assistant-read.service` that
  // owns its module's projection; none of them can write.
  readonly charges: Pick<OrderChargesAssistantReadService, 'forSeller'>;
  readonly walletEntries: Pick<SellerWalletAssistantReadService, 'entriesForOrder'>;
  readonly stock: Pick<SellerStockAssistantReadService, 'forSeller'>;
  readonly consignments: Pick<ConsignmentAssistantReadService, 'forSeller'>;
  readonly journeys: Pick<OrderJourneyAssistantReadService, 'forOrder'>;
  readonly ticketReads: Pick<TicketAssistantReadService, 'forSeller' | 'forStore'>;
  readonly addressChecks: Pick<AddressCheckAssistantReadService, 'forOrder'>;
  readonly metrics: Pick<ReportsAssistantReadService, 'run'>;
}

const NOT_YOURS = 'No order of yours matches that number.';
const NOT_YOURS_STORE = 'No order of this store matches that number.';
const NOT_YOUR_TICKET = 'No ticket of yours matches that number.';

function sellerId(scope: CallerScope): string {
  if (scope.sellerId === null)
    throw new ToolError('FORBIDDEN', 'No client account in this session.');
  return scope.sellerId;
}

function store(scope: CallerScope): { storeId: string; viewer: StoreOrderViewer } {
  if (scope.storeId === null || scope.orderScope === null) {
    throw new ToolError('FORBIDDEN', 'No store in this session.');
  }
  return {
    storeId: scope.storeId,
    viewer: { kind: 'STORE_USER', storeUserId: scope.userId, scope: scope.orderScope },
  };
}

const IDENTIFIER = {
  type: 'string',
  description:
    'The order number (for example SD-2026-000123), your own order reference, or the AWB waybill number.',
  minLength: 3,
  maxLength: 64,
} as const;

const TICKET_NUMBER = {
  type: 'string',
  description: 'The ticket number, for example TK-2026-000003.',
  minLength: 3,
  maxLength: 40,
} as const;

const LIMIT = {
  type: 'integer',
  description: 'How many to return (1 to 10). Defaults to 5.',
  minimum: 1,
  maximum: 10,
} as const;

function limitOf(input: Record<string, unknown>): number {
  return typeof input.limit === 'number' ? input.limit : 5;
}

export function buildAssistantTools(deps: AssistantToolDeps): readonly AssistantTool[] {
  const PROPOSED =
    'PROPOSED ONLY. Nothing has been raised and no ticket exists. A card with a "Raise this ticket" button is now shown to the person; the ticket exists only if they press it. Tell them to press the button, and never say or imply that the ticket was raised.';

  /**
   * `propose_ticket`: the model's whole part in raising a ticket. It stores a
   * proposal (the words, plus the order IF one of the CALLER's matches the
   * number) and shows a card. It cannot create a ticket: it holds no ticket
   * service, and the confirm endpoint is a human HTTP route.
   */
  const proposeTicketTool = (opts: {
    readonly audience: AssistantTool['audience'];
    readonly permission: string;
    readonly mirrors: NonNullable<AssistantTool['mirrors']>;
    readonly resolveOrder: (
      scope: CallerScope,
      identifier: string,
    ) => Promise<{ id: string; orderNumber: string } | null>;
    readonly orderRequired: boolean;
  }): AssistantTool => ({
    name: 'propose_ticket',
    description:
      'Offer to raise a support ticket for the person. Use it ONLY when they want help from a person, or you looked and cannot solve it. It does NOT raise anything: it shows the person a card with a "Raise this ticket" button, and the ticket exists only if they press it. Write the subject and description in the person\'s own words and language. Never say a ticket was raised.',
    audience: opts.audience,
    permission: opts.permission,
    mirrors: opts.mirrors,
    inputSchema: {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          description: 'A short title for the ticket, at most 120 characters.',
          minLength: 3,
          maxLength: 120,
        },
        description: {
          type: 'string',
          description:
            'What went wrong and what the person needs, in a few sentences, at most 2000 characters. No phone numbers or addresses.',
          minLength: 10,
          maxLength: 2000,
        },
        orderNumber: {
          type: 'string',
          description: opts.orderRequired
            ? 'The order number this is about (for example SD-2026-000123). Required.'
            : 'The order number this is about, if there is one (for example SD-2026-000123).',
          minLength: 3,
          maxLength: 64,
        },
      },
      required: opts.orderRequired
        ? ['subject', 'description', 'orderNumber']
        : ['subject', 'description'],
      additionalProperties: false,
    },
    async run(scope, input, ctx) {
      const subject = String(input.subject);
      const description = String(input.description);
      const wanted = typeof input.orderNumber === 'string' ? input.orderNumber : null;
      // Resolved INSIDE the caller's scope, here, never from the model's text:
      // a number that is somebody else's matches nothing, exactly like one
      // that does not exist, and the proposal then carries no order.
      const order = wanted === null ? null : await opts.resolveOrder(scope, wanted);
      if (opts.orderRequired && order === null) {
        throw new ToolError('NOT_FOUND', NOT_YOURS_STORE);
      }
      const stored = await deps.proposals.createProposal(scope, ctx.conversationId, {
        subject,
        description,
        orderId: order?.id ?? null,
        orderNumber: order?.orderNumber ?? null,
      });
      if (stored === null) {
        throw new ToolError(
          'FAILED',
          'Several tickets are already waiting for the person to confirm. Do not propose another.',
        );
      }
      if (stored.created) {
        ctx.emit({
          type: 'ticket_proposal',
          id: stored.proposal.id,
          subject: stored.proposal.subject,
          description: stored.proposal.description,
          orderNumber: stored.proposal.orderNumber,
        });
      }
      return { status: 'proposed', note: PROPOSED };
    },
  });

  const tools: AssistantTool[] = [
    // ── seller ───────────────────────────────────────────────────────
    {
      name: 'get_my_order',
      description:
        "Look up one of the client's own orders by order number, their own reference, or AWB waybill. Returns status, payment mode, COD amount, the customer's name and city, the items and the courier. Use this for any 'where is order X' or 'what is the status of X' question.",
      audience: ['SELLER'],
      permission: 'orders.view',
      mirrors: { controller: 'order/controllers/seller-order.controller.ts', handler: 'get' },
      inputSchema: {
        type: 'object',
        properties: { identifier: IDENTIFIER },
        required: ['identifier'],
        additionalProperties: false,
      },
      async run(scope, input) {
        const found = await deps.orders.findForSeller(sellerId(scope), String(input.identifier));
        if (found === null) throw new ToolError('NOT_FOUND', NOT_YOURS);
        return found;
      },
    },
    {
      name: 'list_my_recent_orders',
      description:
        "List the client's most recent orders, newest first, with status and customer city.",
      audience: ['SELLER'],
      permission: 'orders.view',
      mirrors: { controller: 'order/controllers/seller-order.controller.ts', handler: 'list' },
      inputSchema: {
        type: 'object',
        properties: { limit: LIMIT },
        required: [],
        additionalProperties: false,
      },
      async run(scope, input) {
        return { orders: await deps.orders.listForSeller(sellerId(scope), limitOf(input)) };
      },
    },
    {
      name: 'get_my_wallet_summary',
      description:
        "The client's current wallet balance in rupees. Read-only: it cannot move money, request a withdrawal or change anything.",
      audience: ['SELLER'],
      permission: 'wallet.view',
      mirrors: {
        controller: 'seller-wallet-read/seller-wallet.controller.ts',
        handler: 'balances',
      },
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      async run(scope) {
        const balance = await deps.wallet.balanceCached(sellerId(scope), Currency.INR);
        return { currency: 'INR', balanceInr: balance.toFixed(2) };
      },
    },
    {
      name: 'track_my_shipment',
      description:
        "Where one of the client's parcels is: current status, the latest scans with place and time, and failed delivery attempts with the courier's reason. Identify the parcel by AWB waybill number or shipment number.",
      audience: ['SELLER'],
      permission: 'orders.view',
      mirrors: {
        controller: 'seller-tracking/controllers/seller-tracking.controller.ts',
        handler: 'detail',
      },
      inputSchema: {
        type: 'object',
        properties: {
          identifier: {
            type: 'string',
            description: 'The AWB waybill number or the shipment number.',
            minLength: 3,
            maxLength: 64,
          },
        },
        required: ['identifier'],
        additionalProperties: false,
      },
      async run(scope, input) {
        const id = sellerId(scope);
        const wanted = String(input.identifier).toLowerCase();
        // The route asks the restriction service first; so do we.
        try {
          await deps.restrictions.assertAllowed(id, SellerCapability.TRACKING_VIEW);
        } catch {
          throw new ToolError('FORBIDDEN', 'Tracking is switched off for this account.');
        }
        const rows = await deps.tracking.list(id, { search: String(input.identifier), limit: 10 });
        const hit = rows.find(
          (r) =>
            (r.awbNumber ?? '').toLowerCase() === wanted ||
            r.shipmentNumber.toLowerCase() === wanted,
        );
        if (hit === undefined)
          throw new ToolError('NOT_FOUND', 'No parcel of yours matches that number.');
        const d = await deps.tracking.detail(id, hit.shipmentId);
        return {
          awbNumber: d.awbNumber,
          shipmentNumber: d.shipmentNumber,
          orderNumber: d.orderNumber,
          courier: d.manualCourierName ?? d.courierCode,
          status: d.status,
          recipientCity: d.recipientCity,
          failedAttempts: d.failedAttempts,
          latestScans: d.events.slice(0, 8).map((e) => ({
            at: e.eventAt.toISOString(),
            status: e.status,
            description: e.description,
            location: e.location,
          })),
          deliveryAttempts: d.attempts.slice(0, 5).map((a) => ({
            attemptNumber: a.attemptNumber,
            at: a.attemptedAt.toISOString(),
            outcome: a.outcome,
            failureReason: a.failureReason,
          })),
        };
      },
    },

    // ── store + associate (ASSOC-1: the viewer narrows an associate to OWN) ──
    {
      name: 'get_my_store_order',
      description:
        "Look up one order of this store by order number, reference or AWB waybill. Returns status, payment mode, COD amount, the customer's name and city, items and the courier. A person who sells for the store sees only the orders they placed.",
      audience: ['STORE', 'ASSOCIATE'],
      permission: 'orders.view',
      mirrors: {
        controller: 'reseller-order/controllers/store-order.controller.ts',
        handler: 'get',
      },
      inputSchema: {
        type: 'object',
        properties: { identifier: IDENTIFIER },
        required: ['identifier'],
        additionalProperties: false,
      },
      async run(scope, input) {
        const { storeId, viewer } = store(scope);
        const wanted = String(input.identifier).toLowerCase();
        const page = await deps.storeOrders.list(storeId, viewer, {
          page: 1,
          pageSize: 5,
          search: String(input.identifier),
        });
        for (const row of page.items) {
          const view = await deps.storeOrders.detail(storeId, viewer, row.id);
          const awbs = view.shipments.map((s) => (s.awbNumber ?? '').toLowerCase());
          if (
            view.orderNumber.toLowerCase() === wanted ||
            (view.sellerOrderRef ?? '').toLowerCase() === wanted ||
            awbs.includes(wanted)
          ) {
            // An explicit projection: NOTHING from `totals`, `lines[].cost`,
            // fees, discounts or terms is copied, so the store's costs
            // cannot reach an associate (or the transcript) by this route.
            return {
              orderNumber: view.orderNumber,
              sellerOrderRef: view.sellerOrderRef,
              status: view.status,
              placedAt: view.placedAt,
              confirmedAt: view.confirmedAt,
              cancelledAt: view.cancelledAt,
              paymentMode: view.paymentMode,
              codAmountInr: view.codAmountInr,
              recipient: {
                name: view.recipient.name,
                city: view.recipient.city,
                state: view.recipient.stateProvince,
                postalCode: view.recipient.postalCode,
              },
              items: view.lines.map((l) => ({
                sku: l.skuCode,
                name: l.productName,
                quantity: l.quantity,
              })),
              shipments: view.shipments.map((s) => ({
                awbNumber: s.awbNumber,
                courier: s.courierCode,
                status: s.status,
              })),
            };
          }
        }
        throw new ToolError('NOT_FOUND', 'No order of this store matches that number.');
      },
    },
    {
      name: 'list_my_store_orders',
      description:
        "List this store's most recent orders, newest first. A person who sells for the store sees only the orders they placed.",
      audience: ['STORE', 'ASSOCIATE'],
      permission: 'orders.view',
      mirrors: {
        controller: 'reseller-order/controllers/store-order.controller.ts',
        handler: 'list',
      },
      inputSchema: {
        type: 'object',
        properties: { limit: LIMIT },
        required: [],
        additionalProperties: false,
      },
      async run(scope, input) {
        const { storeId, viewer } = store(scope);
        const page = await deps.storeOrders.list(storeId, viewer, {
          page: 1,
          pageSize: limitOf(input),
        });
        return {
          orders: page.items.map((o) => ({
            orderNumber: o.orderNumber,
            status: o.status,
            placedAt: o.placedAt,
            customerName: o.recipientName,
            city: o.recipientCity,
            paymentMode: o.paymentMode,
            codAmountInr: o.codAmountInr,
            itemCount: o.itemCount,
          })),
        };
      },
    },

    // ── staff ────────────────────────────────────────────────────────
    {
      name: 'get_order',
      description:
        "Look up any order by order number, the client's own reference, or AWB waybill. Returns status, payment mode, COD amount, customer name and city, items and courier.",
      audience: ['STAFF'],
      permission: 'orders.view',
      mirrors: { controller: 'order/controllers/admin-order.controller.ts', handler: 'get' },
      inputSchema: {
        type: 'object',
        properties: { identifier: IDENTIFIER },
        required: ['identifier'],
        additionalProperties: false,
      },
      async run(_scope, input) {
        const found = await deps.orders.findForStaff(String(input.identifier));
        if (found === null) throw new ToolError('NOT_FOUND', 'No order matches that number.');
        return found;
      },
    },
    {
      name: 'get_ops_queue_counts',
      description:
        'How many calls are waiting in the call-centre confirmation queue, by status. Counts only.',
      audience: ['STAFF'],
      permission: 'callcenter.queue.view',
      mirrors: {
        controller: 'call-center/controllers/admin-call-queue.controller.ts',
        handler: 'stats',
      },
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      async run() {
        const s = await deps.callQueue.stats();
        return {
          openCalls: s.openTotal,
          byStatus: s.byStatus,
          agentsWithAssignedCalls: s.assignedByAgent.length,
        };
      },
    },

    // ── Batch B: seller lookups ──────────────────────────────────────
    {
      name: 'explain_my_order_charges',
      description:
        'Explain what the client was charged for ONE of their orders: every stored charge line with its state (Estimated, Final ...), the fee as AGREED (for example 200 BDT) and the exchange rate it was converted at, and the wallet entries linked to that order. It only READS what was stored when the charge was taken. Never work out, add up or estimate a charge yourself: read out what this returns, in rupees, and say the order has no charges yet if the list is empty.',
      audience: ['SELLER'],
      permission: 'charges.view',
      mirrors: {
        controller: 'order-charges/controllers/seller-order-charges.controller.ts',
        handler: 'list',
      },
      inputSchema: {
        type: 'object',
        properties: { identifier: IDENTIFIER },
        required: ['identifier'],
        additionalProperties: false,
      },
      async run(scope, input) {
        const id = sellerId(scope);
        // Resolved INSIDE the caller's scope; the model never supplies an id.
        const order = await deps.orders.resolveForSeller(id, String(input.identifier));
        if (order === null) throw new ToolError('NOT_FOUND', NOT_YOURS);
        const charges = await deps.charges.forSeller(id, order.id);
        if (charges === null) throw new ToolError('NOT_FOUND', NOT_YOURS);
        // The ledger half is the wallet page's data, so it needs the wallet page's key.
        const walletEntries = scope.permissions.includes('wallet.view')
          ? await deps.walletEntries.entriesForOrder(id, order.id)
          : null;
        return {
          ...charges,
          walletEntries,
          ...(walletEntries === null
            ? { walletNote: 'Wallet entries are not shown to this team member.' }
            : {}),
        };
      },
    },
    {
      name: 'get_my_stock',
      description:
        "How many units of one SKU the client has: on hand, held for unshipped orders, available to sell right now, and still in transit (in Bangladesh or on the way, not sellable yet). Identify it by the client's own SKU code.",
      audience: ['SELLER'],
      permission: 'inventory.view',
      mirrors: { controller: 'inventory-stock/seller-stock.controller.ts', handler: 'byVariant' },
      inputSchema: {
        type: 'object',
        properties: {
          sku: {
            type: 'string',
            description: "The client's own SKU code, exactly as written in their catalogue.",
            minLength: 1,
            maxLength: 64,
          },
        },
        required: ['sku'],
        additionalProperties: false,
      },
      async run(scope, input) {
        const found = await deps.stock.forSeller(sellerId(scope), String(input.sku));
        if (found === null) throw new ToolError('NOT_FOUND', 'No SKU of yours matches that code.');
        return found;
      },
    },
    {
      name: 'get_my_consignment',
      description:
        "Where one of the client's inbound consignments (stock sent to Skydrop's warehouses) stands: its status and each leg - the Dhaka intake and the India arrival - with what was expected, received and damaged per SKU. Identify it by consignment number.",
      audience: ['SELLER'],
      permission: 'inbound.view',
      mirrors: {
        controller: 'consignment/controllers/seller-consignment.controller.ts',
        handler: 'get',
      },
      inputSchema: {
        type: 'object',
        properties: {
          number: {
            type: 'string',
            description: 'The consignment number, as printed on the Inbound page.',
            minLength: 3,
            maxLength: 40,
          },
        },
        required: ['number'],
        additionalProperties: false,
      },
      async run(scope, input) {
        const found = await deps.consignments.forSeller(sellerId(scope), String(input.number));
        if (found === null) {
          throw new ToolError('NOT_FOUND', 'No consignment of yours matches that number.');
        }
        return found;
      },
    },
    {
      name: 'get_failed_delivery_detail',
      description:
        "Why a delivery failed and what happens next, for one of the client's orders: each failed attempt with the courier's reason and its plain meaning, whether the courier accepts another attempt, and the next attempt date. Identify the order by order number, own reference or AWB.",
      audience: ['SELLER'],
      permission: 'orders.view',
      mirrors: {
        controller: 'order-journey/controllers/seller-order-journey.controller.ts',
        handler: 'forOrder',
      },
      inputSchema: {
        type: 'object',
        properties: { identifier: IDENTIFIER },
        required: ['identifier'],
        additionalProperties: false,
      },
      async run(scope, input) {
        const id = sellerId(scope);
        const order = await deps.orders.resolveForSeller(id, String(input.identifier));
        if (order === null) throw new ToolError('NOT_FOUND', NOT_YOURS);
        const detail = await deps.journeys.forOrder(order.id, id);
        if (detail === null) throw new ToolError('NOT_FOUND', NOT_YOURS);
        return detail;
      },
    },
    {
      name: 'get_my_ticket',
      description:
        "Where one of the client's support tickets stands: status, subject, the linked order, when it was opened, when anybody last wrote on it and when Skydrop staff last replied. Identify it by ticket number (for example TK-2026-000003).",
      audience: ['SELLER'],
      permission: 'tickets.view',
      mirrors: { controller: 'ticket/controllers/seller-ticket.controller.ts', handler: 'detail' },
      inputSchema: {
        type: 'object',
        properties: { number: TICKET_NUMBER },
        required: ['number'],
        additionalProperties: false,
      },
      async run(scope, input) {
        const found = await deps.ticketReads.forSeller(sellerId(scope), String(input.number));
        if (found === null) throw new ToolError('NOT_FOUND', NOT_YOUR_TICKET);
        return found;
      },
    },

    // ── Batch B: store + associate (ASSOC-1: the viewer narrows an associate to OWN) ──
    {
      name: 'get_my_ticket',
      description:
        "Where one of this store's issues or disputes stands: status, subject, the linked order, when it was opened, when anybody last wrote on it and when Skydrop staff last replied. Identify it by ticket number. A person who sells for the store sees only the tickets about orders they placed.",
      audience: ['STORE', 'ASSOCIATE'],
      permission: 'tickets.view',
      mirrors: { controller: 'ticket/controllers/store-ticket.controller.ts', handler: 'get' },
      inputSchema: {
        type: 'object',
        properties: { number: TICKET_NUMBER },
        required: ['number'],
        additionalProperties: false,
      },
      async run(scope, input) {
        if (scope.storeId === null || scope.orderScope === null) {
          throw new ToolError('FORBIDDEN', 'No store in this session.');
        }
        const found = await deps.ticketReads.forStore(
          scope.storeId,
          { storeUserId: scope.userId, orderScope: scope.orderScope },
          String(input.number),
        );
        if (found === null) throw new ToolError('NOT_FOUND', NOT_YOUR_TICKET);
        return found;
      },
    },

    // ── Batch B: staff ───────────────────────────────────────────────
    {
      name: 'get_failed_delivery_detail',
      description:
        "Why a delivery failed and what happens next, for any order: each failed attempt with the courier's reason and its plain meaning, whether the courier accepts another attempt, and the next attempt date. Identify the order by order number, the client's own reference or AWB.",
      audience: ['STAFF'],
      permission: 'orders.view',
      mirrors: {
        controller: 'order-journey/controllers/admin-order-journey.controller.ts',
        handler: 'forOrder',
      },
      inputSchema: {
        type: 'object',
        properties: { identifier: IDENTIFIER },
        required: ['identifier'],
        additionalProperties: false,
      },
      async run(_scope, input) {
        const order = await deps.orders.resolveForStaff(String(input.identifier));
        if (order === null) throw new ToolError('NOT_FOUND', 'No order matches that number.');
        const detail = await deps.journeys.forOrder(order.id, null);
        if (detail === null) throw new ToolError('NOT_FOUND', 'No order matches that number.');
        return detail;
      },
    },
    {
      name: 'explain_address_check',
      description:
        "Explain an order's address-check result in plain words for a call-centre agent: the score, what the checker recommends, each issue it found, which part of the address it could improve, and what to ask the customer. It never returns the address itself. Identify the order by order number, the client's own reference or AWB.",
      audience: ['STAFF'],
      permission: 'callcenter.work',
      mirrors: {
        controller: 'address-check/controllers/admin-address-check.controller.ts',
        handler: 'get',
      },
      inputSchema: {
        type: 'object',
        properties: { identifier: IDENTIFIER },
        required: ['identifier'],
        additionalProperties: false,
      },
      async run(_scope, input) {
        const order = await deps.orders.resolveForStaff(String(input.identifier));
        if (order === null) throw new ToolError('NOT_FOUND', 'No order matches that number.');
        const check = await deps.addressChecks.forOrder(order.id);
        if (check === null) {
          throw new ToolError('NOT_FOUND', 'This order has no address check.');
        }
        return {
          orderNumber: order.orderNumber,
          ...check,
          note: 'Explain the issues in short plain words. A low score means the checker is unsure the address is complete; it does not mean the customer is lying.',
        };
      },
    },
    {
      name: 'draft_confirmation_call_script',
      description:
        "Get the facts for a short confirmation-call script for one order: the customer's name, the items, the cash to collect and the city. Then WRITE the script yourself, in the language the agent asked for (English, Hindi or Bangla): greet, say who is calling and from where, read back the items, say the amount to pay on delivery, ask them to confirm the order and the delivery address. Use only the facts returned; never invent a price or a promise, and never include a phone number.",
      audience: ['STAFF'],
      permission: 'callcenter.work',
      mirrors: {
        controller: 'call-center/controllers/agent-call.controller.ts',
        handler: 'current',
      },
      inputSchema: {
        type: 'object',
        properties: {
          identifier: IDENTIFIER,
          language: {
            type: 'string',
            description: 'The language the script is written in.',
            enum: ['English', 'Hindi', 'Bangla'],
          },
        },
        required: ['identifier', 'language'],
        additionalProperties: false,
      },
      async run(_scope, input) {
        const found = await deps.orders.findForStaff(String(input.identifier));
        if (found === null) throw new ToolError('NOT_FOUND', 'No order matches that number.');
        return {
          language: String(input.language),
          orderNumber: found.orderNumber,
          customerName: found.recipient.name,
          city: found.recipient.city,
          items: found.items ?? [],
          paymentMode: found.paymentMode,
          codAmountInr: found.codAmountInr,
          instruction:
            found.paymentMode === 'COD'
              ? 'Say the exact cash amount to pay on delivery.'
              : 'This order is prepaid: say nothing is to be paid on delivery.',
        };
      },
    },
    {
      name: 'ops_metrics',
      description:
        'A few operations numbers for a date range: orders created, delivered, returned (RTO), failed (rejected after repeated failed delivery) or COD collected in rupees, as one total or split by day, client or courier. Dates are written YYYY-MM-DD and both ends are included; at most 92 days. These are the same figures the Reports page shows. Splitting by courier counts parcels and works only for delivered and returned.',
      audience: ['STAFF'],
      permission: 'reports.view',
      mirrors: { controller: 'admin-reports/admin-reports.controller.ts', handler: 'summary' },
      inputSchema: {
        type: 'object',
        properties: {
          metric: {
            type: 'string',
            description: 'Which number.',
            enum: OPS_METRICS,
          },
          from: {
            type: 'string',
            description: 'First day, YYYY-MM-DD.',
            minLength: 10,
            maxLength: 10,
            pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          },
          to: {
            type: 'string',
            description: 'Last day, YYYY-MM-DD (included).',
            minLength: 10,
            maxLength: 10,
            pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          },
          groupBy: {
            type: 'string',
            description: 'How to split the number: none for one total.',
            enum: OPS_GROUPINGS,
          },
        },
        required: ['metric', 'from', 'to', 'groupBy'],
        additionalProperties: false,
      },
      async run(_scope, input) {
        try {
          return await deps.metrics.run({
            metric: String(input.metric) as OpsMetric,
            from: String(input.from),
            to: String(input.to),
            groupBy: String(input.groupBy) as OpsGrouping,
          });
        } catch (e) {
          if (e instanceof OpsMetricsInputError) throw new ToolError('INVALID_INPUT', e.message);
          throw e;
        }
      },
    },

    // ── raise a ticket: PROPOSE only (seller, store, associate) ───────
    proposeTicketTool({
      audience: ['SELLER'],
      permission: 'tickets.create',
      mirrors: { controller: 'ticket/controllers/seller-ticket.controller.ts', handler: 'create' },
      async resolveOrder(scope, identifier) {
        return deps.orders.resolveForSeller(sellerId(scope), identifier);
      },
      orderRequired: false,
    }),
    proposeTicketTool({
      audience: ['STORE', 'ASSOCIATE'],
      permission: 'tickets.manage',
      mirrors: { controller: 'ticket/controllers/store-issue.controller.ts', handler: 'create' },
      async resolveOrder(scope, identifier) {
        const { storeId, viewer } = store(scope);
        const wanted = identifier.toLowerCase();
        // The same scoped search the order tool uses: an associate's list is
        // already narrowed to the orders they placed.
        const page = await deps.storeOrders.list(storeId, viewer, {
          page: 1,
          pageSize: 5,
          search: identifier,
        });
        for (const row of page.items) {
          const view = await deps.storeOrders.detail(storeId, viewer, row.id);
          const awbs = view.shipments.map((s) => (s.awbNumber ?? '').toLowerCase());
          if (
            view.orderNumber.toLowerCase() === wanted ||
            (view.sellerOrderRef ?? '').toLowerCase() === wanted ||
            awbs.includes(wanted)
          ) {
            return { id: row.id, orderNumber: view.orderNumber };
          }
        }
        return null;
      },
      // A member store raises an issue ABOUT one of its orders; the console's
      // own form cannot be submitted without one.
      orderRequired: true,
    }),

    // ── every audience ───────────────────────────────────────────────
    {
      name: 'search_help',
      description:
        'Search the knowledge base for this console: step-by-step workflow guides, plain definitions of terms (AWB, NDR, RTO, COD ...) and the console\'s own help text. Returns up to 5 short passages. Use it for any "how do I", "what does X mean" or "what happens next" question before answering. The knowledge is in English: send English keywords whatever language the person wrote in.',
      audience: ['STAFF', 'SELLER', 'STORE', 'ASSOCIATE'],
      permission: null,
      mirrors: null,
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'A few English keywords, for example "withdraw money", "failed delivery" or "address check score".',
            minLength: 2,
            maxLength: 120,
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      async run(scope, input) {
        const hits = deps.help.search(scope.audience, String(input.query));
        if (hits.length === 0) {
          return {
            results: [],
            note: 'Nothing found. Say you are not sure and suggest raising a support ticket.',
          };
        }
        return { results: hits };
      },
    },
    {
      name: 'explain_error',
      description:
        'Explain an error code the person saw, such as PACK_VERIFICATION_REQUIRED (shown on screen as [CODE] message). Returns what it means, the area of the product it belongs to, and matching workflow guides. Call this FIRST when the page context shows a last error or the person pastes a [CODE]. Then use search_help for the steps to fix it.',
      audience: ['STAFF', 'SELLER', 'STORE', 'ASSOCIATE'],
      permission: null,
      mirrors: null,
      inputSchema: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description:
              'The error code only, in capitals with underscores, for example ORDER_NOT_FOUND. No brackets.',
            minLength: 3,
            maxLength: 80,
            pattern: '^[A-Z][A-Z0-9_]{2,}$',
          },
        },
        required: ['code'],
        additionalProperties: false,
      },
      async run(scope, input) {
        return deps.help.explainError(scope.audience, String(input.code));
      },
    },
    {
      name: 'find_page',
      description:
        'Find the page of THIS console where something is done, and get its link. Returns up to 5 pages the person is allowed to open, each with a route such as /orders. Use it whenever your answer mentions a page or a step done in the app, then write the route as a markdown link, for example [Orders](/orders). Never write a route this tool did not return.',
      audience: ['STAFF', 'SELLER', 'STORE', 'ASSOCIATE'],
      permission: null,
      mirrors: null,
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'English keywords for the page, for example "orders", "wallet withdraw", "call queue" or "tickets".',
            minLength: 2,
            maxLength: 80,
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      async run(scope, input) {
        const pages = deps.help.findPage(scope.audience, scope.permissions, String(input.query));
        if (pages.length === 0) {
          return {
            pages: [],
            note: 'No page you can open matches. Describe where to look without a link, or suggest raising a support ticket.',
          };
        }
        return { pages };
      },
    },
  ];
  return tools;
}
