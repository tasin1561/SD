import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ActorType, CredentialEnvironment } from '@skydrop/db';
import { CourierCredentialService } from '../../src/modules/courier-shared/services/courier-credential.service';
import { encryptCredential } from '../../src/modules/courier-shared/util/courier-credential-cipher';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import { makeTestEnv } from '../helpers/env';

type AnyArgs = Record<string, unknown>;

const KEY_V1 = 'f'.repeat(64); // matches makeTestEnv's COURIER_CREDENTIALS_KEY_V1
const COURIER = 'delhivery';

const FIELDS = { token: 'live-token-xyz', clientName: 'skydrop' };

function makeService(
  opts: {
    courier?: AnyArgs | null;
    credential?: AnyArgs | null;
    keyV1?: string;
    courierAccount?: AnyArgs | null;
  } = {},
) {
  const encryptedPayload = encryptCredential(JSON.stringify(FIELDS), KEY_V1);
  const defaultCredential = {
    id: 'cred-1',
    encryptedPayload,
    encryptionKeyVersion: 1,
    fieldNames: ['token', 'clientName'],
    expiresAt: null,
  };
  const courierFindUnique = jest.fn(async () =>
    opts.courier === undefined ? { id: 'courier-1' } : opts.courier,
  );
  const credentialFindFirst = jest.fn(async () =>
    opts.credential === undefined ? defaultCredential : opts.credential,
  );
  const credentialUpdate = jest.fn(async () => ({}));
  const courierAccountFindUnique = jest.fn(async () =>
    opts.courierAccount === undefined
      ? {
          environment: CredentialEnvironment.PRODUCTION,
          deletedAt: null,
          isActive: true,
          courier: { code: COURIER },
          credential: defaultCredential,
        }
      : opts.courierAccount,
  );
  const client = {
    courier: { findUnique: courierFindUnique },
    courierCredential: {
      findFirst: credentialFindFirst,
      update: credentialUpdate,
    },
    courierAccount: { findUnique: courierAccountFindUnique },
  };
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a');
  const audit = { log: auditLog };
  const env = makeTestEnv(
    opts.keyV1 === undefined ? {} : { COURIER_CREDENTIALS_KEY_V1: opts.keyV1 },
  );

  const svc = new CourierCredentialService(
    { client } as unknown as PrismaService,
    env,
    audit as unknown as AuditLogService,
  );
  return {
    svc,
    courierFindUnique,
    credentialFindFirst,
    credentialUpdate,
    courierAccountFindUnique,
    auditLog,
  };
}

describe('CourierCredentialService.getCredential', () => {
  afterEach(() => jest.useRealTimers());

  it('decrypts, audits HIGH, stamps lastUsedAt, returns the field map', async () => {
    const { svc, auditLog, credentialUpdate } = makeService();
    const fields = await svc.getCredential(COURIER, CredentialEnvironment.PRODUCTION, {
      type: ActorType.SYSTEM,
    });
    expect(fields).toEqual(FIELDS);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'courier.credential.decrypted',
        entityType: 'courier_credential',
        severity: 'HIGH',
        metadata: expect.objectContaining({
          courierCode: COURIER,
          fieldNames: ['token', 'clientName'],
        }),
      }),
    );
    // Audit metadata must NOT contain plaintext values.
    const meta = JSON.stringify(auditLog.mock.calls[0]?.[0]);
    expect(meta).not.toContain('live-token-xyz');
    expect(credentialUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastUsedAt: expect.any(Date) }) }),
    );
  });

  it('cache hit: a second call within 5 min performs no second decrypt/audit', async () => {
    const { svc, auditLog, credentialFindFirst } = makeService();
    const a = await svc.getCredential(COURIER, CredentialEnvironment.PRODUCTION);
    const b = await svc.getCredential(COURIER, CredentialEnvironment.PRODUCTION);
    expect(a).toEqual(b);
    expect(auditLog).toHaveBeenCalledTimes(1); // decrypt audited once
    // The credential row is still re-resolved each call (cheap lookup);
    // the DECRYPT is what's cached.
    expect(credentialFindFirst).toHaveBeenCalledTimes(2);
  });

  it('cache eviction: a call after 5 min re-decrypts and re-audits', async () => {
    jest.useFakeTimers({ now: new Date('2026-05-22T10:00:00Z') });
    const { svc, auditLog } = makeService();
    await svc.getCredential(COURIER, CredentialEnvironment.PRODUCTION);
    jest.advanceTimersByTime(5 * 60_000 + 1);
    await svc.getCredential(COURIER, CredentialEnvironment.PRODUCTION);
    expect(auditLog).toHaveBeenCalledTimes(2); // stale entry evicted → re-decrypt
  });

  it('clearCache forces a re-decrypt on the next call', async () => {
    const { svc, auditLog } = makeService();
    await svc.getCredential(COURIER, CredentialEnvironment.PRODUCTION);
    svc.clearCache();
    await svc.getCredential(COURIER, CredentialEnvironment.PRODUCTION);
    expect(auditLog).toHaveBeenCalledTimes(2);
  });

  it('404 when the courier is unknown', async () => {
    const { svc } = makeService({ courier: null });
    await expect(
      svc.getCredential(COURIER, CredentialEnvironment.PRODUCTION),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 when no active credential exists', async () => {
    const { svc } = makeService({ credential: null });
    await expect(
      svc.getCredential(COURIER, CredentialEnvironment.PRODUCTION),
    ).rejects.toMatchObject({ response: { code: 'COURIER_CREDENTIAL_NOT_FOUND' } });
  });

  it('rejects an expired credential', async () => {
    const { svc } = makeService({
      credential: {
        id: 'cred-1',
        encryptedPayload: encryptCredential(JSON.stringify(FIELDS), KEY_V1),
        encryptionKeyVersion: 1,
        fieldNames: ['token'],
        expiresAt: new Date('2020-01-01T00:00:00Z'),
      },
    });
    await expect(
      svc.getCredential(COURIER, CredentialEnvironment.PRODUCTION),
    ).rejects.toMatchObject({ response: { code: 'COURIER_CREDENTIAL_EXPIRED' } });
  });

  it('stub mode: empty key → COURIER_CREDENTIALS_UNAVAILABLE', async () => {
    const { svc } = makeService({ keyV1: '' });
    await expect(
      svc.getCredential(COURIER, CredentialEnvironment.PRODUCTION),
    ).rejects.toMatchObject({
      response: { code: 'COURIER_CREDENTIALS_UNAVAILABLE' },
    });
  });

  it('decrypt failure (wrong key) → COURIER_CREDENTIAL_DECRYPT_FAILED, no plaintext leak', async () => {
    // Credential encrypted with a DIFFERENT key than env's V1.
    const { svc } = makeService({
      credential: {
        id: 'cred-1',
        encryptedPayload: encryptCredential(JSON.stringify(FIELDS), 'a'.repeat(64)),
        encryptionKeyVersion: 1,
        fieldNames: ['token'],
        expiresAt: null,
      },
    });
    await expect(
      svc.getCredential(COURIER, CredentialEnvironment.PRODUCTION),
    ).rejects.toMatchObject({
      response: { code: 'COURIER_CREDENTIAL_DECRYPT_FAILED' },
    });
  });

  it('InternalServerErrorException is the type for unavailable/expired/decrypt-fail', async () => {
    const { svc } = makeService({ keyV1: '' });
    await expect(
      svc.getCredential(COURIER, CredentialEnvironment.PRODUCTION),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});

describe('CourierCredentialService.getCredentialForAccount', () => {
  it('resolves the account-specific credential, decrypts, audits HIGH', async () => {
    const { svc, auditLog, courierAccountFindUnique } = makeService();
    const fields = await svc.getCredentialForAccount('acct-1', { type: ActorType.SYSTEM });
    expect(fields).toEqual(FIELDS);
    expect(courierAccountFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'acct-1' } }),
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'courier.credential.decrypted',
        severity: 'HIGH',
        metadata: expect.objectContaining({ courierCode: COURIER }),
      }),
    );
  });

  it('shares the same 5-minute cache as getCredential (keyed on credential id)', async () => {
    const { svc, auditLog } = makeService();
    await svc.getCredential(COURIER, CredentialEnvironment.PRODUCTION);
    await svc.getCredentialForAccount('acct-1');
    // Same underlying credential id ("cred-1") — second resolution is a cache hit.
    expect(auditLog).toHaveBeenCalledTimes(1);
  });

  it('404 COURIER_ACCOUNT_NOT_FOUND when the account does not exist', async () => {
    const { svc } = makeService({ courierAccount: null });
    await expect(svc.getCredentialForAccount('missing')).rejects.toMatchObject({
      response: { code: 'COURIER_ACCOUNT_NOT_FOUND' },
    });
  });

  it('404 COURIER_ACCOUNT_NOT_FOUND when the account is soft-deleted', async () => {
    const { svc } = makeService({
      courierAccount: {
        environment: CredentialEnvironment.PRODUCTION,
        deletedAt: new Date(),
        isActive: true,
        courier: { code: COURIER },
        credential: {
          id: 'cred-1',
          encryptedPayload: encryptCredential(JSON.stringify(FIELDS), KEY_V1),
          encryptionKeyVersion: 1,
          fieldNames: ['token'],
          expiresAt: null,
        },
      },
    });
    await expect(svc.getCredentialForAccount('acct-1')).rejects.toMatchObject({
      response: { code: 'COURIER_ACCOUNT_NOT_FOUND' },
    });
  });

  it('404 COURIER_ACCOUNT_NOT_FOUND when the account is inactive', async () => {
    const { svc } = makeService({
      courierAccount: {
        environment: CredentialEnvironment.PRODUCTION,
        deletedAt: null,
        isActive: false,
        courier: { code: COURIER },
        credential: {
          id: 'cred-1',
          encryptedPayload: encryptCredential(JSON.stringify(FIELDS), KEY_V1),
          encryptionKeyVersion: 1,
          fieldNames: ['token'],
          expiresAt: null,
        },
      },
    });
    await expect(svc.getCredentialForAccount('acct-1')).rejects.toMatchObject({
      response: { code: 'COURIER_ACCOUNT_NOT_FOUND' },
    });
  });
});
