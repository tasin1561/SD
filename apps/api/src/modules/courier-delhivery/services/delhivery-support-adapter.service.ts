import { Injectable } from '@nestjs/common';
import {
  CourierCapabilityUnsupportedError,
  type CapabilityFlags,
  type CourierSupportAdapter,
  type CourierThreadMessage,
  type IssueCategory,
  type RaiseTicketOutcome,
  type RaiseTicketRequest,
} from '../../courier-shared/services/courier-support-adapter';
import { CourierMcpReaderService } from '../../courier-shared/services/courier-mcp-reader.service';

/**
 * Delhivery's implementation of the support adapter. Honest about being
 * mostly unable to do anything.
 *
 * ── EVERY WRITE IS UNSUPPORTED, AND THAT IS THE TRUTH ────────────────
 * There is no ticketing endpoint in the Express REST API, MCP is
 * read-only until Delhivery ships writes, and their notification emails
 * do not accept replies. So `postComment` and `raiseTicket` throw
 * `CourierCapabilityUnsupportedError`, the router reads
 * `capabilities()` and sends the item to a human, and nothing anywhere
 * pretends otherwise.
 *
 * Reporting a capability we do not have would be the expensive mistake:
 * AUTO mode would claim items, "dispatch" them into a method that
 * throws, and every one would land in SENT_UNCONFIRMED — the single
 * state that requires a read-back to leave and that we also cannot
 * perform. The queue would fill with items nobody could resolve.
 *
 * ── WHEN MCP WRITES ARRIVE ───────────────────────────────────────────
 * Flip the flags and implement the two methods. Nothing above this file
 * changes: the outbox, the routing, the reconciler, the console and the
 * audit trail are all written against the interface.
 */
@Injectable()
export class DelhiverySupportAdapterService implements CourierSupportAdapter {
  readonly courierCode = 'delhivery';

  constructor(private readonly mcp: CourierMcpReaderService) {}

  capabilities(): CapabilityFlags {
    // Reads become true when MCP is provisioned — the realm 404 is a
    // Delhivery-side blocker, not something we can build past. Writes
    // become true when they ship write operations.
    const mcpUp = this.mcp.availability().available;
    return {
      getThread: mcpUp,
      listUpdatedSince: mcpUp,
      getTaxonomy: mcpUp,
      // Not gated on MCP being up: MCP is read-only even when it works.
      postComment: false,
      raiseTicket: false,
    };
  }

  async getTaxonomy(_ctx?: { awb: string }): Promise<readonly IssueCategory[]> {
    if (!this.capabilities().getTaxonomy) {
      throw new CourierCapabilityUnsupportedError('getTaxonomy');
    }
    // TODO(delhivery-api): fetch and cache the category tree, keyed on
    // their IDs. Until this runs at least once we do not KNOW the IDs of
    // Claims/Finance or Protect VAS, which is why the auto list must stay
    // empty — a lock enforced by ID cannot be enforced without the IDs.
    return [];
  }

  async raiseTicket(_req: RaiseTicketRequest): Promise<RaiseTicketOutcome> {
    throw new CourierCapabilityUnsupportedError('raiseTicket');
  }

  async getThread(_externalTicketId: string): Promise<readonly CourierThreadMessage[]> {
    if (!this.capabilities().getThread) {
      throw new CourierCapabilityUnsupportedError('getThread');
    }
    // TODO(delhivery-api): MCP thread read over Streamable HTTP.
    return [];
  }

  async postComment(_externalTicketId: string, _body: string): Promise<void> {
    throw new CourierCapabilityUnsupportedError('postComment');
  }

  async listUpdatedSince(
    _since: Date,
  ): Promise<readonly { externalTicketId: string; updatedAt: Date }[]> {
    if (!this.capabilities().listUpdatedSince) {
      throw new CourierCapabilityUnsupportedError('listUpdatedSince');
    }
    // TODO(delhivery-api): MCP list-updated-since.
    return [];
  }
}
