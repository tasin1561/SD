import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AddressCheckQueue } from '../queue/address-check.queue';
import { SolustationHttpService } from './solustation-http.service';
import { isSolustationError } from '../types/solustation.types';

/** Six tries, then it stays `unavailable` and somebody can look. */
const MAX_ATTEMPTS = 6;
/** One sweep's worth; it runs hourly and there is no hurry. */
const MAX_PER_SWEEP = 200;

/**
 * Ask again about an address whose check could not be made.
 *
 * ── WHAT IT RE-SENDS, AND WHY THAT IS THE HARD PART ──────────────────
 * The row holds the LAST request's address, because a retry has to send
 * what the operator actually typed — not what the form holds now, which
 * may be a different order entirely. That is why the address is stored
 * on the row rather than reconstructed from the order: an order saved
 * with an unavailable check may since have been edited, and re-checking
 * the edited text would store a verdict about words the customer was
 * never quoted.
 *
 * ── IT NEVER UN-SAVES ANYTHING ───────────────────────────────────────
 * The order exists. This can only ever ADD a verdict to it, never
 * refuse it or change it. A check that comes back `reject` an hour
 * later is information for whoever reads the order, not a reason to
 * stop a parcel that is already being packed.
 *
 * ── IT GIVES UP OUT LOUD ─────────────────────────────────────────────
 * After six tries the row stays `unavailable` with its last error, and
 * `nextRetryAt` is cleared so the sweep stops picking it up. Silence
 * would leave rows being re-asked for ever against a service that is
 * never coming back.
 */
@Injectable()
export class AddressCheckRetryService {
  private readonly logger = new Logger(AddressCheckRetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: SolustationHttpService,
    private readonly queue: AddressCheckQueue,
  ) {}

  /** Queue every check whose turn has come. Returns how many. */
  async sweep(): Promise<number> {
    if (!(await this.http.isLive())) return 0;

    const due = await this.prisma.client.addressCheck.findMany({
      where: {
        status: 'unavailable',
        nextRetryAt: { not: null, lte: new Date() },
        attempts: { lt: MAX_ATTEMPTS },
      },
      select: { referenceId: true },
      orderBy: { nextRetryAt: 'asc' },
      take: MAX_PER_SWEEP,
    });

    for (const row of due) {
      // Keyed on the reference inside the queue, so a row queued here
      // and a row queued by its own failure are ONE job.
      await this.queue.enqueueRetry({ referenceId: row.referenceId });
    }
    return due.length;
  }

  /**
   * One re-ask. Throws on a retryable failure so BullMQ applies the
   * backoff; swallows one that cannot change, because asking the same
   * unanswerable question again is how a queue fills with work that
   * will never succeed.
   */
  async retryOne(referenceId: string): Promise<void> {
    const row = await this.prisma.client.addressCheck.findUnique({
      where: { referenceId },
      select: {
        id: true,
        status: true,
        attempts: true,
        validationId: true,
        sellerId: true,
        createdByActorType: true,
        result: true,
      },
    });
    if (row === null || row.status !== 'unavailable') return;
    if (row.attempts >= MAX_ATTEMPTS) {
      await this.giveUp(row.id);
      return;
    }

    // The address as it was when the check was attempted. Without it
    // there is nothing honest to re-send, so the row is retired rather
    // than guessed at from an order that may have moved on.
    const asked = this.lastRequest(row.result);
    if (asked === null) {
      await this.giveUp(row.id, 'no stored request to repeat');
      return;
    }

    try {
      const judgement =
        row.validationId === null
          ? await this.http.validate(asked)
          : await this.http.correction({
              validationId: row.validationId,
              source: 'operator_fixed',
              address: asked.address,
              pincode: asked.pincode,
              landmark: asked.landmark,
            });

      await this.prisma.client.addressCheck.update({
        where: { id: row.id },
        data: {
          status: judgement.status ?? 'needs_review',
          action: judgement.recommended_action ?? null,
          score: typeof judgement.validity_score === 'number' ? judgement.validity_score : null,
          poConfidence: judgement.post_office_confidence ?? null,
          result: judgement as unknown as Prisma.InputJsonValue,
          checkedAt: new Date(),
          nextRetryAt: null,
          lastError: null,
          ...(row.validationId === null && judgement.validation_id != null
            ? { validationId: judgement.validation_id }
            : {}),
        },
      });
      this.logger.log({ referenceId }, 'An unavailable address check now has an answer');
    } catch (e) {
      const retryable = isSolustationError(e) ? e.retryable : false;
      await this.prisma.client.addressCheck.update({
        where: { id: row.id },
        data: {
          attempts: { increment: 1 },
          lastError: (e instanceof Error ? e.message : String(e)).slice(0, 1_000),
          lastRequestId: isSolustationError(e) ? (e.requestId ?? null) : null,
          nextRetryAt: retryable ? new Date(Date.now() + 60_000) : null,
        },
      });
      // Only a retryable failure goes back to BullMQ. A 422 is our own
      // request being wrong and a 401 is the key — neither changes by
      // being asked again, and both are already recorded on the row.
      if (retryable) throw e;
    }
  }

  private async giveUp(id: string, reason?: string): Promise<void> {
    await this.prisma.client.addressCheck.update({
      where: { id },
      data: { nextRetryAt: null, ...(reason === undefined ? {} : { lastError: reason }) },
    });
  }

  /**
   * The request this row last made, read back off the stored response.
   *
   * Their response echoes `reference_id` but not the address, so what
   * is recoverable is what we put there ourselves — see
   * `AddressCheckService`, which stores the request alongside the
   * judgement for exactly this. A row from before that existed returns
   * null and is retired rather than re-asked with a guess.
   */
  private lastRequest(result: Prisma.JsonValue | null): {
    referenceId: string;
    address: string;
    pincode: string;
    landmark?: string;
    paymentType: 'cod' | 'prepaid';
  } | null {
    if (result === null || typeof result !== 'object' || Array.isArray(result)) return null;
    const asked = (result as Record<string, unknown>)['_asked'];
    if (asked === undefined || typeof asked !== 'object' || asked === null) return null;
    const a = asked as Record<string, unknown>;
    if (typeof a['referenceId'] !== 'string' || typeof a['address'] !== 'string') return null;
    if (typeof a['pincode'] !== 'string') return null;
    return {
      referenceId: a['referenceId'],
      address: a['address'],
      pincode: a['pincode'],
      ...(typeof a['landmark'] === 'string' ? { landmark: a['landmark'] } : {}),
      paymentType: a['paymentType'] === 'prepaid' ? 'prepaid' : 'cod',
    };
  }
}
