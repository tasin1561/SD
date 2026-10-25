/**
 * Solustation Address, as it actually answers.
 *
 * Shapes verified against the live API with the test key on
 * 2026-10-25 — not transcribed from the brief, because the brief does
 * not mention `score_breakdown`, `degraded`, `providers_used`,
 * `model_version`, `billable` or `created_at`, and it does not say that
 * `serviceable` currently comes back entirely null.
 *
 * Every field is optional on the way in: this is a separate product
 * with its own release cycle, and a response that grows a field must
 * not break a page. The FULL response is stored verbatim on
 * `address_checks.result`, so nothing read here is the only copy.
 */

/** `GET /v1/pincode/{pincode}` — free, not billed. */
export interface SolustationPincode {
  readonly pincode: string;
  readonly valid: boolean;
  readonly district: string | null;
  readonly state: string | null;
  readonly sub_districts: readonly string[];
  /**
   * `type` is null for every row today (B.O./S.O./H.O. is a known gap
   * on their side, being fixed). Render the name alone until it is
   * non-null rather than printing an empty label.
   */
  readonly post_offices: ReadonlyArray<{ name: string; type: string | null }>;
  readonly serviceable?: SolustationServiceable;
}

/**
 * ALL NULL TODAY, on both endpoints and for both couriers (verified
 * 2026-10-25; their `/health` reports every provider disabled).
 *
 * Null means UNKNOWN, never "no". Nothing may render it as a verdict —
 * the real serviceability signal on the client console is still the
 * live Delhivery check (`OrderServiceabilityService`), which is
 * untouched by any of this. The field is typed here so that the day it
 * becomes real we are reading it, not discovering it.
 */
export interface SolustationServiceable {
  readonly delhivery?: { prepaid: boolean | null; cod: boolean | null };
  readonly shiprocket?: { prepaid: boolean | null; cod: boolean | null };
}

/** Their verdict vocabulary. Stored as given; see `address_checks`. */
export type SolustationStatus = 'valid' | 'needs_review' | 'invalid';
export type SolustationAction = 'approve' | 'confirm_with_customer' | 'reject';
export type SolustationPoConfidence = 'high' | 'medium';

/**
 * The answer from `POST /v1/validate` and `POST /v1/corrections` — the
 * same shape, which is why one type serves both.
 */
export interface SolustationJudgement {
  readonly status?: SolustationStatus;
  readonly recommended_action?: SolustationAction;
  readonly validity_score?: number;
  readonly score_breakdown?: ReadonlyArray<{ signal: string; points: number }>;

  /**
   * `rto_risk` is readable ONLY when `rto_risk_status === 'shown'`.
   * Today it is always `model_not_ready` and the number is null — so
   * the page says "not enough data yet" and NOTHING computes, guesses
   * or fills in a figure. A fabricated risk score is worse than none:
   * it would be acted on.
   */
  readonly rto_risk?: number | null;
  readonly rto_risk_status?: 'shown' | 'model_not_ready' | string;
  readonly rto_confidence?: number | null;

  readonly extracted?: Readonly<Record<string, string | null>>;
  /** Per field: `customer` | `pincode` | `inferred`. */
  readonly field_source?: Readonly<Record<string, string>>;

  /**
   * Only `high` is safe for a courier label (brief §3e). At anything
   * else the customer's own text goes on the parcel, and the customer's
   * original text is never dropped from the order either way.
   */
  readonly post_office_confidence?: SolustationPoConfidence | null;
  readonly completed_address?: string | null;

  readonly issues?: ReadonlyArray<{ code: string; message: string }>;
  readonly suggestions?: ReadonlyArray<{
    field: string;
    candidates: readonly string[];
    reason?: string;
  }>;

  readonly serviceable?: SolustationServiceable;
  readonly degraded?: boolean;
  readonly providers_used?: readonly string[];
  readonly model_version?: string;

  readonly validation_id?: string;
  readonly reference_id?: string;
  /** False on the test key — which is how we know a probe cost nothing. */
  readonly billable?: boolean;
  readonly created_at?: string;
}

/** Their error envelope: `{"error":{"code","message","request_id"}}`. */
export interface SolustationErrorBody {
  readonly error?: { code?: string; message?: string; request_id?: string };
}

/**
 * Why a call did not produce a judgement — the axis the caller and the
 * retry worker both branch on.
 *
 * `BAD_REQUEST` and `AUTH` are NOT retryable and that is the whole
 * point of separating them: a 422 means we built the request wrong and
 * retrying it just sends the same wrong request again (and a 422 is how
 * a leaked field would announce itself, so it must be loud); a 401/403
 * means the key is wrong and a retry loop against an auth failure is
 * how an account gets locked.
 */
export type SolustationFailure =
  | 'TIMEOUT'
  | 'NETWORK'
  | 'SERVER'
  | 'RATE_LIMITED'
  | 'BAD_REQUEST'
  | 'AUTH'
  | 'STUB';

/**
 * Stamped onto a plain `Error`, never a subclass with its own fields.
 *
 * BullMQ serialises a failure through Redis, which does not preserve
 * the prototype — so a worker reading `err instanceof SolustationError`
 * gets false on the retry it most needs to classify. The house pattern
 * (see `waf-backoff.ts`) is to match on `err.name` and read stamped
 * properties, and this follows it.
 */
export interface SolustationErrorFields {
  readonly classification: SolustationFailure;
  readonly retryable: boolean;
  readonly status?: number;
  /** Their `error.code`, e.g. `unknown_field`. */
  readonly vendorCode?: string;
  /** `X-Request-Id`, so one call can be asked about in their logs. */
  readonly requestId?: string | null;
  /** From `Retry-After` on a 429. */
  readonly retryAfterSeconds?: number;
}

export const SOLUSTATION_ERROR_NAME = 'SolustationHttpError';

export type SolustationError = Error & SolustationErrorFields;

export function isSolustationError(e: unknown): e is SolustationError {
  return e instanceof Error && e.name === SOLUSTATION_ERROR_NAME;
}
