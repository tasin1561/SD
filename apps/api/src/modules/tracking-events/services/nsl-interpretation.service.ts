import { Injectable } from '@nestjs/common';

export interface NslMeaning {
  readonly code: string;
  /** Plain English, or null when we genuinely do not know. */
  readonly plain: string | null;
  /**
   * Whether Delhivery accepts a RE-ATTEMPT on a parcel sitting at this
   * code. SOURCED, not guessed — it is the list they publish and the
   * one `DelhiveryNdrService` already enforces before spending a call.
   */
  readonly reAttemptable: boolean;
  /** Whether a reverse-pickup reschedule is the applicable action. */
  readonly reschedulable: boolean;
}

/**
 * Delhivery's re-attempt list, verbatim from their integration guide
 * (see docs/vendor/delhivery-b2c-api-raw.md). This is the AUTHORITATIVE
 * half of the interpretation: it decides whether the "ask for another
 * attempt" button can do anything.
 */
const REATTEMPTABLE = new Set([
  'EOD-74',
  'EOD-15',
  'EOD-104',
  'EOD-43',
  'EOD-86',
  'EOD-11',
  'EOD-69',
  'EOD-6',
]);

/** The two codes that take a pickup reschedule instead. */
const RESCHEDULABLE = new Set(['EOD-777', 'EOD-21']);

/**
 * Plain-English glosses.
 *
 * ── PROVENANCE, BECAUSE IT MATTERS HERE ──────────────────────────────
 * Delhivery publishes WHICH codes permit a re-attempt but not a code →
 * meaning table, so these glosses are from their integration
 * documentation and support correspondence rather than a machine-
 * readable source. An UNKNOWN code therefore returns null and the UI
 * shows the raw code — never a guess. Telling a seller their customer
 * refused the parcel when the code actually meant the office was shut
 * is worse than telling them nothing, because they act on it.
 *
 * Two are certain because our own code already depends on them:
 * EOD-777 is an RVP QC failure and EOD-21 a cancelled pickup (CUR-10).
 */
const PLAIN: Readonly<Record<string, string>> = {
  'EOD-777': 'Reverse-pickup quality check failed',
  'EOD-21': 'Pickup was cancelled',
};

/**
 * What a courier's NSL code means, for a human.
 *
 * The fifth single-source mapping service, and the same discipline as
 * `CallOutcomeMappingService` (CC-2), `TrackingStatusMappingService`
 * (TRK-5) and `NotificationEventMappingService` (NOTIF-4): pure logic,
 * no Prisma, and the ONLY place a code becomes words. A second copy in
 * a component is how a seller and an agent end up reading the same
 * failure differently.
 */
@Injectable()
export class NslInterpretationService {
  interpret(code: string | null): NslMeaning | null {
    if (code === null) return null;
    const norm = code.trim().toUpperCase();
    if (norm === '') return null;
    return {
      code: norm,
      plain: PLAIN[norm] ?? null,
      reAttemptable: REATTEMPTABLE.has(norm),
      reschedulable: RESCHEDULABLE.has(norm),
    };
  }
}
