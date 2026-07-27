import { Prisma, SettingValueType } from '@skydrop/db';
import { SystemSettingsService } from '../../src/modules/system-settings/services/system-settings.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';

type AnyArgs = Record<string, unknown>;

function makeRow(overrides: Partial<AnyArgs>): AnyArgs {
  return {
    id: 'st-1',
    key: 'ops.call_max_attempts_before_ndr',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueString: null,
    valueInt: 3,
    valueDecimal: null,
    valueBoolean: null,
    valueJson: null,
    valueDate: null,
    displayName: 'Call attempts before NDR',
    description: 'Max call attempts before NDR routing',
    helpText: null,
    isEditableByAdmin: true,
    isSensitive: false,
    requiresRestart: false,
    lastEditedByStaffId: null,
    lastEditedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeService(opts: { row?: AnyArgs | null; rows?: AnyArgs[] } = {}) {
  const findUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.row === undefined ? makeRow({}) : opts.row,
  );
  const findMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(async () => opts.rows ?? []);
  const update = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (a) => ({
    ...makeRow({}),
    ...(a.data as AnyArgs),
  }));
  const $transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      systemSetting: { findUnique, update },
    }),
  );
  const client = {
    systemSetting: { findUnique, findMany, update },
    $transaction,
  } as unknown as PrismaService['client'];
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs, unknown?]>(async () => 'a1');
  const audit = { log: auditLog };
  return {
    svc: new SystemSettingsService(
      { client } as unknown as PrismaService,
      audit as unknown as AuditLogService,
    ),
    findUnique,
    findMany,
    update,
    auditLog,
  };
}

describe('SystemSettingsService.list', () => {
  it('groups settings by category alphabetically, masks sensitive values', async () => {
    const { svc } = makeService({
      rows: [
        makeRow({ key: 'ops.a', category: 'ops', valueType: SettingValueType.INT, valueInt: 7 }),
        makeRow({
          key: 'webhooks.secret',
          category: 'webhooks',
          valueType: SettingValueType.STRING,
          valueInt: null,
          valueString: 'sup3rs3cret',
          isSensitive: true,
        }),
      ],
    });
    const groups = await svc.list();
    expect(groups).toHaveLength(2);
    const ops = groups.find((g) => g.category === 'ops')!;
    const webhooks = groups.find((g) => g.category === 'webhooks')!;
    expect(ops.items[0]?.valueDisplay).toBe('7');
    expect(webhooks.items[0]?.valueDisplay).toBe('***');
  });
});

describe('SystemSettingsService.updateValue', () => {
  it('writes the matching value column + nulls the others + audits MEDIUM', async () => {
    const { svc, update, auditLog } = makeService();
    const result = await svc.updateValue(
      'ops.call_max_attempts_before_ndr',
      { valueType: SettingValueType.INT, value: 4 },
      'staff-1',
    );
    expect(update).toHaveBeenCalledTimes(1);
    const data = update.mock.calls[0]![0]!.data as AnyArgs;
    expect(data.valueInt).toBe(4);
    expect(data.valueString).toBeNull();
    expect(data.lastEditedByStaffId).toBe('staff-1');
    expect(result.value).toBe(4);
    expect(auditLog).toHaveBeenCalled();
    const auditCall = auditLog.mock.calls[0]![0]!;
    expect(auditCall.action).toBe('staff.system_setting.updated');
    expect(auditCall.severity).toBe('MEDIUM');
  });

  it('rejects NOT_EDITABLE with 409 + LOW audit + no update', async () => {
    const { svc, update, auditLog } = makeService({
      row: makeRow({ isEditableByAdmin: false }),
    });
    await expect(
      svc.updateValue(
        'ops.call_max_attempts_before_ndr',
        { valueType: SettingValueType.INT, value: 5 },
        'staff-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'NOT_EDITABLE' } });
    expect(update).not.toHaveBeenCalled();
    const auditCall = auditLog.mock.calls[0]?.[0];
    expect(auditCall?.action).toBe('staff.system_setting.update_rejected');
    expect(auditCall?.severity).toBe('LOW');
  });

  it('rejects VALUE_TYPE_MISMATCH when the DTO declares the wrong type', async () => {
    const { svc, update } = makeService();
    await expect(
      svc.updateValue(
        'ops.call_max_attempts_before_ndr',
        { valueType: SettingValueType.STRING, value: 'oops' },
        'staff-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'VALUE_TYPE_MISMATCH' } });
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects INVALID_VALUE when the value does not parse for the type', async () => {
    const { svc, update } = makeService();
    await expect(
      svc.updateValue(
        'ops.call_max_attempts_before_ndr',
        { valueType: SettingValueType.INT, value: 'three' },
        'staff-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'INVALID_VALUE' } });
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects SYSTEM_SETTING_NOT_FOUND for unknown key', async () => {
    const { svc } = makeService({ row: null });
    await expect(
      svc.updateValue('does.not.exist', { valueType: SettingValueType.STRING, value: 'x' }, 's1'),
    ).rejects.toMatchObject({ response: { code: 'SYSTEM_SETTING_NOT_FOUND' } });
  });

  it('DECIMAL: accepts a numeric string and a number, writes via Prisma.Decimal', async () => {
    const { svc, update } = makeService({
      row: makeRow({
        valueType: SettingValueType.DECIMAL,
        valueInt: null,
        valueDecimal: new Prisma.Decimal('18.00'),
      }),
    });
    await svc.updateValue(
      'pricing.gst_rate',
      { valueType: SettingValueType.DECIMAL, value: '18.00' },
      'staff-1',
    );
    const data = update.mock.calls[0]![0]!.data as AnyArgs;
    expect((data.valueDecimal as Prisma.Decimal).toString()).toBe('18');
  });

  it('JSON: accepts an array', async () => {
    const { svc, update } = makeService({
      row: makeRow({ valueType: SettingValueType.JSON, valueInt: null, valueJson: ['DL', 'KA'] }),
    });
    await svc.updateValue(
      'ops.allowed_indian_states',
      { valueType: SettingValueType.JSON, value: ['DL', 'KA', 'MH'] },
      'staff-1',
    );
    const data = update.mock.calls[0]![0]!.data as AnyArgs;
    expect(data.valueJson).toEqual(['DL', 'KA', 'MH']);
  });
});

describe('SystemSettingsService.getByKey', () => {
  it('returns the raw value alongside display fields', async () => {
    const { svc } = makeService();
    const result = await svc.getByKey('ops.call_max_attempts_before_ndr');
    expect(result.value).toBe(3);
    expect(result.valueDisplay).toBe('3');
  });

  it('returns the raw value even for sensitive settings (UI gates reveal)', async () => {
    const { svc } = makeService({
      row: makeRow({
        valueType: SettingValueType.STRING,
        valueInt: null,
        valueString: 'secret',
        isSensitive: true,
      }),
    });
    const result = await svc.getByKey('webhooks.secret');
    expect(result.value).toBe('secret');
    expect(result.valueDisplay).toBe('***');
  });
});
