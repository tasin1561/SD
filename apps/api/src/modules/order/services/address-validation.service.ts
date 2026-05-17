import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

const ALLOWED_STATES_SETTING_KEY = 'ops.allowed_indian_states';
const STATES_CACHE_TTL_MS = 5 * 60 * 1000; // 5-min window (codebase convention)

/** Indian PIN: 6 digits, first 1-9. */
const PIN_RE = /^[1-9][0-9]{5}$/;
/** E.164 (CLAUDE.md: +91…, +880…). Same shape CustomerService enforces. */
const E164_RE = /^\+[1-9]\d{6,14}$/;

export interface RecipientAddressInput {
  recipientPhoneE164: string;
  recipientAltPhoneE164?: string | null;
  recipientPostalCode: string;
  recipientStateProvince: string;
  recipientCountryCode?: string | null;
}

export interface AddressValidationResult {
  ok: boolean;
  errors: string[];
  /** Canonical casing of the matched state (persist this). */
  normalizedState?: string;
}

/**
 * Locked decision #5 — SOFT recipient-address validation: format + state
 * membership only. Deliberately does NOT cross-check PIN↔state against a
 * pin_codes table (deferred — phase-1a-debt). The allowed-state list is
 * `ops.allowed_indian_states` (seeded JSON; 28 states + 8 UTs), memoised
 * 5 min so a 1000-row CSV import isn't 1000 settings reads. If the
 * setting is somehow absent the state check is skipped (logged) rather
 * than hard-failing every order — Phase 1A is single-country (IN).
 */
@Injectable()
export class AddressValidationService {
  private readonly logger = new Logger(AddressValidationService.name);
  private statesCache: { expiresAt: number; byLower: Map<string, string> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async allowedStates(): Promise<Map<string, string>> {
    const now = Date.now();
    if (this.statesCache && this.statesCache.expiresAt > now) {
      return this.statesCache.byLower;
    }
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: ALLOWED_STATES_SETTING_KEY },
      select: { valueJson: true },
    });
    const byLower = new Map<string, string>();
    const raw = row?.valueJson;
    if (Array.isArray(raw)) {
      for (const s of raw) {
        if (typeof s === 'string') byLower.set(s.toLowerCase().trim(), s);
      }
    }
    if (byLower.size === 0) {
      this.logger.warn(
        `${ALLOWED_STATES_SETTING_KEY} missing/empty — state membership check skipped`,
      );
    }
    this.statesCache = { expiresAt: now + STATES_CACHE_TTL_MS, byLower };
    return byLower;
  }

  /** Drop the memoised list (admin edited the setting). */
  invalidateStatesCache(): void {
    this.statesCache = null;
  }

  async validate(input: RecipientAddressInput): Promise<AddressValidationResult> {
    const errors: string[] = [];

    const country = (input.recipientCountryCode ?? 'IN').toUpperCase();
    if (country !== 'IN') {
      errors.push(`Phase 1A ships to India only (got country "${country}")`);
    }

    if (!PIN_RE.test(input.recipientPostalCode.trim())) {
      errors.push(
        `Invalid Indian PIN code "${input.recipientPostalCode}" (expected 6 digits, first 1-9)`,
      );
    }

    if (!E164_RE.test(input.recipientPhoneE164.trim())) {
      errors.push(`Recipient phone must be E.164 (got "${input.recipientPhoneE164}")`);
    }
    const alt = input.recipientAltPhoneE164?.trim();
    if (alt && !E164_RE.test(alt)) {
      errors.push(`Recipient alternate phone must be E.164 (got "${alt}")`);
    }

    let normalizedState: string | undefined;
    const states = await this.allowedStates();
    if (states.size > 0) {
      const canonical = states.get(input.recipientStateProvince.toLowerCase().trim());
      if (canonical) {
        normalizedState = canonical;
      } else {
        errors.push(
          `"${input.recipientStateProvince}" is not an allowed Indian state/UT`,
        );
      }
    } else {
      // List unavailable — accept the value as-is (soft).
      normalizedState = input.recipientStateProvince.trim();
    }

    return normalizedState !== undefined
      ? { ok: errors.length === 0, errors, normalizedState }
      : { ok: errors.length === 0, errors };
  }

  /**
   * Validate-or-throw. Returns the canonical state string to persist on
   * the order. Used by OrderService.create / bulk import per row.
   */
  async assertValid(input: RecipientAddressInput): Promise<string> {
    const result = await this.validate(input);
    if (!result.ok) {
      throw new BadRequestException(result.errors.join('; '));
    }
    return result.normalizedState ?? input.recipientStateProvince.trim();
  }
}
