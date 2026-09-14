import { isIP } from 'node:net';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  Prisma,
  ResellerCreditTrigger,
  ResellerStoreStatus,
  SellerStoreKind,
} from '@skydrop/db';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import {
  FEE_SPLIT_ROUNDING,
  FeeSplitError,
  splitFee,
  validatePercents,
  type DecimalInput,
} from '../terms/fee-split';
import {
  RESELLER_FEE_TYPES,
  feeTypeLabel,
  storePercentField,
  storePercentOf,
  type ResellerFeeType,
  type StorePercents,
} from '../terms/reseller-fee-types';
import {
  TermsRuleError,
  assertTiming,
  creditTriggerLabel,
  shareWords,
  timingWords,
  usesAfterConfirmation,
  type CreditTiming,
} from '../terms/terms-rules';
import { CreditAfterConfirmationService } from './credit-after-confirmation.service';
import { ResellerTermsNotifier } from './reseller-terms-notifier.service';

const D = Prisma.Decimal;

// ── The surface phase 3b calls at order create ─────────────────────────

/** One version as an order snapshots it. Decimals, never floats. */
export interface StoreTermsSnapshot {
  readonly termsVersionId: string;
  readonly storeId: string;
  readonly version: number;
  /** The share of each fee the STORE pays, 0–100. Feed to `splitFeeLines`. */
  readonly storePercents: StorePercents<Prisma.Decimal>;
  readonly storeCredit: CreditTiming;
  readonly sellerCredit: CreditTiming;
  readonly publishedAt: Date;
  /** When the store accepted THIS version; null while it has not. */
  readonly acceptedAt: Date | null;
}

export type TermsReadinessReason =
  | 'NO_TERMS'
  | 'TERMS_NOT_ACCEPTED'
  | 'AFTER_CONFIRMATION_NOT_ENABLED';

export interface TermsReadiness {
  readonly ready: boolean;
  /** The version an order placed now would snapshot; null when there is none. */
  readonly termsVersionId: string | null;
  readonly reasons: readonly TermsReadinessReason[];
  /** The first reason in words — what phase 3b's refusal should say. */
  readonly message: string | null;
}

// ── Views ──────────────────────────────────────────────────────────────

export interface TermsShareView {
  readonly feeType: ResellerFeeType;
  readonly label: string;
  readonly storePercent: string;
  readonly sellerPercent: string;
  readonly words: string;
}

export interface TermsTimingView {
  readonly trigger: ResellerCreditTrigger;
  readonly label: string;
  readonly days: number;
  readonly words: string;
}

export interface TermsAcceptanceView {
  readonly acceptedAt: string;
  readonly acceptedByName: string;
  /** Admin and the store itself see it; the seller does not. */
  readonly ipAddress: string | null;
}

export interface TermsVersionView {
  readonly id: string;
  readonly version: number;
  readonly publishedAt: string;
  readonly publishedBy: ActorType;
  readonly note: string | null;
  readonly shares: readonly TermsShareView[];
  readonly storeCredit: TermsTimingView;
  readonly sellerCredit: TermsTimingView;
  readonly usesAfterConfirmation: boolean;
  readonly acceptance: TermsAcceptanceView | null;
}

export interface FeeExampleView {
  readonly feeType: ResellerFeeType;
  readonly label: string;
  /** What the example is worked on, in words. */
  readonly basis: string;
  readonly feeInr: string;
  readonly storeInr: string;
  readonly sellerInr: string;
}

export interface StoreTermsView {
  readonly storeId: string;
  readonly storeName: string;
  readonly sellerCompanyName: string;
  readonly storeStatus: ResellerStoreStatus;
  readonly current: TermsVersionView | null;
  readonly currentAccepted: boolean;
  /** Every version, newest first (the current one included). */
  readonly history: readonly TermsVersionView[];
  /** Whether Skydrop enabled credit-after-confirmation for this seller. */
  readonly afterConfirmationEnabled: boolean;
  /** Set when the current version uses it while it is off (decision 10). */
  readonly needsRevision: string | null;
  /** The current version worked through example fees; empty when there is none. */
  readonly examples: readonly FeeExampleView[];
  readonly rounding: string;
}

export interface TermsPreview {
  readonly shares: readonly TermsShareView[];
  readonly examples: readonly FeeExampleView[];
  readonly storeCredit: TermsTimingView | null;
  readonly sellerCredit: TermsTimingView | null;
  readonly rounding: string;
}

export interface PublishTermsInput {
  readonly percents: StorePercents<string>;
  readonly storeCredit: CreditTiming;
  readonly sellerCredit: CreditTiming;
  readonly note?: string | null | undefined;
  /**
   * The version the seller was looking at (0 when there was none). A
   * publish landing in between is refused rather than silently stacked.
   */
  readonly basedOnVersion?: number | undefined;
}

const VERSION_INCLUDE = {
  acceptances: {
    take: 1,
    select: {
      id: true,
      acceptedAt: true,
      ipAddress: true,
      storeUser: { select: { fullName: true } },
    },
  },
} as const;

type VersionRow = Prisma.ResellerStoreTermsVersionGetPayload<{ include: typeof VERSION_INCLUDE }>;

type Db = Prisma.TransactionClient;

interface StoreRow {
  readonly id: string;
  readonly sellerId: string;
  readonly name: string;
  readonly displayName: string | null;
  readonly status: ResellerStoreStatus | null;
  readonly seller: { readonly companyName: string };
}

const STORE_SELECT = {
  id: true,
  sellerId: true,
  name: true,
  displayName: true,
  status: true,
  seller: { select: { companyName: true } },
} as const;

/** The example fee used for the percentage-of-something fees. */
const PER_HUNDRED = '100.00';

function percentsOf(row: StorePercents<Prisma.Decimal>): StorePercents<Prisma.Decimal> {
  return {
    deliveryFeeStorePercent: row.deliveryFeeStorePercent,
    returnFeeStorePercent: row.returnFeeStorePercent,
    customerReturnFeeStorePercent: row.customerReturnFeeStorePercent,
    codFeeStorePercent: row.codFeeStorePercent,
    codTaxStorePercent: row.codTaxStorePercent,
    instantPayFeeStorePercent: row.instantPayFeeStorePercent,
  };
}

/** Plain JSON of a version's terms — what the audit's before/after carries. */
function termsContent(
  percents: StorePercents<Prisma.Decimal>,
  storeCredit: CreditTiming,
  sellerCredit: CreditTiming,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const t of RESELLER_FEE_TYPES)
    out[storePercentField(t)] = storePercentOf(percents, t).toFixed(2);
  out.storeCreditTrigger = storeCredit.trigger;
  out.storeCreditDays = storeCredit.days;
  out.sellerCreditTrigger = sellerCredit.trigger;
  out.sellerCreditDays = sellerCredit.days;
  return out;
}

/**
 * RS-4 — a reseller store's TERMS: who pays which Skydrop fee on its
 * orders, and when the store and the seller are credited.
 *
 * ── THE ONLY WRITER ──────────────────────────────────────────────────
 * `publish` is the only writer of `reseller_store_terms_versions` and
 * `accept` the only writer of `reseller_store_terms_acceptances`. Both
 * tables are append-only: nothing here updates or deletes a row, because
 * a store order (phase 3b) snapshots the version id and must never be
 * re-priced by a later edit.
 *
 * ── VERSIONS ARE NUMBERED UNDER A LOCK ───────────────────────────────
 * The next number is read and inserted under `AdvisoryLock.RESELLER_TERMS`
 * (per store), with the unique on (store, version) as the backstop — the
 * read-then-write lesson: a read outside the lock lets two publishes both
 * choose the same number.
 *
 * ── ACCEPTANCE FOLLOWS THE CURRENT VERSION ───────────────────────────
 * A store must accept the version in force before it can order. A newer
 * version supersedes the acceptance of the older one — `acceptedCurrentTerms`
 * asks about the LATEST version only.
 *
 * ── SCOPING ──────────────────────────────────────────────────────────
 * A seller's calls carry their seller id in the WHERE clause; a store
 * user's carry the store id off their TOKEN; the composite FK on an
 * acceptance makes accepting another store's version unrepresentable.
 */
@Injectable()
export class ResellerStoreTermsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly settings: SettingsResolverService,
    private readonly credit: CreditAfterConfirmationService,
    private readonly notifier: ResellerTermsNotifier,
  ) {}

  // ════════════════════════════════════════════════════════════════════
  // The surface phase 3b calls at order create. Pass the order's own
  // transaction as `db` so the read sits inside the same snapshot (and
  // after its FOR SHARE lock on the store row, RS-1).
  // ════════════════════════════════════════════════════════════════════

  /** The version in force for a store (its latest), or null when none was published. */
  async currentTerms(storeId: string, db?: Db): Promise<StoreTermsSnapshot | null> {
    const row = await (db ?? this.prisma.client).resellerStoreTermsVersion.findFirst({
      where: { storeId },
      orderBy: { version: 'desc' },
      include: VERSION_INCLUDE,
    });
    if (row === null) return null;
    return {
      termsVersionId: row.id,
      storeId: row.storeId,
      version: row.version,
      storePercents: percentsOf(row),
      storeCredit: { trigger: row.storeCreditTrigger, days: row.storeCreditDays },
      sellerCredit: { trigger: row.sellerCreditTrigger, days: row.sellerCreditDays },
      publishedAt: row.createdAt,
      acceptedAt: row.acceptances[0]?.acceptedAt ?? null,
    };
  }

  /** Whether the store has accepted the version currently in force. */
  async acceptedCurrentTerms(storeId: string, db?: Db): Promise<boolean> {
    const current = await this.currentTerms(storeId, db);
    return current !== null && current.acceptedAt !== null;
  }

  /**
   * Everything terms-related that stands between a store and a new order.
   * Phase 3b refuses the order when `ready` is false and snapshots
   * `termsVersionId` when it is true.
   */
  async orderReadiness(storeId: string, db?: Db): Promise<TermsReadiness> {
    const current = await this.currentTerms(storeId, db);
    if (current === null) {
      return {
        ready: false,
        termsVersionId: null,
        reasons: ['NO_TERMS'],
        message: 'The seller has not published terms for this store yet.',
      };
    }
    const reasons: TermsReadinessReason[] = [];
    if (current.acceptedAt === null) reasons.push('TERMS_NOT_ACCEPTED');
    if (usesAfterConfirmation([current.storeCredit, current.sellerCredit])) {
      const store = await (db ?? this.prisma.client).sellerStore.findUnique({
        where: { id: storeId },
        select: { sellerId: true },
      });
      if (store === null || !(await this.credit.isEnabled(store.sellerId))) {
        reasons.push('AFTER_CONFIRMATION_NOT_ENABLED');
      }
    }
    const first = reasons[0];
    return {
      ready: reasons.length === 0,
      termsVersionId: current.termsVersionId,
      reasons,
      message:
        first === undefined
          ? null
          : first === 'TERMS_NOT_ACCEPTED'
            ? `The store has not accepted version ${current.version} of the terms yet.`
            : `Version ${current.version} credits a party after confirmation, which Skydrop has not enabled for this seller — the seller must publish new terms.`,
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // Views
  // ════════════════════════════════════════════════════════════════════

  async viewForSeller(sellerId: string, storeId: string): Promise<StoreTermsView> {
    return this.view(await this.sellerStore(sellerId, storeId), { showIp: false });
  }

  async viewForAdmin(storeId: string): Promise<StoreTermsView> {
    const store = await this.prisma.client.sellerStore.findFirst({
      where: { id: storeId, kind: SellerStoreKind.RESELLER, deletedAt: null },
      select: STORE_SELECT,
    });
    if (store === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such reseller store' });
    }
    return this.view(store, { showIp: true });
  }

  /** The store's own view. The id is the TOKEN's, never the request's. */
  async viewForStore(user: AuthenticatedStoreUser): Promise<StoreTermsView> {
    const store = await this.prisma.client.sellerStore.findFirst({
      where: {
        id: user.storeId,
        sellerId: user.sellerId,
        kind: SellerStoreKind.RESELLER,
        deletedAt: null,
      },
      select: STORE_SELECT,
    });
    if (store === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such reseller store' });
    }
    return this.view(store, { showIp: true });
  }

  /**
   * The seller's draft, worked through the SAME arithmetic a published
   * version is — the Terms tab's live example is served from here, never
   * computed in the browser.
   */
  async preview(
    sellerId: string,
    storeId: string,
    draft: {
      percents: StorePercents<string>;
      storeCredit?: CreditTiming | undefined;
      sellerCredit?: CreditTiming | undefined;
    },
  ): Promise<TermsPreview> {
    const store = await this.sellerStore(sellerId, storeId);
    const percents = this.validPercents(draft.percents);
    const names = this.names(store);
    return {
      shares: this.shares(percents, names),
      examples: await this.examples(store.sellerId, percents),
      storeCredit:
        draft.storeCredit === undefined
          ? null
          : this.timing(this.validTiming(draft.storeCredit, 'store'), names.store),
      sellerCredit:
        draft.sellerCredit === undefined
          ? null
          : this.timing(this.validTiming(draft.sellerCredit, 'seller'), names.seller),
      rounding: FEE_SPLIT_ROUNDING,
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // Writes
  // ════════════════════════════════════════════════════════════════════

  async publish(
    sellerId: string,
    storeId: string,
    input: PublishTermsInput,
    actor: { sellerUserId: string; name: string },
  ): Promise<StoreTermsView> {
    const store = await this.sellerStore(sellerId, storeId);
    if (
      store.status === ResellerStoreStatus.CLOSED ||
      store.status === ResellerStoreStatus.REJECTED
    ) {
      throw new ConflictException({
        code: 'STORE_IS_FINAL',
        message: 'A closed or rejected store takes no new terms.',
      });
    }
    const percents = this.validPercents(input.percents);
    const storeCredit = this.validTiming(input.storeCredit, 'store');
    const sellerCredit = this.validTiming(input.sellerCredit, 'seller');
    if (
      usesAfterConfirmation([storeCredit, sellerCredit]) &&
      !(await this.credit.isEnabled(sellerId))
    ) {
      throw new ConflictException({
        code: 'CREDIT_AFTER_CONFIRMATION_NOT_ENABLED',
        message:
          'Crediting a party after confirmation fronts money before the customer pays, and Skydrop has not enabled it for your account. Choose another timing, or ask Skydrop to enable it.',
      });
    }
    const note = input.note?.trim() ?? '';
    const content = termsContent(percents, storeCredit, sellerCredit);

    let result: { created: VersionRow; previous: VersionRow | null };
    try {
      result = await this.prisma.client.$transaction(async (tx) => {
        await takeAdvisoryLock(tx, AdvisoryLock.RESELLER_TERMS, storeId);
        const previous = await tx.resellerStoreTermsVersion.findFirst({
          where: { storeId },
          orderBy: { version: 'desc' },
          include: VERSION_INCLUDE,
        });
        const currentNumber = previous?.version ?? 0;
        if (input.basedOnVersion !== undefined && input.basedOnVersion !== currentNumber) {
          throw new ConflictException({
            code: 'TERMS_CHANGED',
            message: `Version ${currentNumber} was published while you were editing. Reload, check it, and publish again.`,
          });
        }
        if (
          previous !== null &&
          JSON.stringify(
            termsContent(
              percentsOf(previous),
              { trigger: previous.storeCreditTrigger, days: previous.storeCreditDays },
              { trigger: previous.sellerCreditTrigger, days: previous.sellerCreditDays },
            ),
          ) === JSON.stringify(content)
        ) {
          throw new ConflictException({
            code: 'TERMS_UNCHANGED',
            message: `These are the terms already in force (version ${previous.version}); there is nothing new to publish.`,
          });
        }
        const created = await tx.resellerStoreTermsVersion.create({
          data: {
            storeId,
            version: currentNumber + 1,
            ...percents,
            storeCreditTrigger: storeCredit.trigger,
            storeCreditDays: storeCredit.days,
            sellerCreditTrigger: sellerCredit.trigger,
            sellerCreditDays: sellerCredit.days,
            note: note === '' ? null : note,
            createdByActorType: ActorType.SELLER,
            createdById: actor.sellerUserId,
          },
          include: VERSION_INCLUDE,
        });
        return { created, previous };
      });
    } catch (err) {
      // The unique on (store, version) — only reachable if the lock were
      // bypassed; answered as the race it would be.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'TERMS_CHANGED',
          message: 'Another version was published at the same moment. Reload and try again.',
        });
      }
      throw err;
    }

    const { created, previous } = result;
    await this.audit.log({
      actorType: ActorType.SELLER,
      actorId: actor.sellerUserId,
      sellerId,
      action: 'reseller_store.terms_published',
      entityType: 'seller_store',
      entityId: storeId,
      severity: 'MEDIUM',
      changes: {
        before:
          previous === null
            ? null
            : {
                version: previous.version,
                ...termsContent(
                  percentsOf(previous),
                  { trigger: previous.storeCreditTrigger, days: previous.storeCreditDays },
                  { trigger: previous.sellerCreditTrigger, days: previous.sellerCreditDays },
                ),
              },
        after: { version: created.version, ...content },
      },
      metadata: { termsVersionId: created.id, note: note === '' ? null : note },
    });
    await this.notifier.published({
      storeId,
      termsVersionId: created.id,
      version: created.version,
      storeName: store.displayName ?? store.name,
      sellerName: store.seller.companyName,
    });
    return this.view(store, { showIp: false });
  }

  /**
   * The store accepts the version in force. Idempotent: a version already
   * accepted (by this person or a colleague) answers with the view, and the
   * unique on `terms_version_id` makes two concurrent clicks one row.
   */
  async accept(
    user: AuthenticatedStoreUser,
    termsVersionId: string,
    context: { ip: string | null | undefined; userAgent: string | null | undefined },
  ): Promise<StoreTermsView> {
    const ip =
      context.ip !== null && context.ip !== undefined && isIP(context.ip) !== 0 ? context.ip : null;
    const userAgent = context.userAgent?.slice(0, 500) ?? null;

    let accepted: { id: string; version: number } | null = null;
    try {
      accepted = await this.prisma.client.$transaction(async (tx) => {
        await takeAdvisoryLock(tx, AdvisoryLock.RESELLER_TERMS, user.storeId);
        // Scoped by the TOKEN's store: another store's version id is a 404.
        const version = await tx.resellerStoreTermsVersion.findFirst({
          where: { id: termsVersionId, storeId: user.storeId },
          include: VERSION_INCLUDE,
        });
        if (version === null) {
          throw new NotFoundException({
            code: 'TERMS_VERSION_NOT_FOUND',
            message: 'No such terms version for this store.',
          });
        }
        const latest = await tx.resellerStoreTermsVersion.findFirst({
          where: { storeId: user.storeId },
          orderBy: { version: 'desc' },
          select: { id: true, version: true },
        });
        if (latest !== null && latest.id !== version.id) {
          throw new ConflictException({
            code: 'TERMS_NOT_CURRENT',
            message: `Version ${version.version} has been replaced by version ${latest.version}. Read the new version and accept that one.`,
          });
        }
        if (version.acceptances.length > 0) return null;
        const row = await tx.resellerStoreTermsAcceptance.create({
          data: {
            storeId: user.storeId,
            termsVersionId: version.id,
            storeUserId: user.id,
            ipAddress: ip,
            userAgent,
          },
          select: { id: true },
        });
        return { id: row.id, version: version.version };
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      accepted = null; // a colleague's click won; the version is accepted either way
    }

    const store = await this.prisma.client.sellerStore.findFirst({
      where: { id: user.storeId, kind: SellerStoreKind.RESELLER },
      select: STORE_SELECT,
    });
    if (store === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such reseller store' });
    }
    if (accepted !== null) {
      await this.audit.log({
        actorType: ActorType.STORE,
        actorId: user.id,
        sellerId: store.sellerId,
        action: 'reseller_store.terms_accepted',
        entityType: 'reseller_store_terms_version',
        entityId: termsVersionId,
        severity: 'MEDIUM',
        metadata: {
          storeId: store.id,
          version: accepted.version,
          acceptanceId: accepted.id,
          ipAddress: ip,
        },
      });
      await this.notifier.accepted({
        sellerId: store.sellerId,
        storeId: store.id,
        storeName: store.displayName ?? store.name,
        version: accepted.version,
        acceptanceId: accepted.id,
        acceptedByName: user.fullName,
      });
    }
    return this.view(store, { showIp: true });
  }

  // ════════════════════════════════════════════════════════════════════
  // internals
  // ════════════════════════════════════════════════════════════════════

  private async sellerStore(sellerId: string, storeId: string): Promise<StoreRow> {
    const store = await this.prisma.client.sellerStore.findFirst({
      where: { id: storeId, sellerId, kind: SellerStoreKind.RESELLER, deletedAt: null },
      select: STORE_SELECT,
    });
    if (store === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such reseller store' });
    }
    return store;
  }

  private async view(store: StoreRow, opts: { showIp: boolean }): Promise<StoreTermsView> {
    const rows = await this.prisma.client.resellerStoreTermsVersion.findMany({
      where: { storeId: store.id },
      orderBy: { version: 'desc' },
      take: 100,
      include: VERSION_INCLUDE,
    });
    const names = this.names(store);
    const history = rows.map((r) => this.versionView(r, names, opts));
    const current = history[0] ?? null;
    const currentRow = rows[0];
    const enabled = await this.credit.isEnabled(store.sellerId);
    const needsRevision =
      current !== null && current.usesAfterConfirmation && !enabled
        ? `Version ${current.version} credits a party after confirmation, which Skydrop has not enabled for ${names.seller}. The store cannot place new orders until ${names.seller} publishes new terms and the store accepts them.`
        : null;
    return {
      storeId: store.id,
      storeName: names.store,
      sellerCompanyName: names.seller,
      storeStatus: store.status ?? ResellerStoreStatus.PENDING_SELLER_APPROVAL,
      current,
      currentAccepted: current !== null && current.acceptance !== null,
      history,
      afterConfirmationEnabled: enabled,
      needsRevision,
      examples:
        currentRow === undefined ? [] : await this.examples(store.sellerId, percentsOf(currentRow)),
      rounding: FEE_SPLIT_ROUNDING,
    };
  }

  private versionView(
    row: VersionRow,
    names: { store: string; seller: string },
    opts: { showIp: boolean },
  ): TermsVersionView {
    const storeCredit = { trigger: row.storeCreditTrigger, days: row.storeCreditDays };
    const sellerCredit = { trigger: row.sellerCreditTrigger, days: row.sellerCreditDays };
    const acceptance = row.acceptances[0];
    return {
      id: row.id,
      version: row.version,
      publishedAt: row.createdAt.toISOString(),
      publishedBy: row.createdByActorType,
      note: row.note,
      shares: this.shares(percentsOf(row), names),
      storeCredit: this.timing(storeCredit, names.store),
      sellerCredit: this.timing(sellerCredit, names.seller),
      usesAfterConfirmation: usesAfterConfirmation([storeCredit, sellerCredit]),
      acceptance:
        acceptance === undefined
          ? null
          : {
              acceptedAt: acceptance.acceptedAt.toISOString(),
              acceptedByName: acceptance.storeUser.fullName,
              ipAddress: opts.showIp ? acceptance.ipAddress : null,
            },
    };
  }

  private shares(
    percents: StorePercents<Prisma.Decimal>,
    names: { store: string; seller: string },
  ): TermsShareView[] {
    return RESELLER_FEE_TYPES.map((feeType) => {
      const store = storePercentOf(percents, feeType);
      const seller = new D(100).sub(store);
      return {
        feeType,
        label: feeTypeLabel(feeType),
        storePercent: store.toFixed(2),
        sellerPercent: seller.toFixed(2),
        words: shareWords(feeType, store, seller, names),
      };
    });
  }

  private timing(timing: CreditTiming, partyName: string): TermsTimingView {
    return {
      trigger: timing.trigger,
      label: creditTriggerLabel(timing.trigger),
      days: timing.days,
      words: timingWords(timing, partyName),
    };
  }

  /**
   * Each fee worked through one example. The flat fees use what THIS seller
   * is actually charged (their SET-1 value); the percentage-shaped fees use
   * ₹100 of the fee. A settings read that fails costs the example its real
   * figure, never the screen (fails open to the seeded defaults).
   */
  private async examples(
    sellerId: string,
    percents: StorePercents<Prisma.Decimal>,
  ): Promise<FeeExampleView[]> {
    const [delivery, ret, customerReturn] = await Promise.all([
      this.flatFee(sellerId, 'pricing.flat_delivery_fee_inr', '200.00'),
      this.flatFee(sellerId, 'pricing.flat_rto_fee_inr', '30.00'),
      this.flatFee(sellerId, 'pricing.customer_return_fee_inr', '200.00'),
    ]);
    const basisFor = (feeType: ResellerFeeType): { basis: string; amount: DecimalInput } => {
      switch (feeType) {
        case 'DELIVERY_FEE':
          return { basis: 'The delivery fee on one parcel', amount: delivery };
        case 'RETURN_FEE':
          return { basis: 'The return fee on one returned parcel', amount: ret };
        case 'CUSTOMER_RETURN_FEE':
          return { basis: 'The customer return fee on one parcel', amount: customerReturn };
        case 'COD_FEE':
          return { basis: 'Every ₹100 of COD fee', amount: PER_HUNDRED };
        case 'COD_TAX':
          return { basis: 'Every ₹100 of COD tax', amount: PER_HUNDRED };
        case 'INSTANT_PAY_FEE':
          return { basis: 'Every ₹100 of Instant Pay fee', amount: PER_HUNDRED };
        default: {
          const exhaustive: never = feeType;
          throw new Error(`Unhandled reseller fee type: ${String(exhaustive)}`);
        }
      }
    };
    return RESELLER_FEE_TYPES.map((feeType) => {
      const { basis, amount } = basisFor(feeType);
      const split = splitFee(amount, storePercentOf(percents, feeType));
      return {
        feeType,
        label: feeTypeLabel(feeType),
        basis,
        feeInr: split.amountInr.toFixed(2),
        storeInr: split.storeInr.toFixed(2),
        sellerInr: split.sellerInr.toFixed(2),
      };
    });
  }

  private async flatFee(sellerId: string, key: string, fallback: string): Promise<string> {
    try {
      const r = await this.settings.resolve(sellerId, key);
      const v =
        typeof r.value === 'string'
          ? r.value
          : typeof r.value === 'number'
            ? String(r.value)
            : null;
      if (v !== null && /^\d+(\.\d+)?$/.test(v)) {
        return new D(v).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
      }
    } catch {
      // fall through to the seeded default
    }
    return fallback;
  }

  private names(store: StoreRow): { store: string; seller: string } {
    return { store: store.displayName ?? store.name, seller: store.seller.companyName };
  }

  private validPercents(input: StorePercents<string>): StorePercents<Prisma.Decimal> {
    try {
      return validatePercents(input);
    } catch (err) {
      if (err instanceof FeeSplitError) {
        throw new BadRequestException({ code: err.code, message: err.message });
      }
      throw err;
    }
  }

  private validTiming(timing: CreditTiming, party: 'store' | 'seller'): CreditTiming {
    try {
      assertTiming(timing, party);
      return timing;
    } catch (err) {
      if (err instanceof TermsRuleError) {
        throw new BadRequestException({ code: err.code, message: err.message });
      }
      throw err;
    }
  }
}
