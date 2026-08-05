import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export interface NdrAttemptContext {
  /** Delhivery's fine-grained reason code under the current status. */
  readonly nslCode: string | null;
  /** How many delivery attempts have already been made. */
  readonly attemptCount: number;
  /** Where the numbers came from — see the TODO below. */
  readonly source: 'LOCAL_DELIVERY_ATTEMPTS';
}

/**
 * The ONE place "how many times has this been attempted?" is answered.
 *
 * ── WHY IT IS ISOLATED ───────────────────────────────────────────────
 * Delhivery's NDR API refuses a re-attempt unless the attempt count is 1
 * or 2, so this number decides whether we may act. Today we DERIVE it
 * from our own `delivery_attempts` rows, which are built from scans we
 * received. That is a proxy for the courier's own count, and the two can
 * disagree — a scan we never received, or a webhook we dropped, makes
 * ours lower than theirs, and we would submit a request they reject.
 *
 * TODO(delhivery-api): it is UNVERIFIED whether the tracking response
 * exposes a delivery-attempt count field. Delhivery's MCP surfaces
 * "Delivery Attempts", so it probably exists in REST too, but production
 * has never had a real consignment with scan history to look at — see
 * `docs/delhivery-go-live-test.md`. **If their field exists, it is
 * AUTHORITATIVE and ours is the fallback**: they are the ones enforcing
 * the 1-or-2 rule, so their count is the one that decides the outcome.
 * Switching over should be a change inside this method and nothing else,
 * which is the entire reason it is a method.
 *
 * ── WHY THE NSL COMES FROM HERE TOO ──────────────────────────────────
 * The two are always read together and always for the same decision, and
 * splitting them across two call sites is how one gets refreshed and the
 * other does not.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────
 * It does not fetch from the courier. The nightly runner must re-read
 * the NSL from a LIVE tracking call immediately before submitting (a
 * stale NSL means submitting actions Delhivery rejects, which pollutes
 * the UPL results and leaves reconciliation unable to distinguish "they
 * ignored a valid request" from "we sent an invalid one"). Interactive
 * operator actions keep using this cached read — a human just looked at
 * the shipment, and a second network round trip buys nothing.
 */
@Injectable()
export class NdrAttemptContextService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param shipmentId our identity for the parcel.
   * @param _awbNumber the courier's identity. Unused today, and present
   *   because the courier-side replacement will be keyed on it — the
   *   tracking response is keyed by AWB, not by anything of ours.
   */
  async resolve(shipmentId: string, _awbNumber?: string | null): Promise<NdrAttemptContext> {
    const latest = await this.prisma.client.deliveryAttempt.findFirst({
      where: { shipmentId },
      orderBy: { attemptNumber: 'desc' },
      select: { courierNslCode: true, attemptNumber: true },
    });
    return {
      nslCode: latest?.courierNslCode ?? null,
      attemptCount: latest?.attemptNumber ?? 0,
      source: 'LOCAL_DELIVERY_ATTEMPTS',
    };
  }

  /** Just the count, for callers that do not need the NSL. */
  async resolveAttemptCount(shipmentId: string, awbNumber?: string | null): Promise<number> {
    return (await this.resolve(shipmentId, awbNumber)).attemptCount;
  }
}
