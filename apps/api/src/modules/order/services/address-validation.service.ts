import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

const ALLOWED_STATES_SETTING_KEY = 'ops.allowed_indian_states';
const STATES_CACHE_TTL_MS = 5 * 60 * 1000; // 5-min window (codebase convention)

/** Indian PIN: 6 digits, first 1-9. */
const PIN_RE = /^[1-9][0-9]{5}$/;
/** E.164 (CLAUDE.md: +91…, +880…). Same shape CustomerService enforces. */
const E164_RE = /^\+[1-9]\d{6,14}$/;

/**
 * The same state, written the way India actually writes it.
 *
 * `ops.allowed_indian_states` holds the 36 canonical modern names, and
 * the check was an exact (case-insensitive) match against them. That was
 * fine while nothing supplied a state — the seller form stopped asking
 * in 2026-08 (ORD-5). It stopped being fine when the importer started
 * accepting Delhivery's bulk template, where `*Shipping State` is
 * MANDATORY and is therefore populated on every single row: a file
 * saying `Orissa`, `Pondicherry`, `J&K` or `KA` would have failed every
 * order in it, for a state we serve, written a way half the country
 * still writes it.
 *
 * These are RENAMES and abbreviations of states we already allow — never
 * a way in for one we do not. The canonical name is what gets persisted,
 * exactly as a canonical match does. Punctuation and `&` are handled by
 * `normalizeStateKey` rather than by an entry each, so `Jammu & Kashmir`,
 * `Jammu and Kashmir` and `JAMMU-AND-KASHMIR` are one key.
 */
const STATE_ALIASES: Record<string, string> = {
  // Renames the Union of India has made, still in wide use.
  orissa: 'Odisha',
  pondicherry: 'Puducherry',
  puduchery: 'Puducherry',
  uttaranchal: 'Uttarakhand',
  // Delhi, in its several administrative spellings.
  'new delhi': 'Delhi',
  'nct of delhi': 'Delhi',
  'delhi nct': 'Delhi',
  'national capital territory of delhi': 'Delhi',
  // The 2020 merger — either half alone still names the merged UT.
  'dadra and nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu',
  'daman and diu': 'Dadra and Nagar Haveli and Daman and Diu',
  // Common shortenings.
  'andaman and nicobar': 'Andaman and Nicobar Islands',
  'andaman nicobar': 'Andaman and Nicobar Islands',
  'jammu kashmir': 'Jammu and Kashmir',
  'j k': 'Jammu and Kashmir',
  // Two-letter codes, as a spreadsheet column often carries them.
  ap: 'Andhra Pradesh',
  ar: 'Arunachal Pradesh',
  as: 'Assam',
  br: 'Bihar',
  cg: 'Chhattisgarh',
  ga: 'Goa',
  gj: 'Gujarat',
  hr: 'Haryana',
  hp: 'Himachal Pradesh',
  jh: 'Jharkhand',
  ka: 'Karnataka',
  kl: 'Kerala',
  mp: 'Madhya Pradesh',
  mh: 'Maharashtra',
  mn: 'Manipur',
  ml: 'Meghalaya',
  mz: 'Mizoram',
  nl: 'Nagaland',
  od: 'Odisha',
  or: 'Odisha',
  pb: 'Punjab',
  rj: 'Rajasthan',
  sk: 'Sikkim',
  tn: 'Tamil Nadu',
  tg: 'Telangana',
  ts: 'Telangana',
  tr: 'Tripura',
  up: 'Uttar Pradesh',
  uk: 'Uttarakhand',
  ut: 'Uttarakhand',
  wb: 'West Bengal',
  an: 'Andaman and Nicobar Islands',
  ch: 'Chandigarh',
  dn: 'Dadra and Nagar Haveli and Daman and Diu',
  dd: 'Dadra and Nagar Haveli and Daman and Diu',
  dl: 'Delhi',
  jk: 'Jammu and Kashmir',
  la: 'Ladakh',
  ld: 'Lakshadweep',
  py: 'Puducherry',
};

/** Case-, punctuation- and `&`-insensitive key for a state name. */
function normalizeStateKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface RecipientAddressInput {
  recipientPhoneE164: string;
  recipientAltPhoneE164?: string | null;
  recipientPostalCode: string;
  recipientStateProvince?: string | undefined;
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
        if (typeof s === 'string') byLower.set(normalizeStateKey(s), s);
      }
    }
    // An alias only ever resolves to a state the LIST already allows —
    // it is another spelling of something we serve, never a way in for
    // something we do not.
    if (byLower.size > 0) {
      for (const [alias, canonical] of Object.entries(STATE_ALIASES)) {
        const known = byLower.get(normalizeStateKey(canonical));
        if (known !== undefined && !byLower.has(alias)) byLower.set(alias, known);
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
    const suppliedState = input.recipientStateProvince?.trim() ?? '';
    if (suppliedState === '') {
      // The seller form no longer asks for a state: Delhivery routes on
      // the PIN and resolves the locality itself. ORD-5's membership
      // check therefore cannot run for these orders — it is not being
      // bypassed, there is simply nothing to check. An order that DOES
      // carry a state is still validated, so CSV imports and the admin
      // path keep the guard.
      normalizedState = '';
    } else if (states.size > 0) {
      const canonical = states.get(normalizeStateKey(suppliedState));
      if (canonical) {
        normalizedState = canonical;
      } else {
        errors.push(`"${suppliedState}" is not an allowed Indian state/UT`);
      }
    } else {
      // List unavailable — accept the value as-is (soft).
      normalizedState = suppliedState;
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
    return result.normalizedState ?? input.recipientStateProvince?.trim() ?? '';
  }
}
