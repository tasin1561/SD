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

export interface CourierCredentialActor {
  type: ActorType;
  id?: string | null;
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
