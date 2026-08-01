import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, Prisma, SettingValueType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';

/**
 * Generic per-seller settings override — the R0 foundation of the
 * revised-plan roadmap. Replaces the pattern of hand-adding a bespoke
 * nullable column to `Seller` for every new per-seller-configurable
 * setting (the two that exist today — `reservationTtlHoursOverride`,
 * `callMaxAttemptsBeforeNdrOverride` — are left in place as legacy
 * shims; new settings should be added here instead).
 *
 * Resolution: `sellerOverride ?? systemDefault`. A key is only
 * overridable when the `system_settings` row has `sellerOverridable
 * = true` — `setOverride` is the sole writer AND the sole validator
 * of that gate plus the optional min/max bounds, so an override can
 * never exist outside what the system explicitly permitted.
 *
 * Dependency-free by design (only PrismaService + AuditLogService) so
 * it can be imported by any domain (call-center, inventory-stock,
 * seller-wallet-accrual, courier-dispatch, ...) without creating a
 * module cycle — same shape as the call-queue / shipment-provision /
 * lifecycle-events R3 primitives.
 */

type ValueRow = {
  valueType: SettingValueType;
  valueString: string | null;
  valueInt: number | null;
  valueDecimal: Prisma.Decimal | null;
  valueBoolean: boolean | null;
  valueJson: Prisma.JsonValue | null;
  valueDate: Date | null;
};

export interface ResolvedSetting {
  readonly key: string;
  readonly valueType: SettingValueType;
  readonly value: unknown;
  readonly source: 'SELLER_OVERRIDE' | 'SYSTEM_DEFAULT';
}

export interface SellerSettingOverrideView {
  readonly key: string;
  readonly valueType: SettingValueType;
  readonly value: unknown;
  readonly setByStaffId: string | null;
  readonly note: string | null;
  readonly updatedAt: Date;
}

export interface SetSellerSettingOverrideInput {
  readonly valueType: SettingValueType;
  readonly value: unknown;
  readonly note?: string | null;
}

@Injectable()
export class SettingsResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /** `sellerOverride ?? systemDefault`. Throws 404 if the key doesn't exist at all. */
  async resolve(sellerId: string, key: string): Promise<ResolvedSetting> {
    const system = await this.prisma.client.systemSetting.findUnique({ where: { key } });
    if (!system) {
      throw new NotFoundException({
        code: 'SYSTEM_SETTING_NOT_FOUND',
        message: `Setting '${key}' does not exist`,
      });
    }
    const override = system.sellerOverridable
      ? await this.prisma.client.sellerSettingOverride.findUnique({
          where: { sellerId_key: { sellerId, key } },
        })
      : null;

    if (override) {
      return {
        key,
        valueType: override.valueType,
        value: this.extractTypedValue(override),
        source: 'SELLER_OVERRIDE',
      };
    }
    return {
      key,
      valueType: system.valueType,
      value: this.extractTypedValue(system),
      source: 'SYSTEM_DEFAULT',
    };
  }

  /** List every seller-overridable key with the seller's current override (if any) + the system default. */
  async listForSeller(
    sellerId: string,
  ): Promise<readonly (ResolvedSetting & { systemDefault: unknown })[]> {
    const overridable = await this.prisma.client.systemSetting.findMany({
      where: { sellerOverridable: true },
      orderBy: { key: 'asc' },
    });
    const overrides = await this.prisma.client.sellerSettingOverride.findMany({
      where: { sellerId, key: { in: overridable.map((s) => s.key) } },
    });
    const overrideByKey = new Map(overrides.map((o) => [o.key, o]));

    return overridable.map((system) => {
      const override = overrideByKey.get(system.key);
      return {
        key: system.key,
        valueType: system.valueType,
        value: override ? this.extractTypedValue(override) : this.extractTypedValue(system),
        source: override ? 'SELLER_OVERRIDE' : 'SYSTEM_DEFAULT',
        systemDefault: this.extractTypedValue(system),
      };
    });
  }

  /**
   * Sole writer of `seller_setting_overrides`. Validates: the key
   * exists, is marked `sellerOverridable`, the supplied `valueType`
   * matches the system setting's type, the value parses, and (for
   * INT/DECIMAL) the value falls within the system-set min/max bounds
   * if present. Upserts on `(sellerId, key)`.
   */
  async setOverride(
    sellerId: string,
    key: string,
    input: SetSellerSettingOverrideInput,
    staffId: string,
  ): Promise<SellerSettingOverrideView> {
    return this.prisma.client.$transaction(async (tx) => {
      const system = await tx.systemSetting.findUnique({ where: { key } });
      if (!system) {
        throw new NotFoundException({
          code: 'SYSTEM_SETTING_NOT_FOUND',
          message: `Setting '${key}' does not exist`,
        });
      }
      if (!system.sellerOverridable) {
        await this.audit.log(
          {
            actorType: ActorType.STAFF,
            staffUserId: staffId,
            action: 'staff.seller_setting_override.rejected',
            entityType: 'seller_setting_override',
            entityId: sellerId,
            metadata: { reason: 'NOT_SELLER_OVERRIDABLE', key, sellerId },
            severity: 'LOW',
          },
          tx,
        );
        throw new ConflictException({
          code: 'NOT_SELLER_OVERRIDABLE',
          message: `Setting '${key}' does not accept a per-seller override`,
        });
      }
      if (system.valueType !== input.valueType) {
        throw new BadRequestException({
          code: 'VALUE_TYPE_MISMATCH',
          message: `Setting '${key}' expects ${system.valueType}, got ${input.valueType}`,
        });
      }
      const parsed = this.parseAndClamp(system, input.value, key);

      const updated = await tx.sellerSettingOverride.upsert({
        where: { sellerId_key: { sellerId, key } },
        create: {
          sellerId,
          key,
          valueType: input.valueType,
          note: input.note ?? null,
          setByStaffId: staffId,
          ...this.valueColumns(input.valueType, parsed),
        },
        update: {
          note: input.note ?? null,
          setByStaffId: staffId,
          ...this.valueColumns(input.valueType, parsed),
        },
      });

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'staff.seller_setting_override.set',
          entityType: 'seller_setting_override',
          entityId: updated.id,
          changes: { key, sellerId, value: this.jsonSafe(parsed) },
          severity: 'MEDIUM',
        },
        tx,
      );

      return this.toOverrideView(updated);
    });
  }

  /** Deletes the seller's override for `key`, reverting to the system default. No-op if none exists. */
  async clearOverride(sellerId: string, key: string, staffId: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.sellerSettingOverride.findUnique({
        where: { sellerId_key: { sellerId, key } },
      });
      if (!existing) return;
      await tx.sellerSettingOverride.delete({ where: { sellerId_key: { sellerId, key } } });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'staff.seller_setting_override.cleared',
          entityType: 'seller_setting_override',
          entityId: existing.id,
          changes: { key, sellerId },
          severity: 'MEDIUM',
        },
        tx,
      );
    });
  }

  // ── internals ──

  private extractTypedValue(row: ValueRow): unknown {
    switch (row.valueType) {
      case SettingValueType.STRING:
        return row.valueString;
      case SettingValueType.INT:
        return row.valueInt;
      case SettingValueType.DECIMAL:
        return row.valueDecimal === null ? null : row.valueDecimal.toString();
      case SettingValueType.BOOLEAN:
        return row.valueBoolean;
      case SettingValueType.JSON:
        return row.valueJson;
      case SettingValueType.DATE:
        return row.valueDate;
      default: {
        const exhaustive: never = row.valueType;
        throw new Error(`Unhandled valueType: ${String(exhaustive)}`);
      }
    }
  }

  /** Only the value_* columns — never include sellerId/key/valueType here (callers spread this into create/update payloads that set those separately). */
  private valueColumns(
    valueType: SettingValueType,
    parsed: string | number | boolean | Date | object,
  ): Pick<
    Prisma.SellerSettingOverrideUncheckedCreateInput,
    'valueString' | 'valueInt' | 'valueDecimal' | 'valueBoolean' | 'valueJson' | 'valueDate'
  > {
    return {
      valueString: valueType === SettingValueType.STRING ? (parsed as string) : null,
      valueInt: valueType === SettingValueType.INT ? (parsed as number) : null,
      valueDecimal:
        valueType === SettingValueType.DECIMAL
          ? new Prisma.Decimal(parsed as number | string)
          : null,
      valueBoolean: valueType === SettingValueType.BOOLEAN ? (parsed as boolean) : null,
      valueJson:
        valueType === SettingValueType.JSON ? (parsed as Prisma.InputJsonValue) : Prisma.JsonNull,
      valueDate: valueType === SettingValueType.DATE ? (parsed as Date) : null,
    };
  }

  private parseAndClamp(
    system: Prisma.SystemSettingGetPayload<object>,
    input: unknown,
    key: string,
  ): string | number | boolean | Date | object {
    const reject = (reason: string): never => {
      throw new BadRequestException({
        code: 'INVALID_VALUE',
        message: `Setting '${key}': ${reason}`,
      });
    };
    const outOfBounds = (reason: string): never => {
      throw new BadRequestException({
        code: 'OVERRIDE_OUT_OF_BOUNDS',
        message: `Setting '${key}': ${reason}`,
      });
    };

    switch (system.valueType) {
      case SettingValueType.STRING:
        if (typeof input !== 'string') return reject('expected a string');
        return input;
      case SettingValueType.INT: {
        let n: number;
        if (typeof input === 'number' && Number.isInteger(input)) n = input;
        else if (typeof input === 'string' && /^-?\d+$/.test(input)) n = Number(input);
        else return reject('expected an integer');
        if (system.overrideMinInt !== null && n < system.overrideMinInt) {
          return outOfBounds(`must be >= ${system.overrideMinInt}`);
        }
        if (system.overrideMaxInt !== null && n > system.overrideMaxInt) {
          return outOfBounds(`must be <= ${system.overrideMaxInt}`);
        }
        return n;
      }
      case SettingValueType.DECIMAL: {
        let d: string;
        if (typeof input === 'number' && Number.isFinite(input)) d = String(input);
        else if (typeof input === 'string' && /^-?\d+(\.\d+)?$/.test(input)) d = input;
        else return reject('expected a decimal number');
        const asDecimal = new Prisma.Decimal(d);
        if (system.overrideMinDecimal !== null && asDecimal.lt(system.overrideMinDecimal)) {
          return outOfBounds(`must be >= ${system.overrideMinDecimal.toString()}`);
        }
        if (system.overrideMaxDecimal !== null && asDecimal.gt(system.overrideMaxDecimal)) {
          return outOfBounds(`must be <= ${system.overrideMaxDecimal.toString()}`);
        }
        return d;
      }
      case SettingValueType.BOOLEAN:
        if (typeof input !== 'boolean') return reject('expected a boolean');
        return input;
      case SettingValueType.JSON:
        if (input === null || typeof input !== 'object')
          return reject('expected a JSON object or array');
        return input as object;
      case SettingValueType.DATE: {
        if (input instanceof Date) return input;
        if (typeof input === 'string') {
          const d = new Date(input);
          if (Number.isNaN(d.getTime())) return reject('expected an ISO-8601 date');
          return d;
        }
        return reject('expected an ISO-8601 date string');
      }
      default: {
        const exhaustive: never = system.valueType;
        throw new Error(`Unhandled valueType: ${String(exhaustive)}`);
      }
    }
  }

  private toOverrideView(
    row: Prisma.SellerSettingOverrideGetPayload<object>,
  ): SellerSettingOverrideView {
    return {
      key: row.key,
      valueType: row.valueType,
      value: this.extractTypedValue(row),
      setByStaffId: row.setByStaffId,
      note: row.note,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * An INT setting for one seller, where a GRANDFATHERED column on
   * `sellers` also carries a per-seller value.
   *
   * Precedence, and the order matters:
   *   1. `seller_setting_overrides` — what the admin UI writes. A value
   *      set here is the most recent deliberate decision, so it wins.
   *   2. The legacy column, for sellers configured before the generic
   *      mechanism existed.
   *   3. The global default.
   *
   * This exists because the two legacy columns
   * (`callMaxAttemptsBeforeNdrOverride`, `reservationTtlHoursOverride`)
   * are read directly by their consumers, which meant a key could be
   * marked `sellerOverridable` — and therefore appear in the per-seller
   * settings UI — while the code that acts on it never looked at
   * `seller_setting_overrides` at all. An admin would set the value,
   * see it saved, and nothing would change. Owning the precedence here
   * means the two remaining legacy sites cannot disagree about it.
   *
   * When the legacy columns are eventually backfilled and dropped, this
   * method collapses to `resolve()` and the callers stop passing a
   * legacy value.
   */
  async resolveIntWithLegacy(
    sellerId: string,
    key: string,
    legacyValue: number | null | undefined,
    fallback: number,
  ): Promise<number> {
    const resolved = await this.resolve(sellerId, key);
    if (resolved.source === 'SELLER_OVERRIDE') {
      const n = Number(resolved.value);
      if (Number.isFinite(n)) return n;
    }
    if (legacyValue !== null && legacyValue !== undefined) return legacyValue;
    const n = Number(resolved.value);
    return Number.isFinite(n) ? n : fallback;
  }

  private jsonSafe(value: unknown): Prisma.InputJsonValue | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Prisma.Decimal) return value.toString();
    return value as Prisma.InputJsonValue;
  }
}
