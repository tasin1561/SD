import { Injectable } from '@nestjs/common';

export interface QcQuestion {
  /** OUR question id. Delhivery maps it to theirs via a one-time
   *  mapping their BD team configures — see the class doc. */
  readonly questionId: string;
  /** 'multi' → the field executive picks an option; 'varchar' → types. */
  readonly type: 'multi' | 'varchar';
  readonly options: readonly string[];
  /** Only the FIRST element is treated as the correct answer. */
  readonly correctValues: readonly string[];
  /**
   * true  → a wrong answer FAILS the QC and the pickup is refused.
   * false → the question is asked but cannot fail the check.
   */
  readonly required: boolean;
  readonly questionImages?: readonly string[];
}

export interface QcItem {
  readonly description: string;
  readonly images: readonly string[];
  readonly quantity: number;
  readonly item?: string;
  readonly brand?: string;
  readonly productCategory?: string;
  readonly returnReason?: string;
  readonly questions: readonly QcQuestion[];
}

/** Delhivery's hard limits — exceeding them does NOT error. */
const MAX_ITEMS = 2;
const MAX_QUESTIONS_PER_ITEM = 6;

/**
 * Doorstep quality checks on a reverse pickup (RVP QC 3.0).
 *
 * When a customer returns something, the field executive can be made to
 * verify it at the door — right item, right brand, undamaged, all
 * accessories present — and REFUSE the pickup if it fails. That is the
 * difference between discovering a fraudulent return at the customer's
 * doorstep and discovering it three days later in your warehouse with
 * the goods already gone.
 *
 * ── THE LIMIT THAT FAILS SILENTLY ────────────────────────────────────
 * Delhivery allows at most 2 items with at most 6 questions each. Exceed
 * either and — in their words — "the shipment will still be created, but
 * it will be marked as a non-QC shipment". No error. You would believe
 * checks were happening at the door when nothing was being checked at
 * all, and only find out when a disputed return arrived unverified. So
 * this service REFUSES to build an over-limit payload rather than
 * letting one through.
 *
 * ── ONE-TIME SETUP OUTSIDE THE CODE ──────────────────────────────────
 * Question IDs are not free text. Delhivery's BD team supplies their
 * question IDs, we map ours to theirs, and they configure the mapping on
 * their side. Until that exists, `custom_qc` payloads reference ids
 * Delhivery cannot resolve. This is a prerequisite to request alongside
 * the webhook document, not something code can arrange.
 */
@Injectable()
export class DelhiveryRvpQcService {
  /**
   * Build the `qc_type` + `custom_qc` keys to merge into an RVP create
   * payload. Throws rather than silently producing a non-QC shipment.
   */
  buildQcKeys(items: readonly QcItem[]): Record<string, unknown> {
    if (items.length === 0) {
      throw new Error('RVP QC needs at least one item');
    }
    if (items.length > MAX_ITEMS) {
      throw new Error(
        `Delhivery allows at most ${MAX_ITEMS} QC items; got ${items.length}. ` +
          `Exceeding it does NOT error — the shipment is silently created as ` +
          `NON-QC, so this is refused here instead.`,
      );
    }
    for (const item of items) {
      if (item.questions.length === 0) {
        throw new Error(`QC item '${item.description}' has no questions`);
      }
      if (item.questions.length > MAX_QUESTIONS_PER_ITEM) {
        throw new Error(
          `Delhivery allows at most ${MAX_QUESTIONS_PER_ITEM} questions per item; ` +
            `'${item.description}' has ${item.questions.length}. Exceeding it ` +
            `silently downgrades the shipment to non-QC.`,
        );
      }
      if (item.images.length === 0) {
        throw new Error(
          `QC item '${item.description}' needs at least one reference image for the field executive to compare against`,
        );
      }
      for (const q of item.questions) {
        if (q.type === 'multi' && q.options.length === 0) {
          throw new Error(
            `Question '${q.questionId}' is multiple-choice but has no options`,
          );
        }
        if (q.correctValues.length === 0) {
          throw new Error(`Question '${q.questionId}' has no correct answer`);
        }
      }
    }

    return {
      // Hardcoded by Delhivery to select parametric QC.
      qc_type: 'param',
      custom_qc: items.map((item) => ({
        description: item.description,
        images: item.images.join(','),
        quantity: item.quantity,
        ...(item.item === undefined ? {} : { item: item.item }),
        ...(item.brand === undefined ? {} : { brand: item.brand }),
        ...(item.productCategory === undefined
          ? {}
          : { product_category: item.productCategory }),
        ...(item.returnReason === undefined
          ? {}
          : { return_reason: item.returnReason }),
        questions: item.questions.map((q) => ({
          questions_id: q.questionId,
          type: q.type,
          options: q.options,
          // Delhivery reads only the first element as correct; we send
          // the list as given but the caller should know only [0] counts.
          value: q.correctValues,
          required: q.required,
          ...(q.questionImages === undefined
            ? {}
            : { ques_images: q.questionImages }),
        })),
      })),
    };
  }
}
