import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, TicketType } from '@skydrop/db';
import { SellerIssueEscalationService } from '../../courier-escalation/services/seller-issue-escalation.service';
import { StoreIssueService } from '../../ticket/services/store-issue.service';
import { TicketService } from '../../ticket/services/ticket.service';
import type { CallerScope } from '../assistant.types';
import { AssistantStoreService, type ProposalRow } from './assistant-store.service';

/** What the browser is shown of a proposal. */
export interface ProposalView {
  readonly id: string;
  readonly subject: string;
  readonly description: string;
  readonly orderNumber: string | null;
  readonly status: 'PENDING' | 'CONFIRMED' | 'DISMISSED';
  /** Set once the ticket exists. The card links to `/tickets/<ticketId>`. */
  readonly ticketId: string | null;
  readonly ticketNumber: string | null;
  /** True when a member store's issue is waiting for the client to approve it. */
  readonly held: boolean;
  readonly createdAt: string;
}

export function toProposalView(p: ProposalRow): ProposalView {
  return {
    id: p.id,
    subject: p.subject,
    description: p.description,
    orderNumber: p.orderNumber,
    status: p.status,
    ticketId: p.ticketId,
    ticketNumber: p.ticketNumber,
    held: p.requestId !== null,
    createdAt: p.createdAt.toISOString(),
  };
}

/**
 * The permission each console's OWN ticket route needs. Checked again here,
 * at confirm time: the permission that mattered when the model proposed is
 * not the one that matters when the person presses the button.
 */
export function ticketPermissionFor(audience: CallerScope['audience']): string | null {
  switch (audience) {
    case 'SELLER':
      return 'tickets.create'; // seller-ticket.controller.ts `create`
    case 'STORE':
    case 'ASSOCIATE':
      return 'tickets.manage'; // store-issue.controller.ts `create`
    case 'STAFF':
      return null; // the admin console has no "raise a ticket" flow
  }
}

const NOT_FOUND = {
  code: 'ASSISTANT_PROPOSAL_NOT_FOUND',
  message: 'Ticket proposal not found',
} as const;

/**
 * THE ONLY PLACE the assistant's module raises a ticket, and it is reached
 * only from a human HTTP route (`.../ticket-proposals/:id/confirm`). No tool
 * holds it (`assistant-ticket-confirmation.spec.ts` pins that), so nothing the
 * model can call creates or changes anything.
 *
 * ── EXACTLY ONCE ─────────────────────────────────────────────────────
 * 1. The proposal must be the caller's (owner columns AND conversation), else 404.
 * 2. The caller must hold the console's ticket permission NOW, else 403.
 * 3. The claim is a guarded `updateMany` PENDING → CONFIRMED naming the
 *    owner. Exactly one request gets count 1; two clicks, two tabs and a
 *    replay get 0 and never reach the ticket service.
 * 4. The ticket is opened by the EXISTING service the console's own form
 *    calls, with the caller's identity. If it THROWS, nothing was created, so
 *    the claim is released (saga compensation) and the server's own
 *    `[CODE] message` goes back to the browser untouched.
 * 5. Once a ticket exists the claim is NEVER released: a failure to write the
 *    outcome back is logged, because reopening would let a second click raise
 *    a second ticket.
 */
@Injectable()
export class AssistantTicketService {
  private readonly log = new Logger(AssistantTicketService.name);

  constructor(
    private readonly store: AssistantStoreService,
    private readonly tickets: TicketService,
    private readonly storeIssues: StoreIssueService,
    private readonly escalation: SellerIssueEscalationService,
  ) {}

  async confirm(scope: CallerScope, id: string): Promise<ProposalView> {
    const owned = await this.store.findOwnedProposal(scope, id);
    if (owned === null) throw new NotFoundException(NOT_FOUND);

    const needed = ticketPermissionFor(scope.audience);
    if (needed === null) throw new NotFoundException(NOT_FOUND);
    if (!scope.permissions.includes(needed)) {
      throw new ForbiddenException({
        code: 'ASSISTANT_TICKET_FORBIDDEN',
        message: 'You do not have permission to raise tickets.',
      });
    }

    // A replay of a proposal that already produced its outcome is the same answer.
    if (owned.status === 'CONFIRMED' && (owned.ticketId !== null || owned.requestId !== null)) {
      return toProposalView(owned);
    }
    if (owned.status === 'DISMISSED') throw this.decided();

    if (!(await this.store.claimProposal(scope, id))) {
      // Lost the race. If the winner has already finished, hand back its result;
      // otherwise it is still working, and this click does nothing.
      const now = await this.store.findOwnedProposal(scope, id);
      if (now === null) throw new NotFoundException(NOT_FOUND);
      if (now.status === 'CONFIRMED' && (now.ticketId !== null || now.requestId !== null)) {
        return toProposalView(now);
      }
      throw this.decided();
    }

    let outcome: { ticketId: string | null; ticketNumber: string | null; requestId: string | null };
    try {
      outcome = await this.raise(scope, owned);
    } catch (e) {
      // Nothing was created: give the claim back so the person can try again.
      try {
        await this.store.releaseProposal(scope, id);
      } catch (releaseError) {
        this.log.error(
          `could not release proposal ${id} after a failed raise: ${
            releaseError instanceof Error ? releaseError.message : String(releaseError)
          }`,
        );
      }
      throw e;
    }

    try {
      await this.store.recordProposalOutcome(id, outcome);
    } catch (e) {
      // The ticket EXISTS. Do not release the claim.
      this.log.error(
        `proposal ${id} raised ${outcome.ticketId ?? outcome.requestId ?? '?'} but its outcome was not recorded: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    const done = await this.store.findOwnedProposal(scope, id);
    return toProposalView(done ?? { ...owned, status: 'CONFIRMED', ...outcome });
  }

  async dismiss(scope: CallerScope, id: string): Promise<ProposalView> {
    const owned = await this.store.findOwnedProposal(scope, id);
    if (owned === null) throw new NotFoundException(NOT_FOUND);
    if (await this.store.dismissProposal(scope, id)) {
      const now = await this.store.findOwnedProposal(scope, id);
      return toProposalView(now ?? { ...owned, status: 'DISMISSED' });
    }
    // Already decided (dismissed twice is fine; a raised ticket cannot be un-raised).
    if (owned.status === 'DISMISSED') return toProposalView(owned);
    throw this.decided();
  }

  /** Raise it through the console's OWN ticket service, as the caller. */
  private async raise(
    scope: CallerScope,
    p: ProposalRow,
  ): Promise<{ ticketId: string | null; ticketNumber: string | null; requestId: string | null }> {
    if (scope.audience === 'SELLER') {
      if (scope.sellerId === null) throw new ForbiddenException(NOT_FOUND);
      // The same two calls `POST /seller/tickets` makes: open, then (post-commit,
      // fire-and-forget) the courier conversation. A ticket with no shipment
      // opens no courier contact; it only stamps who is carrying it.
      const ticket = await this.tickets.open(
        {
          ticketType: TicketType.SELLER_RAISED_ISSUE,
          sellerId: scope.sellerId,
          subject: p.subject,
          description: p.description,
          orderId: p.orderId,
          shipmentId: null,
          issueCategoryExternalId: null,
          issueSubcategoryExternalId: null,
        },
        { type: ActorType.SELLER, sellerUserId: scope.userId },
      );
      void this.escalation.escalate({
        ticketId: ticket.id,
        sellerId: scope.sellerId,
        description: p.description,
      });
      return { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, requestId: null };
    }

    // STORE / ASSOCIATE: the store's own "raise something with Skydrop", which
    // also applies the client's policy for this store (it may be held for approval).
    if (scope.storeId === null || p.orderId === null) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'No such order in your store.',
      });
    }
    const raised = await this.storeIssues.raise({
      storeId: scope.storeId,
      storeUserId: scope.userId,
      ...(scope.orderScope === null ? {} : { orderScope: scope.orderScope }),
      orderId: p.orderId,
      subject: p.subject,
      description: p.description,
    });
    return raised.applied
      ? { ticketId: raised.ticket.id, ticketNumber: raised.ticket.ticketNumber, requestId: null }
      : { ticketId: null, ticketNumber: null, requestId: raised.request.id };
  }

  private decided(): ConflictException {
    return new ConflictException({
      code: 'ASSISTANT_PROPOSAL_ALREADY_DECIDED',
      message: 'This ticket proposal has already been decided.',
    });
  }
}
