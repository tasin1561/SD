import { Prisma, SettingValueType } from '@skydrop/db';
import { SettingsResolverService } from '../../src/modules/settings/services/settings-resolver.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';

type AnyArgs = Record<string, unknown>;

function makeSystemRow(overrides: Partial<AnyArgs> = {}): AnyArgs {
  return {
    id: 'sys-1',
    key: 'ops.call_max_attempts_before_ndr',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueString: null,
    valueInt: 3,
    valueDecimal: null,
    valueBoolean: null,
    valueJson: null,
    valueDate: null,
    sellerOverridable: true,
    overrideMinInt: 1,
    overrideMaxInt: 10,
    overrideMinDecimal: null,
    overrideMaxDecimal: null,
    ...overrides,
  };
}

function makeOverrideRow(overrides: Partial<AnyArgs> = {}): AnyArgs {
  return {
    id: 'ovr-1',
    sellerId: 'seller-1',
    key: 'ops.call_max_attempts_before_ndr',
    valueType: SettingValueType.INT,
    valueString: null,
    valueInt: 5,
    valueDecimal: null,
    valueBoolean: null,
    valueJson: null,
    valueDate: null,
    setByStaffId: 'staff-1',
    note: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeService(opts: {
  systemRow?: AnyArgs | null;
  overrideRow?: AnyArgs | null;
  overridableRows?: AnyArgs[];
  overrideRows?: AnyArgs[];
} = {}) {
  const systemFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(
    async () => (opts.systemRow === undefined ? makeSystemRow() : opts.systemRow),
  );
  const systemFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(
    async () => opts.overridableRows ?? [],
  );
  const overrideFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(
    async () => (opts.overrideRow === undefined ? null : opts.overrideRow),
  );
  const overrideFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(
    async () => opts.overrideRows ?? [],
  );
  const overrideUpsert = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (a) => ({
    ...makeOverrideRow(),
    ...(a.create as AnyArgs),
    ...(a.update as AnyArgs),
  }));
  const overrideDelete = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => makeOverrideRow());

  const $transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      systemSetting: { findUnique: systemFindUnique },
      sellerSettingOverride: {
        findUnique: overrideFindUnique,
        upsert: overrideUpsert,
        delete: overrideDelete,
      },
    }),
  );
  const client = {
    systemSetting: { findUnique: systemFindUnique, findMany: systemFindMany },
    sellerSettingOverride: {
      findUnique: overrideFindUnique,
      findMany: overrideFindMany,
      upsert: overrideUpsert,
      delete: overrideDelete,
    },
    $transaction,
  } as unknown as PrismaService['client'];
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs, unknown?]>(async () => 'a1');
  const audit = { log: auditLog };
  return {
    svc: new SettingsResolverService(
      { client } as unknown as PrismaService,
      audit as unknown as AuditLogService,
    ),
    systemFindUnique,
    overrideFindUnique,
    overrideUpsert,
    overrideDelete,
    auditLog,
  };
}

describe('SettingsResolverService.resolve', () => {
  it('returns the system default when no seller override exists', async () => {
    const { svc, overrideFindUnique } = makeService({ overrideRow: null });
    const result = await svc.resolve('seller-1', 'ops.call_max_attempts_before_ndr');
    expect(result).toEqual({
      key: 'ops.call_max_attempts_before_ndr',
      valueType: SettingValueType.INT,
      value: 3,
      source: 'SYSTEM_DEFAULT',
    });
    expect(overrideFindUnique).toHaveBeenCalledTimes(1);
  });

  it('returns the seller override value when one exists', async () => {
    const { svc } = makeService({ overrideRow: makeOverrideRow({ valueInt: 5 }) });
    const result = await svc.resolve('seller-1', 'ops.call_max_attempts_before_ndr');
    expect(result.value).toBe(5);
    expect(result.source).toBe('SELLER_OVERRIDE');
  });

  it('never queries the override table when the key is not sellerOverridable', async () => {
    const { svc, overrideFindUnique } = makeService({
      systemRow: makeSystemRow({ sellerOverridable: false }),
    });
    const result = await svc.resolve('seller-1', 'ops.call_max_attempts_before_ndr');
    expect(result.source).toBe('SYSTEM_DEFAULT');
    expect(overrideFindUnique).not.toHaveBeenCalled();
  });

  it('rejects SYSTEM_SETTING_NOT_FOUND for an unknown key', async () => {
    const { svc } = makeService({ systemRow: null });
    await expect(svc.resolve('seller-1', 'does.not.exist')).rejects.toMatchObject({
      response: { code: 'SYSTEM_SETTING_NOT_FOUND' },
    });
  });
});

describe('SettingsResolverService.setOverride', () => {
  it('upserts the override + audits MEDIUM on success', async () => {
    const { svc, overrideUpsert, auditLog } = makeService();
    const result = await svc.setOverride(
      'seller-1',
      'ops.call_max_attempts_before_ndr',
      { valueType: SettingValueType.INT, value: 4 },
      'staff-1',
    );
    expect(overrideUpsert).toHaveBeenCalledTimes(1);
    const args = overrideUpsert.mock.calls[0]![0]!;
    expect((args.create as AnyArgs).valueInt).toBe(4);
    expect((args.update as AnyArgs).valueInt).toBe(4);
    expect(result.value).toBe(4);
    const auditCall = auditLog.mock.calls[0]![0]!;
    expect(auditCall.action).toBe('staff.seller_setting_override.set');
    expect(auditCall.severity).toBe('MEDIUM');
  });

  it('rejects NOT_SELLER_OVERRIDABLE with LOW audit + no upsert', async () => {
    const { svc, overrideUpsert, auditLog } = makeService({
      systemRow: makeSystemRow({ sellerOverridable: false }),
    });
    await expect(
      svc.setOverride(
        'seller-1',
        'ops.call_max_attempts_before_ndr',
        { valueType: SettingValueType.INT, value: 4 },
        'staff-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'NOT_SELLER_OVERRIDABLE' } });
    expect(overrideUpsert).not.toHaveBeenCalled();
    const auditCall = auditLog.mock.calls[0]![0]!;
    expect(auditCall.action).toBe('staff.seller_setting_override.rejected');
    expect(auditCall.severity).toBe('LOW');
  });

  it('rejects VALUE_TYPE_MISMATCH', async () => {
    const { svc, overrideUpsert } = makeService();
    await expect(
      svc.setOverride(
        'seller-1',
        'ops.call_max_attempts_before_ndr',
        { valueType: SettingValueType.STRING, value: 'oops' },
        'staff-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'VALUE_TYPE_MISMATCH' } });
    expect(overrideUpsert).not.toHaveBeenCalled();
  });

  it('rejects INVALID_VALUE when the value does not parse for the type', async () => {
    const { svc, overrideUpsert } = makeService();
    await expect(
      svc.setOverride(
        'seller-1',
        'ops.call_max_attempts_before_ndr',
        { valueType: SettingValueType.INT, value: 'three' },
        'staff-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'INVALID_VALUE' } });
    expect(overrideUpsert).not.toHaveBeenCalled();
  });

  it('rejects OVERRIDE_OUT_OF_BOUNDS above overrideMaxInt', async () => {
    const { svc, overrideUpsert } = makeService();
    await expect(
      svc.setOverride(
        'seller-1',
        'ops.call_max_attempts_before_ndr',
        { valueType: SettingValueType.INT, value: 25 },
        'staff-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'OVERRIDE_OUT_OF_BOUNDS' } });
    expect(overrideUpsert).not.toHaveBeenCalled();
  });

  it('rejects OVERRIDE_OUT_OF_BOUNDS below overrideMinInt', async () => {
    const { svc, overrideUpsert } = makeService();
    await expect(
      svc.setOverride(
        'seller-1',
        'ops.call_max_attempts_before_ndr',
        { valueType: SettingValueType.INT, value: 0 },
        'staff-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'OVERRIDE_OUT_OF_BOUNDS' } });
    expect(overrideUpsert).not.toHaveBeenCalled();
  });

  it('rejects SYSTEM_SETTING_NOT_FOUND for an unknown key', async () => {
    const { svc } = makeService({ systemRow: null });
    await expect(
      svc.setOverride(
        'seller-1',
        'does.not.exist',
        { valueType: SettingValueType.INT, value: 4 },
        'staff-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'SYSTEM_SETTING_NOT_FOUND' } });
  });

  it('DECIMAL: accepts a numeric string within bounds, writes via Prisma.Decimal', async () => {
    const { svc, overrideUpsert } = makeService({
      systemRow: makeSystemRow({
        key: 'pricing.gst_rate',
        valueType: SettingValueType.DECIMAL,
        valueInt: null,
        valueDecimal: new Prisma.Decimal('18.00'),
        overrideMinInt: null,
        overrideMaxInt: null,
        overrideMinDecimal: new Prisma.Decimal('0'),
        overrideMaxDecimal: new Prisma.Decimal('30'),
      }),
    });
    await svc.setOverride(
      'seller-1',
      'pricing.gst_rate',
      { valueType: SettingValueType.DECIMAL, value: '12.5' },
      'staff-1',
    );
    const args = overrideUpsert.mock.calls[0]![0]!;
    expect(((args.create as AnyArgs).valueDecimal as Prisma.Decimal).toString()).toBe('12.5');
  });

  it('DECIMAL: rejects OVERRIDE_OUT_OF_BOUNDS above overrideMaxDecimal', async () => {
    const { svc, overrideUpsert } = makeService({
      systemRow: makeSystemRow({
        key: 'pricing.gst_rate',
        valueType: SettingValueType.DECIMAL,
        valueInt: null,
        valueDecimal: new Prisma.Decimal('18.00'),
        overrideMinInt: null,
        overrideMaxInt: null,
        overrideMinDecimal: new Prisma.Decimal('0'),
        overrideMaxDecimal: new Prisma.Decimal('30'),
      }),
    });
    await expect(
      svc.setOverride(
        'seller-1',
        'pricing.gst_rate',
        { valueType: SettingValueType.DECIMAL, value: '99' },
        'staff-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'OVERRIDE_OUT_OF_BOUNDS' } });
    expect(overrideUpsert).not.toHaveBeenCalled();
  });
});

describe('SettingsResolverService.clearOverride', () => {
  it('deletes the existing override + audits MEDIUM', async () => {
    const { svc, overrideDelete, auditLog } = makeService({
      overrideRow: makeOverrideRow(),
    });
    await svc.clearOverride('seller-1', 'ops.call_max_attempts_before_ndr', 'staff-1');
    expect(overrideDelete).toHaveBeenCalledTimes(1);
    const auditCall = auditLog.mock.calls[0]![0]!;
    expect(auditCall.action).toBe('staff.seller_setting_override.cleared');
    expect(auditCall.severity).toBe('MEDIUM');
  });

  it('no-ops when no override exists (no delete, no audit)', async () => {
    const { svc, overrideDelete, auditLog } = makeService({ overrideRow: null });
    await svc.clearOverride('seller-1', 'ops.call_max_attempts_before_ndr', 'staff-1');
    expect(overrideDelete).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });
});

describe('SettingsResolverService.listForSeller', () => {
  it('merges overridable system settings with the seller\'s overrides', async () => {
    const { svc } = makeService({
      overridableRows: [
        makeSystemRow({ key: 'ops.call_max_attempts_before_ndr', valueInt: 3 }),
        makeSystemRow({ key: 'ops.other_flag', valueInt: 7 }),
      ],
      overrideRows: [
        makeOverrideRow({ key: 'ops.call_max_attempts_before_ndr', valueInt: 5 }),
      ],
    });
    const result = await svc.listForSeller('seller-1');
    expect(result).toHaveLength(2);
    const overridden = result.find((r) => r.key === 'ops.call_max_attempts_before_ndr')!;
    expect(overridden.value).toBe(5);
    expect(overridden.source).toBe('SELLER_OVERRIDE');
    expect(overridden.systemDefault).toBe(3);
    const plain = result.find((r) => r.key === 'ops.other_flag')!;
    expect(plain.value).toBe(7);
    expect(plain.source).toBe('SYSTEM_DEFAULT');
  });
});
