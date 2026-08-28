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

/**
 * Shiprocket's support surface: there isn't one.
 *
 * ── WHY THIS FILE EXISTS AT ALL, SAYING NO TO EVERYTHING ─────────────
 * Their support runs through the seller panel and their own team; the
 * public API has no ticketing endpoint, no thread read, and nothing to
 * poll for updates. So every escalation on a Shiprocket parcel goes to a
 * human in the ops console — which is exactly what happens for Delhivery
 * today too, for different reasons.
 *
 * The reason to write it down rather than let the Delhivery adapter
 * cover both is that the two are unsupported INDEPENDENTLY. Delhivery's
 * reads become available the day their MCP realm is provisioned, and
 * `DelhiverySupportAdapterService.capabilities()` is gated on exactly
 * that. Sharing one adapter meant a Shiprocket escalation would inherit
 * that flip: the reconciler would start asking Delhivery's MCP about a
 * Shiprocket ticket, get nothing, and the item would sit in
 * SENT_UNCONFIRMED — the one state that needs a read-back to leave, and
 * the read it needs is against the wrong company.
 *
 * ── WHEN THIS CHANGES ────────────────────────────────────────────────
 * The same as Delhivery's: flip a flag, implement the method. The
 * outbox, the routing, the reconciler and the console are written
 * against the interface and do not move.
 */
@Injectable()
export class ShiprocketSupportAdapterService implements CourierSupportAdapter {
  readonly courierCode = 'shiprocket';

  capabilities(): CapabilityFlags {
    // All false, and deliberately not gated on anything: reporting a
    // capability we do not have is the expensive mistake. AUTO mode
    // would claim items, dispatch them into a method that throws, and
    // every one would land in SENT_UNCONFIRMED with no way out.
    return {
      getThread: false,
      listUpdatedSince: false,
      getTaxonomy: false,
      postComment: false,
      raiseTicket: false,
    };
  }

  async getTaxonomy(): Promise<readonly IssueCategory[]> {
    throw new CourierCapabilityUnsupportedError('getTaxonomy');
  }

  async raiseTicket(_req: RaiseTicketRequest): Promise<RaiseTicketOutcome> {
    throw new CourierCapabilityUnsupportedError('raiseTicket');
  }

  async getThread(_externalTicketId: string): Promise<readonly CourierThreadMessage[]> {
    throw new CourierCapabilityUnsupportedError('getThread');
  }

  async postComment(_externalTicketId: string, _body: string): Promise<void> {
    throw new CourierCapabilityUnsupportedError('postComment');
  }

  async listUpdatedSince(
    _since: Date,
  ): Promise<readonly { externalTicketId: string; updatedAt: Date }[]> {
    throw new CourierCapabilityUnsupportedError('listUpdatedSince');
  }
}
