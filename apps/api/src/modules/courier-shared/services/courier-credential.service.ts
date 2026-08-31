import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, CredentialEnvironment } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EnvService } from '../../../config/env.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CourierCredentialCipherError, decryptCredential } from '../util/courier-credential-cipher';

/** Plaintext credentials are NEVER cached longer than this (CUR-1 /
 *  credential rule #3). */
const CACHE_TTL_MS = 5 * 60_000;

interface CacheEntry {
  fields: Readonly<Record<string, string>>;
  cachedAt: number;
}

/**
 * WHY a credential was decrypted, not just who.
 *
 * The amended CUR-10 (2026-08-05) turns on exactly one distinction: a
 * courier call is either operator-triggered, or fired by a runner whose
 * write channel an operator enabled. Before this, every decrypt audited
 * as `SYSTEM` with a null actor id — so the audit log could show THAT a
 * call happened and never which branch of the invariant it took. An
 * invariant that cannot be evidenced has not really been adopted.
 *
 * Modelled as a discriminated union so the branches cannot be mixed: a
 * RUNNER cannot carry a staff id, an OPERATOR cannot omit one.
 */
export type CourierCallTrigger =
  /** A human clicked something. `staffId` is who. */
  | { readonly kind: 'OPERATOR'; readonly staffId: string }
  /** A cron or queue worker. `job` names it; `runId` pins the occurrence. */
  | { readonly kind: 'RUNNER'; readonly job: string; readonly runId?: string | null | undefined }
  /** Inbound from the courier. `source` names the channel. */
  | { readonly kind: 'WEBHOOK'; readonly source: string };

export interface CourierCredentialActor {
  type: ActorType;
  id?: string | null;
  /** Optional so a missed call site still works — see `courierActor`. */
  trigger?: CourierCallTrigger;
}

/**
 * Build an actor from its trigger. Use these rather than hand-rolling
 * the object: the mapping from trigger to `ActorType`/`id` is a decision
 * (an operator's decrypt is attributed to the STAFF actor; a runner's to
 * SYSTEM) and open-coding it at ten call sites is how two of them
 * eventually disagree.
 */
export const courierActor = {
  operator(staffId: string): CourierCredentialActor {
    return { type: ActorType.STAFF, id: staffId, trigger: { kind: 'OPERATOR', staffId } };
  },
  runner(job: string, runId?: string | null): CourierCredentialActor {
    return { type: ActorType.SYSTEM, id: null, trigger: { kind: 'RUNNER', job, runId } };
  },
  webhook(source: string): CourierCredentialActor {
    return { type: ActorType.SYSTEM, id: null, trigger: { kind: 'WEBHOOK', source } };
  },
} as const;

/** Flattened for the audit row's metadata — one shape, whatever the branch. */
export function describeTrigger(trigger: CourierCallTrigger | undefined): {
  triggerKind: string;
  triggerDetail: string | null;
} {
  if (trigger === undefined) {
    // The default-SYSTEM path. Named rather than left blank so an
    // unattributed decrypt is searchable instead of merely absent.
    return { triggerKind: 'UNATTRIBUTED', triggerDetail: null };
  }
  switch (trigger.kind) {
    case 'OPERATOR':
      return { triggerKind: 'OPERATOR', triggerDetail: trigger.staffId };
    case 'RUNNER':
      return {
        triggerKind: 'RUNNER',
        triggerDetail: trigger.runId == null ? trigger.job : `${trigger.job}:${trigger.runId}`,
      };
    case 'WEBHOOK':
      return { triggerKind: 'WEBHOOK', triggerDetail: trigger.source };
  }
}

/**
 * Module 9 — courier credential decryption (CUR-1, credential rules
 * #1/#2/#3).
 *
 *  - The AES-256-GCM key is NEVER in the DB — only in
 *    `COURIER_CREDENTIALS_KEY_V<version>` env vars, resolved via
 *    `EnvService.courierCredentialsKey(version)` keyed on the row's
 *    `encryptionKeyVersion` (rule #1).
 *  - Every actual DECRYPT writes an `audit_logs` row BEFORE the
 *    plaintext is returned (rule #2). A cache HIT performs no decrypt
 *    and so writes no audit row — the decrypt was audited when the
 *    entry was cached.
 *  - Plaintext is cached at most `CACHE_TTL_MS` (5 min, rule #3); a
 *    stale entry is evicted on read. Plaintext is NEVER logged and
 *    NEVER returned in an API response (rule #2 — callers must not
 *    serialize it).
 *
 * Stub mode: when the version's key env var is empty, the courier is
 * running credential-free (empty `courier.delhivery_api_base_url`) —
 * `getCredential` throws COURIER_CREDENTIALS_UNAVAILABLE so the caller
 * can route to stub behaviour rather than a hard 500.
 */
@Injectable()
export class CourierCredentialService {
  private readonly logger = new Logger(CourierCredentialService.name);
  /** credentialId → cached plaintext field map. */
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Resolve + decrypt the ACTIVE credential for a courier + environment.
   * Legacy/default-account path: resolves whichever credential
   * `findFirst` returns for the (courier, environment) pair. Before R1
   * this was necessarily the platform's ONE active credential for that
   * pair; now that CourierAccount allows several, prefer
   * `getCredentialForAccount` for any multi-account-aware caller — this
   * method stays for stub-mode / single-account setups where no
   * CourierAccount has been configured yet.
   */
  async getCredential(
    courierCode: string,
    environment: CredentialEnvironment,
    actor: CourierCredentialActor = { type: ActorType.SYSTEM },
  ): Promise<Readonly<Record<string, string>>> {
    const courier = await this.prisma.client.courier.findUnique({
      where: { code: courierCode },
      select: { id: true },
    });
    if (!courier) {
      throw new NotFoundException({
        code: 'COURIER_NOT_FOUND',
        message: `Courier ${courierCode} not found`,
      });
    }
    const credential = await this.prisma.client.courierCredential.findFirst({
      where: {
        courierId: courier.id,
        environment,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        encryptedPayload: true,
        encryptionKeyVersion: true,
        fieldNames: true,
        expiresAt: true,
      },
    });
    if (!credential) {
      throw new NotFoundException({
        code: 'COURIER_CREDENTIAL_NOT_FOUND',
        message: `No active ${environment} credential for courier ${courierCode}`,
      });
    }
    return this.resolveAndDecrypt(credential, courierCode, environment, actor);
  }

  /**
   * THE resolution point. Every courier call goes through here.
   *
   * Three cases, in order, and the ordering is the whole point:
   *
   *   1. An explicit account — the caller already routed (AWB
   *      generation, an operator acting on one account). Use exactly
   *      that credential, or fail. Never silently substitute another:
   *      that is the bug this exists to remove.
   *   2. No account named, but accounts EXIST — use the default one for
   *      this (courier, environment). Exactly one is enforced by a
   *      partial unique index, so this is deterministic.
   *   3. No accounts configured at all — the legacy `findFirst`. This is
   *      what production runs today with one credential and zero
   *      CourierAccount rows, and it must keep working unchanged.
   *
   * Case 2 is what makes adding a second account safe: the moment any
   * account exists, every call is account-scoped, so there is no window
   * where some paths route and others pick whatever `findFirst` returns.
   *
   * The old `getCredential` is deliberately NOT deleted — it is case 3,
   * and keeping it named separately is what lets the threading spec tell
   * "resolved through an account" apart from "did not try".
   */
  async resolveCredential(
    courierCode: string,
    environment: CredentialEnvironment,
    courierAccountId: string | null,
    actor: CourierCredentialActor = { type: ActorType.SYSTEM },
  ): Promise<Readonly<Record<string, string>>> {
    if (courierAccountId !== null) {
      return this.getCredentialForAccount(courierAccountId, actor);
    }

    const courier = await this.prisma.client.courier.findUnique({
      where: { code: courierCode },
      select: { id: true },
    });
    if (!courier) {
      throw new NotFoundException({
        code: 'COURIER_NOT_FOUND',
        message: `Courier ${courierCode} not found`,
      });
    }

    const fallback = await this.prisma.client.courierAccount.findFirst({
      where: {
        courierId: courier.id,
        environment,
        isDefault: true,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (fallback) return this.getCredentialForAccount(fallback.id, actor);

    // No accounts at all. If some exist for this pair but none is
    // default, that is a configuration error worth saying out loud
    // rather than resolving to an arbitrary one.
    const anyAccount = await this.prisma.client.courierAccount.count({
      where: { courierId: courier.id, environment, isActive: true, deletedAt: null },
    });
    if (anyAccount > 0) {
      throw new NotFoundException({
        code: 'NO_DEFAULT_COURIER_ACCOUNT',
        message:
          `${courierCode} has ${anyAccount} active ${environment} account(s) but none marked default, ` +
          'and this call named no account. Mark one default rather than letting the call pick.',
      });
    }

    return this.getCredential(courierCode, environment, actor);
  }

  /**
   * Resolve + decrypt the credential belonging to a SPECIFIC
   * CourierAccount (R1 — the multi-account-aware path). Used once a
   * caller has already picked an account via
   * `CourierAccountRoutingService.selectAccount`.
   */
  async getCredentialForAccount(
    courierAccountId: string,
    actor: CourierCredentialActor = { type: ActorType.SYSTEM },
  ): Promise<Readonly<Record<string, string>>> {
    const account = await this.prisma.client.courierAccount.findUnique({
      where: { id: courierAccountId },
      select: {
        environment: true,
        deletedAt: true,
        isActive: true,
        courier: { select: { code: true } },
        credential: {
          select: {
            id: true,
            encryptedPayload: true,
            encryptionKeyVersion: true,
            fieldNames: true,
            expiresAt: true,
          },
        },
      },
    });
    if (!account || account.deletedAt !== null || !account.isActive) {
      throw new NotFoundException({
        code: 'COURIER_ACCOUNT_NOT_FOUND',
        message: `Courier account ${courierAccountId} not found or inactive`,
      });
    }
    if (account.credential === null) {
      // A manual courier holds none — there is no API to authenticate
      // against. Reaching here means something tried to make a wire
      // call for a parcel that was placed by telephone, which is worth
      // saying out loud rather than failing on a null.
      throw new NotFoundException({
        code: 'COURIER_ACCOUNT_HAS_NO_CREDENTIAL',
        message: `Courier account ${courierAccountId} is a manual courier and holds no credentials`,
      });
    }
    return this.resolveAndDecrypt(
      account.credential,
      account.courier.code,
      account.environment,
      actor,
    );
  }

  /** Drop all cached plaintext — for credential rotation / tests. */
  clearCache(): void {
    this.cache.clear();
  }

  // ── internals ──

  private async resolveAndDecrypt(
    credential: {
      id: string;
      encryptedPayload: string;
      encryptionKeyVersion: number;
      fieldNames: string[];
      expiresAt: Date | null;
    },
    courierCode: string,
    environment: CredentialEnvironment,
    actor: CourierCredentialActor,
  ): Promise<Readonly<Record<string, string>>> {
    if (credential.expiresAt !== null && credential.expiresAt.getTime() <= Date.now()) {
      throw new InternalServerErrorException({
        code: 'COURIER_CREDENTIAL_EXPIRED',
        message: `The active ${environment} credential for ${courierCode} has expired`,
      });
    }

    // Cache-first (≤5 min, rule #3) — a hit performs no decrypt.
    const cached = this.cache.get(credential.id);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.fields;
    }
    this.cache.delete(credential.id); // evict stale

    const key = this.env.courierCredentialsKey(credential.encryptionKeyVersion);
    if (key === '') {
      throw new InternalServerErrorException({
        code: 'COURIER_CREDENTIALS_UNAVAILABLE',
        message: `COURIER_CREDENTIALS_KEY_V${credential.encryptionKeyVersion} is not configured — running credential-free (stub mode)`,
      });
    }

    let fields: Record<string, string>;
    try {
      const plaintext = decryptCredential(credential.encryptedPayload, key);
      const parsed: unknown = JSON.parse(plaintext);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new CourierCredentialCipherError('decrypted credential payload is not a JSON object');
      }
      fields = {};
      for (const [k, v] of Object.entries(parsed)) {
        fields[k] = typeof v === 'string' ? v : String(v);
      }
    } catch (err) {
      // Never leak ciphertext / key / plaintext detail.
      this.logger.error(
        { credentialId: credential.id, courierCode, environment },
        'Courier credential decryption failed',
      );
      throw new InternalServerErrorException({
        code: 'COURIER_CREDENTIAL_DECRYPT_FAILED',
        message:
          err instanceof CourierCredentialCipherError
            ? err.message
            : 'Courier credential decryption failed',
      });
    }

    // Rule #2: audit the decrypt BEFORE returning plaintext. Metadata
    // carries only field NAMES, never values.
    await this.audit.log({
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: 'courier.credential.decrypted',
      entityType: 'courier_credential',
      entityId: credential.id,
      severity: 'HIGH',
      metadata: {
        courierCode,
        environment,
        encryptionKeyVersion: credential.encryptionKeyVersion,
        fieldNames: credential.fieldNames,
        ...describeTrigger(actor.trigger),
      },
    });

    await this.prisma.client.courierCredential.update({
      where: { id: credential.id },
      data: { lastUsedAt: new Date() },
    });

    const frozen = Object.freeze({ ...fields });
    this.cache.set(credential.id, { fields: frozen, cachedAt: Date.now() });
    return frozen;
  }
}
