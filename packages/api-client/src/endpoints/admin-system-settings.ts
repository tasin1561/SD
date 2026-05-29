/**
 * Admin system-settings surface (Module 14).
 *
 *   GET   /admin/system-settings           (list grouped by category)
 *   GET   /admin/system-settings/:key      (full row + raw value for edit)
 *   PATCH /admin/system-settings/:key      (type-aware update)
 *
 * The `valueType` enum mirrors the schema's SettingValueType. Per-type
 * `value` JS shape:
 *   STRING  → string
 *   INT     → number (integer)
 *   DECIMAL → string or number (server accepts both; canonical is string)
 *   BOOLEAN → boolean
 *   JSON    → object | array
 *   DATE    → string (ISO-8601)
 */
import type { SettingValueType } from '@skydrop/db';

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
  /** Already-coerced display string. `'***'` if isSensitive. */
  readonly valueDisplay: string;
  readonly lastEditedAt: string | null;
  readonly lastEditedByStaffId: string | null;
}

export interface SystemSettingFull extends SystemSettingView {
  /** Raw value (typed per valueType). */
  readonly value: unknown;
}

export interface SystemSettingsCategoryGroup {
  readonly category: string;
  readonly items: readonly SystemSettingView[];
}

export interface UpdateSystemSettingRequest {
  readonly valueType: SettingValueType;
  readonly value: unknown;
}
