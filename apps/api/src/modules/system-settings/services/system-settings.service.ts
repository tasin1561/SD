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
 * System Settings — admin CRUD over `system_settings`. The schema has
 * been in use since Module 0; many services read settings (call-center
 * caps, pricing GST, stock reservation TTLs, courier defaults). This
 * module surfaces the WRITE side to admin tooling.
 *
 * Invariants:
 *   1. Updates respect `isEditableByAdmin` — non-editable rows reject
 *      with 409 NOT_EDITABLE; the UI gates these read-only too but the
 *      server is the boundary.
 *   2. Type-aware writes — the update DTO supplies the new value as
 *      `unknown`; this service parses + validates per `valueType` and
 *      writes ONLY the matching `value_*` column (others are set to
 *      null in the same write, so a type-conversion via the UI does
 *      not leave orphan values).
 *   3. Audit on every successful update — `staff.system_setting.updated`
 *      severity MEDIUM (settings shape ops behavior; the audit is the
 *      forensic trail). Failed updates audit `staff.system_setting.
 *      update_rejected` at LOW.
 *   4. `lastEditedByStaffId` + `lastEditedAt` are stamped in the same
 *      tx as the value write.
 *   5. Sensitive settings (`isSensitive=true`) — list response masks
 *      `valueDisplay` as `'***'`; getByKey returns the raw value
 *      (the UI is responsible for the reveal-on-intent gate).
 *
 * NOT IN SCOPE (Phase 1A deferral):
 *   - JSON-schema validation via `validationSchema` — the column is
 *     present but enforcement is deferred (the consumers each
 *     validate when they read; centralizing is a Phase-2 win once a
 *     JSON-schema validator lands).
 *   - History — every edit audits but there's no `system_setting_
 *     edits` table; the audit trail IS the history.
 */

export interface SystemSettingView {
  readonly id: string;
  readonly key: string;
  readonly category: string;
  readonly valueType: SettingValueType;
  readonly displayName: string;
  readonly description: string | null;
  readonly helpText: string | null;
  readonly isEditableByAdmin: boolean;
  readonly isSensitive: boolean;
  readonly requiresRestart: boolean;
  /** Current value rendered for display: raw value coerced to string,
   *  or `'***'` if `isSensitive`. */
  readonly valueDisplay: string;
  readonly lastEditedAt: Date | null;
  readonly lastEditedByStaffId: string | null;
}

export interface SystemSettingFull extends SystemSettingView {
  /** The raw value for edit, in the type-appropriate JS representation.
   *  Sensitive settings still return the raw value here; the UI gates
   *  reveal. */
  readonly value: unknown;
}

export interface SystemSettingsCategoryGroup {
  readonly category: string;
  readonly items: readonly SystemSettingView[];
}

export interface UpdateSystemSettingInput {
  readonly valueType: SettingValueType;
  readonly value: unknown;
}

@Injectable()
export class SystemSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * List all settings grouped by `category` (alphabetical), each
   * group sorted by `key`. Sensitive values are masked.
   */
  async list(): Promise<readonly SystemSettingsCategoryGroup[]> {
    const rows = await this.prisma.client.systemSetting.findMany({
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });
    const groups = new Map<string, SystemSettingView[]>();
    for (const row of rows) {
      const view = this.toView(row);
      const bucket = groups.get(view.category) ?? [];
      bucket.push(view);
      groups.set(view.category, bucket);
    }
    return Array.from(groups, ([category, items]) => ({ category, items }));
  }

  /** Single setting WITH the raw value (for the edit modal). */
  async getByKey(key: string): Promise<SystemSettingFull> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'SYSTEM_SETTING_NOT_FOUND',
        message: `Setting '${key}' does not exist`,
      });
    }
    return { ...this.toView(row), value: this.extractValue(row) };
  }

  /**
   * Update a setting's value. Atomic: value write + lastEditedBy/At +
   * audit happen in one transaction. Type mismatch → 400; non-editable
   * → 409; missing key → 404.
   */
  async updateValue(
    key: string,
    input: UpdateSystemSettingInput,
    staffId: string,
  ): Promise<SystemSettingFull> {
    return this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.systemSetting.findUnique({ where: { key } });
      if (!existing) {
        throw new NotFoundException({
          code: 'SYSTEM_SETTING_NOT_FOUND',
          message: `Setting '${key}' does not exist`,
        });
      }
      if (!existing.isEditableByAdmin) {
        await this.audit.log(
          {
            actorType: ActorType.STAFF,
            staffUserId: staffId,
            action: 'staff.system_setting.update_rejected',
            entityType: 'system_setting',
            entityId: existing.id,
            metadata: { reason: 'NOT_EDITABLE', key },
            severity: 'LOW',
          },
          tx,
        );
        throw new ConflictException({
          code: 'NOT_EDITABLE',
          message: `Setting '${key}' is not editable by admins`,
        });
      }
      if (existing.valueType !== input.valueType) {
        throw new BadRequestException({
          code: 'VALUE_TYPE_MISMATCH',
          message: `Setting '${key}' expects ${existing.valueType}, got ${input.valueType}`,
        });
      }
      const parsed = this.parseValue(input.valueType, input.value, key);
      const oldValue = this.extractValue(existing);

      const updated = await tx.systemSetting.update({
        where: { key },
        data: {
          // Type-aware writes: ONLY the matching column gets the new
          // value; the others are nulled to keep the row clean.
          valueString: input.valueType === SettingValueType.STRING ? (parsed as string) : null,
          valueInt: input.valueType === SettingValueType.INT ? (parsed as number) : null,
          valueDecimal:
            input.valueType === SettingValueType.DECIMAL
              ? new Prisma.Decimal(parsed as number | string)
              : null,
          valueBoolean: input.valueType === SettingValueType.BOOLEAN ? (parsed as boolean) : null,
          valueJson:
            input.valueType === SettingValueType.JSON
              ? (parsed as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          valueDate: input.valueType === SettingValueType.DATE ? (parsed as Date) : null,
          lastEditedByStaffId: staffId,
          lastEditedAt: new Date(),
        },
      });

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'staff.system_setting.updated',
          entityType: 'system_setting',
          entityId: existing.id,
          changes: { key, before: this.jsonSafe(oldValue), after: this.jsonSafe(parsed) },
          metadata: existing.requiresRestart ? { requiresRestart: true } : null,
          severity: 'MEDIUM',
        },
        tx,
      );

      return { ...this.toView(updated), value: this.extractValue(updated) };
    });
  }

  // ── internals ──

  private toView(row: Prisma.SystemSettingGetPayload<object>): SystemSettingView {
    const rawValue = this.extractValue(row);
    const valueDisplay = row.isSensitive ? '***' : this.formatValueForDisplay(rawValue);
    return {
      id: row.id,
      key: row.key,
      category: row.category,
      valueType: row.valueType,
      displayName: row.displayName,
      description: row.description,
      helpText: row.helpText,
      isEditableByAdmin: row.isEditableByAdmin,
      isSensitive: row.isSensitive,
      requiresRestart: row.requiresRestart,
      valueDisplay,
      lastEditedAt: row.lastEditedAt,
      lastEditedByStaffId: row.lastEditedByStaffId,
    };
  }

  private extractValue(row: Prisma.SystemSettingGetPayload<object>): unknown {
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

  private formatValueForDisplay(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  private jsonSafe(value: unknown): Prisma.InputJsonValue | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Prisma.Decimal) return value.toString();
    if (typeof value === 'object') return value as Prisma.InputJsonValue;
    return value as Prisma.InputJsonValue;
  }

  private parseValue(
    type: SettingValueType,
    input: unknown,
    key: string,
  ): string | number | boolean | Date | object {
    const reject = (reason: string): never => {
      throw new BadRequestException({
        code: 'INVALID_VALUE',
        message: `Setting '${key}': ${reason}`,
      });
    };

    switch (type) {
      case SettingValueType.STRING:
        if (typeof input !== 'string') return reject('expected a string');
        return input;
      case SettingValueType.INT:
        if (typeof input === 'number') {
          if (!Number.isInteger(input)) return reject('expected an integer');
          return input;
        }
        if (typeof input === 'string' && /^-?\d+$/.test(input)) return Number(input);
        return reject('expected an integer');
      case SettingValueType.DECIMAL:
        if (typeof input === 'number' && Number.isFinite(input)) return input;
        if (typeof input === 'string' && /^-?\d+(\.\d+)?$/.test(input)) return input;
        return reject('expected a decimal number');
      case SettingValueType.BOOLEAN:
        if (typeof input !== 'boolean') return reject('expected a boolean');
        return input;
      case SettingValueType.JSON:
        if (input === null || typeof input !== 'object') {
          return reject('expected a JSON object or array');
        }
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
        const exhaustive: never = type;
        throw new Error(`Unhandled valueType: ${String(exhaustive)}`);
      }
    }
  }
}
