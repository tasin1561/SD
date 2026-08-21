import { CourierAccountAdminService } from '../../src/modules/courier-account-admin/services/courier-account-admin.service';
import { decryptCredential } from '../../src/modules/courier-shared/util/courier-credential-cipher';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import { makeTestEnv } from '../helpers/env';

type AnyArgs = Record<string, unknown>;

const KEY_V1 = 'f'.repeat(64);

function makeService(
  opts: {
    courier?: AnyArgs | null;
    existingAccount?: AnyArgs | null;
    existingSeller?: AnyArgs | null;
    existingLink?: AnyArgs | null;
    /** The credential an adopt call finds; null = none adoptable. */
    adoptable?: AnyArgs | null;
    keyV1?: string;
  } = {},
) {
  const courierFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.courier === undefined ? { id: 'courier-1' } : opts.courier,
  );
  const credentialCreate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (a) => ({
    id: 'cred-new',
    ...(a.data as AnyArgs),
  }));
  // Adopting an EXISTING credential rather than minting one. Null means
  // "no such adoptable credential" — the not-found path.
  const credentialFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.adoptable === undefined
      ? { id: 'cred-existing', fieldNames: ['apiToken'] }
      : opts.adoptable,
  );
  const accountFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.existingAccount === undefined
      ? {
          id: 'acct-1',
          courierId: 'courier-1',
          environment: 'PRODUCTION',
          isDefault: false,
          deletedAt: null,
          courier: { code: 'delhivery' },
        }
      : opts.existingAccount,
  );
  const accountCreate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (a) => ({
    id: 'acct-new',
    environment: 'PRODUCTION',
    label: 'label',
    isDefault: false,
    isActive: true,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...(a.data as AnyArgs),
  }));
  const accountUpdate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (a) => ({
    id: 'acct-1',
    environment: 'PRODUCTION',
    label: 'label',
    isDefault: false,
    isActive: true,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...(a.data as AnyArgs),
  }));
  const accountUpdateMany = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({ count: 1 }));
  const sellerFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.existingSeller === undefined ? { id: 'seller-1' } : opts.existingSeller,
  );
  const linkFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.existingLink === undefined ? null : opts.existingLink,
  );
  const linkUpsert = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (a) => ({
    id: 'link-1',
    sellerId: 'seller-1',
    courierAccountId: 'acct-1',
    distributionWeight: 100,
    isActive: true,
    createdAt: new Date(),
    ...(a.create as AnyArgs),
  }));
  const linkUpdate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (a) => ({
    id: 'link-1',
    sellerId: 'seller-1',
    courierAccountId: 'acct-1',
    distributionWeight: 100,
    isActive: true,
    createdAt: new Date(),
    ...(a.data as AnyArgs),
  }));
  const linkDelete = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({ id: 'link-1' }));
  const accountFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(async () => []);

  const tx = {
    courier: { findUnique: courierFindUnique },
    courierCredential: { create: credentialCreate, findFirst: credentialFindFirst },
    courierAccount: {
      findUnique: accountFindUnique,
      create: accountCreate,
      update: accountUpdate,
      updateMany: accountUpdateMany,
      findMany: accountFindMany,
    },
    seller: { findUnique: sellerFindUnique },
    sellerCourierAccountLink: {
      findUnique: linkFindUnique,
      upsert: linkUpsert,
      update: linkUpdate,
      delete: linkDelete,
    },
  };
  const $transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));
  const client = {
    $transaction,
    courierAccount: { findMany: accountFindMany },
  } as unknown as PrismaService['client'];

  const auditLog = jest.fn<Promise<string | null>, [AnyArgs, unknown?]>(async () => 'a1');
  const audit = { log: auditLog };
  const env = makeTestEnv(
    opts.keyV1 === undefined ? {} : { COURIER_CREDENTIALS_KEY_V1: opts.keyV1 },
  );

  const svc = new CourierAccountAdminService(
    { client } as unknown as PrismaService,
    env,
    audit as unknown as AuditLogService,
  );
  return {
    svc,
    credentialFindFirst,
    courierFindUnique,
    credentialCreate,
    accountFindUnique,
    accountCreate,
    accountUpdate,
    accountUpdateMany,
    sellerFindUnique,
    linkFindUnique,
    linkUpsert,
    linkUpdate,
    linkDelete,
    auditLog,
  };
}

describe('CourierAccountAdminService.createAccount', () => {
  it('encrypts the credential fields, creates the account, audits MEDIUM', async () => {
    const { svc, credentialCreate, accountCreate, auditLog } = makeService();
    const result = await svc.createAccount(
      {
        courierCode: 'delhivery',
        environment: 'PRODUCTION' as never,
        label: 'Account 2',
        credentialFields: { apiKey: 'secret-123' },
      },
      'staff-1',
    );
    expect(result.courierCode).toBe('delhivery');
    expect(result.label).toBe('Account 2');
    const credArgs = credentialCreate.mock.calls[0]![0]! as AnyArgs;
    const data = credArgs.data as AnyArgs;
    expect(data.fieldNames).toEqual(['apiKey']);
    const decrypted = decryptCredential(data.encryptedPayload as string, KEY_V1);
    expect(JSON.parse(decrypted)).toEqual({ apiKey: 'secret-123' });
    // Never log/leak the plaintext value.
    expect(JSON.stringify(auditLog.mock.calls[0]![0])).not.toContain('secret-123');
    expect(accountCreate).toHaveBeenCalledTimes(1);
    const auditCall = auditLog.mock.calls[0]![0]!;
    expect(auditCall.action).toBe('staff.courier_account.created');
    expect(auditCall.severity).toBe('MEDIUM');
  });

  it('rejects when credentialFields is empty', async () => {
    const { svc, credentialCreate } = makeService();
    await expect(
      svc.createAccount(
        {
          courierCode: 'delhivery',
          environment: 'PRODUCTION' as never,
          label: 'x',
          credentialFields: {},
        },
        'staff-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'INVALID_CREDENTIAL_FIELDS' } });
    expect(credentialCreate).not.toHaveBeenCalled();
  });

  it('rejects COURIER_CREDENTIALS_UNAVAILABLE when the encryption key is unconfigured', async () => {
    const { svc, credentialCreate } = makeService({ keyV1: '' });
    await expect(
      svc.createAccount(
        {
          courierCode: 'delhivery',
          environment: 'PRODUCTION' as never,
          label: 'x',
          credentialFields: { a: 'b' },
        },
        'staff-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'COURIER_CREDENTIALS_UNAVAILABLE' } });
    expect(credentialCreate).not.toHaveBeenCalled();
  });

  it('rejects COURIER_NOT_FOUND for an unknown courierCode', async () => {
    const { svc, credentialCreate } = makeService({ courier: null });
    await expect(
      svc.createAccount(
        {
          courierCode: 'nope',
          environment: 'PRODUCTION' as never,
          label: 'x',
          credentialFields: { a: 'b' },
        },
        'staff-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'COURIER_NOT_FOUND' } });
    // The credential is encrypted before the tx opens; only the DB write is skipped.
    expect(credentialCreate).not.toHaveBeenCalled();
  });

  it('isDefault=true clears other defaults for the same (courier, environment) first', async () => {
    const { svc, accountUpdateMany, accountCreate } = makeService();
    await svc.createAccount(
      {
        courierCode: 'delhivery',
        environment: 'PRODUCTION' as never,
        label: 'Default acct',
        credentialFields: { a: 'b' },
        isDefault: true,
      },
      'staff-1',
    );
    expect(accountUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          courierId: 'courier-1',
          environment: 'PRODUCTION',
          isDefault: true,
        }),
        data: { isDefault: false },
      }),
    );
    const createArgs = accountCreate.mock.calls[0]![0]! as AnyArgs;
    expect((createArgs.data as AnyArgs).isDefault).toBe(true);
  });
});

describe('CourierAccountAdminService.updateAccount', () => {
  it('404 COURIER_ACCOUNT_NOT_FOUND when missing', async () => {
    const { svc } = makeService({ existingAccount: null });
    await expect(svc.updateAccount('acct-1', { label: 'x' }, 'staff-1')).rejects.toMatchObject({
      response: { code: 'COURIER_ACCOUNT_NOT_FOUND' },
    });
  });

  it('promoting to isDefault clears other defaults first, then updates', async () => {
    const { svc, accountUpdateMany, accountUpdate, auditLog } = makeService({
      existingAccount: {
        id: 'acct-1',
        courierId: 'courier-1',
        environment: 'PRODUCTION',
        isDefault: false,
        deletedAt: null,
        courier: { code: 'delhivery' },
      },
    });
    await svc.updateAccount('acct-1', { isDefault: true }, 'staff-1');
    expect(accountUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { not: 'acct-1' } }),
      }),
    );
    expect(accountUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isDefault: true }) }),
    );
    expect(auditLog.mock.calls[0]![0]!.action).toBe('staff.courier_account.updated');
  });

  it('does not clear other defaults when already the default', async () => {
    const { svc, accountUpdateMany } = makeService({
      existingAccount: {
        id: 'acct-1',
        courierId: 'courier-1',
        environment: 'PRODUCTION',
        isDefault: true,
        deletedAt: null,
        courier: { code: 'delhivery' },
      },
    });
    await svc.updateAccount('acct-1', { isDefault: true }, 'staff-1');
    expect(accountUpdateMany).not.toHaveBeenCalled();
  });
});

describe('CourierAccountAdminService.linkSeller', () => {
  it('upserts the link and audits MEDIUM', async () => {
    const { svc, linkUpsert, auditLog } = makeService();
    const result = await svc.linkSeller(
      'seller-1',
      { courierAccountId: 'acct-1', distributionWeight: 60 },
      'staff-1',
    );
    expect(result.distributionWeight).toBe(60);
    expect(linkUpsert).toHaveBeenCalledTimes(1);
    expect(auditLog.mock.calls[0]![0]!.action).toBe('staff.seller_courier_account_link.set');
  });

  it('404 COURIER_ACCOUNT_NOT_FOUND when the account does not exist', async () => {
    const { svc, linkUpsert } = makeService({ existingAccount: null });
    await expect(
      svc.linkSeller('seller-1', { courierAccountId: 'missing' }, 'staff-1'),
    ).rejects.toMatchObject({ response: { code: 'COURIER_ACCOUNT_NOT_FOUND' } });
    expect(linkUpsert).not.toHaveBeenCalled();
  });

  it('404 SELLER_NOT_FOUND when the seller does not exist', async () => {
    const { svc, linkUpsert } = makeService({ existingSeller: null });
    await expect(
      svc.linkSeller('missing-seller', { courierAccountId: 'acct-1' }, 'staff-1'),
    ).rejects.toMatchObject({ response: { code: 'SELLER_NOT_FOUND' } });
    expect(linkUpsert).not.toHaveBeenCalled();
  });
});

describe('CourierAccountAdminService.updateLink', () => {
  it('404 when no link exists between the seller and account', async () => {
    const { svc } = makeService({ existingLink: null });
    await expect(
      svc.updateLink('seller-1', 'acct-1', { distributionWeight: 50 }, 'staff-1'),
    ).rejects.toMatchObject({ response: { code: 'SELLER_COURIER_ACCOUNT_LINK_NOT_FOUND' } });
  });

  it('updates weight/isActive and audits', async () => {
    const { svc, linkUpdate, auditLog } = makeService({
      existingLink: { id: 'link-1', distributionWeight: 100, isActive: true },
    });
    await svc.updateLink(
      'seller-1',
      'acct-1',
      { distributionWeight: 40, isActive: false },
      'staff-1',
    );
    expect(linkUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { distributionWeight: 40, isActive: false } }),
    );
    expect(auditLog.mock.calls[0]![0]!.action).toBe('staff.seller_courier_account_link.updated');
  });
});

describe('CourierAccountAdminService.unlinkSeller', () => {
  it('no-ops (no delete, no audit) when no link exists', async () => {
    const { svc, linkDelete, auditLog } = makeService({ existingLink: null });
    await svc.unlinkSeller('seller-1', 'acct-1', 'staff-1');
    expect(linkDelete).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('deletes + audits when the link exists', async () => {
    const { svc, linkDelete, auditLog } = makeService({
      existingLink: { id: 'link-1' },
    });
    await svc.unlinkSeller('seller-1', 'acct-1', 'staff-1');
    expect(linkDelete).toHaveBeenCalledTimes(1);
    expect(auditLog.mock.calls[0]![0]!.action).toBe('staff.seller_courier_account_link.removed');
  });
});

/**
 * Creating an account for a credential ALREADY IN USE.
 *
 * There was no path: the only way to make an account was to re-type the
 * token, which mints a second active credential for the same courier and
 * environment. And because DelhiveryHttpService resolves through the
 * DEFAULT ACCOUNT once accounts exist, that silently SWAPS which
 * credential authenticates — from one proven against the live API to one
 * just typed into a form. Adoption removes the swap.
 */
describe('CourierAccountAdminService.createAccount — adopting a credential', () => {
  const base = {
    courierCode: 'delhivery',
    environment: 'PRODUCTION' as never,
    label: 'Delhivery — primary',
  };

  it('links the EXISTING credential and mints no new one', async () => {
    // existingAccount: null — nothing has claimed this credential yet,
    // which is the whole point of adopting it.
    const { svc, credentialCreate, accountCreate } = makeService({ existingAccount: null });
    await svc.createAccount(
      { ...base, adoptCredentialId: '019f999c-f4cb-7b48-b27f-28ff63444963' } as never,
      'staff-1',
    );
    expect(credentialCreate).not.toHaveBeenCalled();
    const created = accountCreate.mock.calls[0]?.[0] as { data: { credentialId: string } };
    expect(created.data.credentialId).toBe('cred-existing');
  });

  it('scopes the lookup to this courier, environment and active only', async () => {
    // Adopting another courier's credential, or a deactivated one, would
    // authenticate as somebody the operator did not choose.
    const { svc, credentialFindFirst } = makeService({ existingAccount: null });
    await svc.createAccount({ ...base, adoptCredentialId: 'cred-x' } as never, 'staff-1');
    const where = credentialFindFirst.mock.calls[0]?.[0].where;
    expect(where).toMatchObject({
      courierId: 'courier-1',
      environment: 'PRODUCTION',
      isActive: true,
      deletedAt: null,
    });
  });

  it('refuses a credential that is not adoptable', async () => {
    const { svc } = makeService({ adoptable: null });
    await expect(
      svc.createAccount({ ...base, adoptCredentialId: 'cred-x' } as never, 'staff-1'),
    ).rejects.toMatchObject({ response: { code: 'CREDENTIAL_NOT_ADOPTABLE' } });
  });

  it('refuses a credential another account already carries', async () => {
    // courier_accounts.credential_id is UNIQUE; this is the readable
    // error in front of the constraint.
    const { svc } = makeService({
      existingAccount: { id: 'acct-9', label: 'Delhivery — old' },
    });
    await expect(
      svc.createAccount({ ...base, adoptCredentialId: 'cred-x' } as never, 'staff-1'),
    ).rejects.toMatchObject({ response: { code: 'CREDENTIAL_ALREADY_LINKED' } });
  });

  it('still requires a token when NOT adopting', async () => {
    const { svc } = makeService();
    await expect(svc.createAccount({ ...base } as never, 'staff-1')).rejects.toMatchObject({
      response: { code: 'INVALID_CREDENTIAL_FIELDS' },
    });
  });
});

describe('CourierAccountAdminService.updateAccount — pickup location', () => {
  it('stores a blank name as NULL, which is how "use the global" is spelled', async () => {
    // '' works by accident: the AWB path trims and falls through. But it
    // leaves a value whose meaning only the reader knows, and the list
    // renders a blank cell instead of "global setting".
    const { svc, accountUpdate } = makeService();
    await svc.updateAccount('acct-1', { pickupLocationName: '   ' } as never, 'staff-1');
    expect(accountUpdate.mock.calls[0]?.[0]).toMatchObject({
      data: { pickupLocationName: null },
    });
  });

  it('stores a real name UNTRIMMED — Delhivery matches it exactly', async () => {
    // Silently trimming would produce a name that does not match the
    // registration, which fails as "ClientWarehouse matching query does
    // not exist" on the create call and reads like a data problem.
    const { svc, accountUpdate } = makeService();
    await svc.updateAccount('acct-1', { pickupLocationName: ' MSEXPORT ' } as never, 'staff-1');
    expect(accountUpdate.mock.calls[0]?.[0]).toMatchObject({
      data: { pickupLocationName: ' MSEXPORT ' },
    });
  });
});
