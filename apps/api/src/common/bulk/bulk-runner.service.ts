import { createHash } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RedisService } from '../../infrastructure/redis/redis.service';

/**
 * Bulk order actions (owner, 2026-11-19 — "Phase B").
 *
 * ── WHAT THIS IS, AND WHAT IT IS NOT ─────────────────────────────────
 * A LOOP over an action that already exists for one order. It owns no
 * business rule, no money, no courier call: each id is handed to the SAME
 * service method the single-order endpoint calls, in its OWN transaction,
 * with the SAME scope and policy checks. So a bulk cancel of three orders
 * writes exactly the wallet / ledger / stock rows three single cancels
 * would — nothing is batched, nothing is skipped, nothing is added.
 *
 * ── SEQUENTIAL, ON PURPOSE ───────────────────────────────────────────
 * One id at a time. Two cancels of the same seller's orders in parallel
 * would race on that seller's wallet rows; the single path was never
 * written to be run against itself concurrently, so the bulk path does
 * not ask it to.
 *
 * ── ONE ORDER'S FAILURE IS ONE ORDER'S RESULT ────────────────────────
 * A refusal (any 4xx — not found, wrong state, policy) is SKIPPED with
 * the service's own code and words; anything else is FAILED with a
 * generic message (the real error is logged). Neither stops the loop
 * and neither undoes an order already done.
 *
 * ── A DOUBLE-CLICK RUNS NOTHING TWICE ────────────────────────────────
 * The caller sends an idempotency key per click. Key = actor + action +
 * that key + a hash of the payload; SET NX claims it for 24 h. A replay
 * returns the FIRST result; a replay while the first is still running is
 * a 409. If Redis is unreachable the bulk action refuses (503) rather
 * than run without the guard — the single-order buttons still work.
 */

export type BulkOutcome = 'DONE' | 'SKIPPED' | 'FAILED';

export interface BulkItemResult {
  readonly orderId: string;
  readonly outcome: BulkOutcome;
  readonly code?: string;
  readonly message?: string;
}

export interface BulkResult {
  readonly action: string;
  readonly results: readonly BulkItemResult[];
  readonly done: number;
  readonly skipped: number;
  readonly failed: number;
  /** True when this is the stored answer to an earlier identical click. */
  readonly replayed: boolean;
}

export interface BulkActor {
  readonly type: string;
  readonly id: string;
}

/**
 * One order's action. Throw to refuse (the service's own exceptions);
 * return a short note when "done" means something other than the obvious
 * ("sent to the client for approval", "ticket TK-12 was already open").
 */
export type BulkStep = (id: string) => Promise<string | void>;

const TTL_SECONDS = 24 * 60 * 60;
const RUNNING = '__running__';

@Injectable()
export class BulkRunnerService {
  private readonly log = new Logger(BulkRunnerService.name);

  constructor(private readonly redis: RedisService) {}

  async run(
    input: {
      readonly actor: BulkActor;
      readonly action: string;
      readonly idempotencyKey: string;
      readonly ids: readonly string[];
      /** Everything else that shapes the outcome (reason, note…), for the key. */
      readonly params?: unknown;
    },
    each: BulkStep,
  ): Promise<BulkResult> {
    const ids = [...new Set(input.ids)];
    const key = bulkKey(input.actor, input.action, input.idempotencyKey, ids, input.params);

    let claimed: string | null;
    try {
      claimed = await this.redis.client.set(key, RUNNING, 'EX', TTL_SECONDS, 'NX');
    } catch (err) {
      this.log.error(`bulk idempotency store unreachable: ${errText(err)}`);
      throw new ServiceUnavailableException({
        code: 'BULK_UNAVAILABLE',
        message:
          'Bulk actions are unavailable right now. Use the single-order buttons, or try again shortly.',
      });
    }
    if (claimed === null) {
      const stored = await this.redis.client.get(key).catch(() => null);
      if (stored === null || stored === RUNNING) {
        throw new ConflictException({
          code: 'BULK_IN_PROGRESS',
          message: 'This bulk action is already running. Its result will appear when it finishes.',
        });
      }
      return { ...(JSON.parse(stored) as BulkResult), replayed: true };
    }

    const results = await runEach(ids, each, (id, err) =>
      this.log.error(`bulk ${input.action} ${id} failed: ${errText(err)}`),
    );
    const out: BulkResult = {
      action: input.action,
      results,
      done: results.filter((r) => r.outcome === 'DONE').length,
      skipped: results.filter((r) => r.outcome === 'SKIPPED').length,
      failed: results.filter((r) => r.outcome === 'FAILED').length,
      replayed: false,
    };
    await this.redis.client
      .set(key, JSON.stringify(out), 'EX', TTL_SECONDS)
      .catch((err: unknown) => this.log.warn(`bulk result not stored: ${errText(err)}`));
    return out;
  }
}

/** Pure: the loop. Sequential; a refusal is SKIPPED, anything else FAILED. */
export async function runEach(
  ids: readonly string[],
  each: BulkStep,
  onError: (id: string, err: unknown) => void = () => undefined,
): Promise<BulkItemResult[]> {
  const results: BulkItemResult[] = [];
  for (const orderId of ids) {
    try {
      const note = await each(orderId);
      results.push(
        typeof note === 'string' && note !== ''
          ? { orderId, outcome: 'DONE', message: note }
          : { orderId, outcome: 'DONE' },
      );
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() < 500) {
        const body = err.getResponse();
        const code =
          typeof body === 'object' &&
          body !== null &&
          typeof (body as { code?: unknown }).code === 'string'
            ? (body as { code: string }).code
            : `HTTP_${err.getStatus()}`;
        const message =
          typeof body === 'object' &&
          body !== null &&
          typeof (body as { message?: unknown }).message === 'string'
            ? (body as { message: string }).message
            : err.message;
        results.push({ orderId, outcome: 'SKIPPED', code, message });
      } else {
        onError(orderId, err);
        results.push({
          orderId,
          outcome: 'FAILED',
          code: 'FAILED',
          message: 'This one could not be done. Try it on its own from the order page.',
        });
      }
    }
  }
  return results;
}

/** Pure: the idempotency key. Same click + same payload → same key. */
export function bulkKey(
  actor: BulkActor,
  action: string,
  idempotencyKey: string,
  ids: readonly string[],
  params?: unknown,
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ ids: [...ids].sort(), params: params ?? null }))
    .digest('hex')
    .slice(0, 32);
  return `bulk:v1:${actor.type}:${actor.id}:${action}:${idempotencyKey}:${digest}`;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
