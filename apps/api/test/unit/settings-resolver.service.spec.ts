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
    isSensitive: false,
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

function makeService(
  opts: {
    systemRow?: AnyArgs | null;
    overrideRow?: AnyArgs | null;
    overridableRows?: AnyArgs[];
    overrideRows?: AnyArgs[];
    /** Non-deleted courier codes, for reference validation. */
    couriers?: string[];
  } = {},
) {
  const courierFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(async () =>
    (opts.couriers ?? ['delhivery', 'manual', 'shiprocket']).map((code) => ({ code })),
  );
  const systemFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.systemRow === undefined ? makeSystemRow() : opts.systemRow,
  );
  const systemFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(
    async () => opts.overridableRows ?? [],
  );
  const overrideFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.overrideRow === undefined ? null : opts.overrideRow,
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
      courier: { findMany: courierFindMany },
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

/**
 * The message a refused `setOverride` came back with.
 *
 * `setOverride` RESOLVES to a view and REJECTS with an exception, so
 * `.catch(e => e as X)` leaves a union every assertion would have to
 * narrow. These cases are about the refusal, so this returns the
 * message and fails loudly if the call was accepted.
 */
async function refusalMessage(
  svc: SettingsResolverService,
  key: string,
  value: unknown,
  valueType: SettingValueType = SettingValueType.STRING,
): Promise<string> {
  try {
    await svc.setOverride('seller-qa', key, { valueType, value }, 'staff-1');
  } catch (err) {
    const body = (err as { response?: { message?: unknown } }).response;
    return typeof body?.message === 'string' ? body.message : String(err);
  }
  throw new Error(`setOverride('${key}') was expected to refuse and did not`);
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

  describe('ops.default_courier_code — the override must name a real courier', () => {
    const courierRow = makeSystemRow({
      key: 'ops.default_courier_code',
      valueType: SettingValueType.STRING,
      valueString: 'delhivery',
      valueInt: null,
      overrideMinInt: null,
      overrideMaxInt: null,
    });

    it('accepts an existing courier (switched-off manual included) and stores it trimmed', async () => {
      const { svc, overrideUpsert } = makeService({ systemRow: courierRow });
      const r = await svc.setOverride(
        'seller-qa',
        'ops.default_courier_code',
        { valueType: SettingValueType.STRING, value: ' manual ' },
        'staff-1',
      );
      expect((overrideUpsert.mock.calls[0]![0].create as AnyArgs).valueString).toBe('manual');
      expect(r.value).toBe('manual');
    });

    it('refuses an unknown courier code with UNKNOWN_COURIER_CODE and writes nothing', async () => {
      const { svc, overrideUpsert } = makeService({ systemRow: courierRow });
      await expect(
        svc.setOverride(
          'seller-qa',
          'ops.default_courier_code',
          { valueType: SettingValueType.STRING, value: 'manaul' },
          'staff-1',
        ),
      ).rejects.toMatchObject({ response: { code: 'UNKNOWN_COURIER_CODE' } });
      expect(overrideUpsert).not.toHaveBeenCalled();
    });

    /**
     * SET-1 clamps INT and DECIMAL overrides at write time and says
     * nothing about STRINGS, so nothing stopped a seller override of
     * `wallet.inbound_freight_mode` holding `PAY_ADVANCED` or `pay now`.
     * It would save cleanly, read back as unrecognised, and fail closed
     * somewhere far away — the reader defaults to PAY_NOW — so the
     * symptom would be a seller quietly billed on the wrong leg with
     * nothing pointing back at the override.
     */
    const freightModeRow = makeSystemRow({
      key: 'wallet.inbound_freight_mode',
      valueType: SettingValueType.STRING,
      valueString: 'PAY_NOW',
      valueInt: null,
      overrideMinInt: null,
      overrideMaxInt: null,
    });

    it('accepts a valid freight mode, trimmed and upper-cased', async () => {
      const { svc, overrideUpsert } = makeService({ systemRow: freightModeRow });
      const r = await svc.setOverride(
        'seller-qa',
        'wallet.inbound_freight_mode',
        { valueType: SettingValueType.STRING, value: ' pay_advance ' },
        'staff-1',
      );
      expect((overrideUpsert.mock.calls[0]![0].create as AnyArgs).valueString).toBe('PAY_ADVANCE');
      expect(r.value).toBe('PAY_ADVANCE');
    });

    it('refuses a value that is not a mode, and writes nothing', async () => {
      const { svc, overrideUpsert } = makeService({ systemRow: freightModeRow });
      await expect(
        svc.setOverride(
          'seller-qa',
          'wallet.inbound_freight_mode',
          { valueType: SettingValueType.STRING, value: 'PAY_ADVANCED' },
          'staff-1',
        ),
      ).rejects.toMatchObject({ response: { code: 'INVALID_SETTING_VALUE' } });
      expect(overrideUpsert).not.toHaveBeenCalled();
    });

    /**
     * ── A REFUSAL SAYS WHAT IS ALLOWED, NOT WHAT WAS TYPED ─────────────
     *
     * These messages quoted the rejected value straight back into an
     * HTTP 400 and the request log. A validation message exists to say
     * what IS acceptable, which needs no quotation of the mistake — and
     * the mistake is sometimes a credential: the leak this branch fixes
     * was a password typed into `portalCompany`, published because
     * something echoed it.
     */
    it('refuses a bad mode without quoting it back', async () => {
      const { svc } = makeService({ systemRow: freightModeRow });
      const message = await refusalMessage(svc, 'wallet.inbound_freight_mode', 'Tr0ub4dor&3-horse');
      expect(message).not.toContain('Tr0ub4dor');
      // The useful half — the allowed set — is OURS and stays.
      expect(message).toContain('PAY_ADVANCE');
      expect(message).toContain('wallet.inbound_freight_mode');
    });

    it('refuses an unknown courier without quoting it back', async () => {
      const { svc } = makeService({ systemRow: courierRow });
      const message = await refusalMessage(svc, 'ops.default_courier_code', 'p@ssw0rd#2026');
      expect(message).not.toContain('p@ssw0rd');
      expect(message).toContain('delhivery');
    });

    it('withholds a sensitive key\u2019s value from the override audit too', async () => {
      // `is_sensitive` is a fact about the KEY, so it holds for a
      // per-seller override of that key. No setting is both sensitive
      // and seller-overridable today; the guard is for the day one is.
      const { svc, auditLog } = makeService({
        systemRow: makeSystemRow({
          key: 'a.sensitive.string',
          valueType: SettingValueType.STRING,
          valueString: 'before',
          valueInt: null,
          overrideMinInt: null,
          overrideMaxInt: null,
          isSensitive: true,
        }),
      });
      await svc.setOverride(
        'seller-qa',
        'a.sensitive.string',
        { valueType: SettingValueType.STRING, value: 'Tr0ub4dor&3-horse' },
        'staff-1',
      );
      const changes = auditLog.mock.calls[0]![0]!.changes as AnyArgs;
      expect(JSON.stringify(changes)).not.toContain('Tr0ub4dor');
      expect(changes.value).toBe('***');
      expect(changes.valueWithheld).toBe(true);
      expect(changes.key).toBe('a.sensitive.string');
    });

    it('resolve: the seller override beats the global default', async () => {
      const { svc } = makeService({
        systemRow: courierRow,
        overrideRow: makeOverrideRow({
          key: 'ops.default_courier_code',
          valueType: SettingValueType.STRING,
          valueString: 'manual',
          valueInt: null,
        }),
      });
      await expect(svc.resolve('seller-qa', 'ops.default_courier_code')).resolves.toMatchObject({
        value: 'manual',
        source: 'SELLER_OVERRIDE',
      });
    });
  });

  /**
   * JSON overrides were SHAPE-checked and never content-checked.
   *
   * `parseAndClamp` refused anything that was not "an object or an
   * array", which catches a bare string and nothing else — so a list
   * holding the wrong words saved cleanly, showed on the seller's screen
   * as a real value, and was silently discarded at the far end by a
   * reader that only recognises the courier's own vocabulary. For
   * `courier.ndr_auto_categories` that means an action a seller believes
   * is switched on and which never fires.
   */
  describe('courier.ndr_auto_categories — a JSON list drawn from a fixed set', () => {
    const ndrRow = makeSystemRow({
      key: 'courier.ndr_auto_categories',
      valueType: SettingValueType.JSON,
      valueJson: [],
      valueInt: null,
      overrideMinInt: null,
      overrideMaxInt: null,
    });

    const set = (svc: SettingsResolverService, value: unknown) =>
      svc.setOverride(
        'seller-qa',
        'courier.ndr_auto_categories',
        { valueType: SettingValueType.JSON, value },
        'staff-1',
      );

    it('names a bad list entry by POSITION, never by its contents', async () => {
      // An index is as actionable for fixing a ten-item list and carries
      // nothing of what was typed.
      const { svc } = makeService({ systemRow: ndrRow });
      const message = await refusalMessage(
        svc,
        'courier.ndr_auto_categories',
        ['RE-ATTEMPT', 'hunter2'],
        SettingValueType.JSON,
      );
      expect(message).not.toContain('hunter2');
      // The first entry is valid, so only the second is named — by its
      // place in the list.
      expect(message).toMatch(/Entry 2\b/);
      expect(message).toContain('RE-ATTEMPT, PICKUP_RESCHEDULE');
    });

    it('accepts a valid list, trimmed and in the code-owned order', async () => {
      const { svc, overrideUpsert } = makeService({ systemRow: ndrRow });
      const r = await set(svc, [' PICKUP_RESCHEDULE ', 'RE-ATTEMPT']);
      expect((overrideUpsert.mock.calls[0]![0].create as AnyArgs).valueJson).toEqual([
        'RE-ATTEMPT',
        'PICKUP_RESCHEDULE',
      ]);
      expect(r.value).toEqual(['RE-ATTEMPT', 'PICKUP_RESCHEDULE']);
    });

    it('accepts an empty list — "none of them" is a real decision', async () => {
      const { svc } = makeService({ systemRow: ndrRow });
      await expect(set(svc, [])).resolves.toMatchObject({ value: [] });
    });

    it('refuses a misspelt action by NAME, and writes nothing', async () => {
      // The underscore-for-hyphen typo is the whole reason this exists.
      const { svc, overrideUpsert } = makeService({ systemRow: ndrRow });
      await expect(set(svc, ['RE_ATTEMPT'])).rejects.toMatchObject({
        response: { code: 'INVALID_SETTING_VALUE' },
      });
      expect(overrideUpsert).not.toHaveBeenCalled();
    });

    it('refuses an object where a list was meant', async () => {
      // `{"RE-ATTEMPT": true}` passed the old shape check outright.
      const { svc, overrideUpsert } = makeService({ systemRow: ndrRow });
      await expect(set(svc, { 'RE-ATTEMPT': true })).rejects.toMatchObject({
        response: { code: 'INVALID_SETTING_VALUE' },
      });
      expect(overrideUpsert).not.toHaveBeenCalled();
    });

    it('refuses a non-string entry', async () => {
      const { svc, overrideUpsert } = makeService({ systemRow: ndrRow });
      await expect(set(svc, ['RE-ATTEMPT', 7])).rejects.toMatchObject({
        response: { code: 'INVALID_SETTING_VALUE' },
      });
      expect(overrideUpsert).not.toHaveBeenCalled();
    });

    it('audits HIGH, not the ordinary MEDIUM — this decides whether a van goes out', async () => {
      const { svc, auditLog } = makeService({ systemRow: ndrRow });
      await set(svc, ['RE-ATTEMPT']);
      expect(auditLog.mock.calls[0]![0]!.severity).toBe('HIGH');
    });

    it('the kill switch override audits HIGH too, set and cleared', async () => {
      const killRow = makeSystemRow({
        key: 'courier.ndr_runner_enabled',
        valueType: SettingValueType.BOOLEAN,
        valueBoolean: false,
        valueInt: null,
        overrideMinInt: null,
        overrideMaxInt: null,
      });
      const a = makeService({ systemRow: killRow });
      await a.svc.setOverride(
        'seller-qa',
        'courier.ndr_runner_enabled',
        { valueType: SettingValueType.BOOLEAN, value: false },
        'staff-1',
      );
      expect(a.auditLog.mock.calls[0]![0]!.severity).toBe('HIGH');

      // Clearing stops the narrowing, which returns the seller to
      // whatever the global pair permits — the same class of act.
      const b = makeService({
        systemRow: killRow,
        overrideRow: makeOverrideRow({ key: 'courier.ndr_runner_enabled' }),
      });
      await b.svc.clearOverride('seller-qa', 'courier.ndr_runner_enabled', 'staff-1');
      expect(b.auditLog.mock.calls[0]![0]!.severity).toBe('HIGH');
    });
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
  it("merges overridable system settings with the seller's overrides", async () => {
    const { svc } = makeService({
      overridableRows: [
        makeSystemRow({ key: 'ops.call_max_attempts_before_ndr', valueInt: 3 }),
        makeSystemRow({ key: 'ops.other_flag', valueInt: 7 }),
      ],
      overrideRows: [makeOverrideRow({ key: 'ops.call_max_attempts_before_ndr', valueInt: 5 })],
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

describe('SET-1 parseAndClamp — BOOLEAN accepts what the other types accept', () => {
  /** parseAndClamp is private; exercised through the public entry point. */
  function parse(valueType: string, value: unknown, overrides: Record<string, unknown> = {}) {
    const svc = new SettingsResolverService(
      {
        client: {
          $transaction: async (fn: (tx: unknown) => unknown) =>
            fn({
              systemSetting: {
                findUnique: async () => ({
                  key: 'k',
                  valueType,
                  sellerOverridable: true,
                  overrideMinInt: null,
                  overrideMaxInt: null,
                  overrideMinDecimal: null,
                  overrideMaxDecimal: null,
                  ...overrides,
                }),
              },
              sellerSettingOverride: {
                upsert: async (args: { create: Record<string, unknown> }) => args.create,
              },
            }),
        },
      } as never,
      { log: async () => undefined } as never,
    );
    return svc.setOverride('s1', 'k', { valueType, value } as never, { sellerActor: true });
  }

  it('takes a real boolean', async () => {
    await expect(parse('BOOLEAN', true)).resolves.toBeDefined();
    await expect(parse('BOOLEAN', false)).resolves.toBeDefined();
  });

  it("takes 'true' / 'false' as text", async () => {
    // INT and DECIMAL already accept their string forms, because these
    // values arrive from forms and hand-written calls where everything
    // is text. BOOLEAN being the one exception made "stringify the
    // value" work for three settings and fail on the fourth — which is
    // how the automatic-withdrawal toggle shipped broken.
    await expect(parse('BOOLEAN', 'true')).resolves.toBeDefined();
    await expect(parse('BOOLEAN', ' FALSE ')).resolves.toBeDefined();
  });

  it('refuses anything else rather than guessing', async () => {
    // Deliberately not truthiness: reading "no" or "0" as false is where
    // a guess becomes a silently wrong setting.
    for (const bad of ['yes', 'no', '1', '0', 'on', '', 2, null]) {
      await expect(parse('BOOLEAN', bad)).rejects.toThrow();
    }
  });
});
